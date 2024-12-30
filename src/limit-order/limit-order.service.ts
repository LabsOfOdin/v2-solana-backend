import { Injectable, Logger } from '@nestjs/common';
import { LimitOrder } from '../entities/limit-order.entity';
import { PriceService } from '../price/price.service';
import { TradeService } from '../trade/trade.service';
import { MarginService } from '../margin/margin.service';
import { EventsService } from '../events/events.service';
import {
  OrderRequest,
  LimitOrderRequest,
  OrderStatus,
  OrderSide,
} from '../types/trade.types';
import { Market } from '../entities/market.entity';
import { compare, divide, multiply } from 'src/lib/math';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class LimitOrderService {
  private readonly logger = new Logger(LimitOrderService.name);
  private readonly checkInterval = 10000; // 10 seconds

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly priceService: PriceService,
    private readonly tradeService: TradeService,
    private readonly marginService: MarginService,
    private readonly eventsService: EventsService,
  ) {
    // Start monitoring limit orders
    this.startMonitoring();
  }

  private async startMonitoring() {
    setInterval(async () => {
      try {
        await this.checkAndExecuteLimitOrders();
      } catch (error) {
        this.logger.error('Error checking limit orders:', error);
      }
    }, this.checkInterval);
  }

  async createLimitOrder(orderRequest: LimitOrderRequest): Promise<LimitOrder> {
    if (
      orderRequest.leverage === '0' ||
      orderRequest.size === '0' ||
      orderRequest.price === '0'
    ) {
      throw new Error('Invalid Parameters');
    }

    // Calculate required margin in usd (size / leverage)
    const requiredMargin = divide(orderRequest.size, orderRequest.leverage);

    // Validate user has enough balance
    const marginBalance = await this.marginService.getBalance(
      orderRequest.userId,
      orderRequest.token,
    );

    const marginPrice =
      orderRequest.token === 'USDC'
        ? '1'
        : await this.priceService.getSolPrice();

    const availableBalanceUsd = multiply(
      marginBalance.availableBalance,
      marginPrice,
    );

    if (compare(availableBalanceUsd, requiredMargin) < 0) {
      throw new Error('Insufficient balance for limit order');
    }

    // Get market details
    const [market] = await this.databaseService.select<Market>('markets', {
      eq: { id: orderRequest.marketId },
      limit: 1,
    });

    if (!market) {
      throw new Error('Market not found');
    }

    // Create limit order
    const [savedOrder] = await this.databaseService.insert<LimitOrder>(
      'limit_orders',
      {
        userId: orderRequest.userId,
        marketId: orderRequest.marketId,
        side: orderRequest.side,
        size: orderRequest.size,
        price: orderRequest.price,
        leverage: orderRequest.leverage,
        token: orderRequest.token,
        symbol: market.symbol,
        requiredMargin: divide(requiredMargin, marginPrice),
        status: OrderStatus.OPEN,
      },
    );

    // Emit position update event
    this.eventsService.emitPositionsUpdate(orderRequest.userId);

    return savedOrder;
  }

  async cancelLimitOrder(orderId: string, userId: string): Promise<void> {
    const [order] = await this.databaseService.select<LimitOrder>(
      'limit_orders',
      {
        eq: { id: orderId, userId },
        limit: 1,
      },
    );

    if (!order) {
      throw new Error('Limit order not found');
    }

    if (order.status !== OrderStatus.OPEN) {
      throw new Error('Order cannot be cancelled');
    }

    await this.databaseService.update<LimitOrder>(
      'limit_orders',
      { status: OrderStatus.CANCELLED },
      { id: orderId },
    );

    // Emit position update event
    this.eventsService.emitPositionsUpdate(userId);
  }

  private async checkAndExecuteLimitOrders(): Promise<void> {
    const openOrders = await this.databaseService.select<LimitOrder>(
      'limit_orders',
      {
        eq: { status: OrderStatus.OPEN },
      },
    );

    for (const order of openOrders) {
      try {
        const currentPrice = await this.priceService.getCurrentPrice(
          order.marketId,
        );

        const shouldExecute = this.shouldExecuteOrder(
          order.side,
          order.price,
          currentPrice,
        );

        if (shouldExecute) {
          await this.executeLimitOrder(order);
        }
      } catch (error) {
        this.logger.error(`Error processing limit order ${order.id}:`, error);
      }
    }
  }

  private shouldExecuteOrder(
    side: OrderSide,
    limitPrice: string,
    currentPrice: string,
  ): boolean {
    const comparison = compare(currentPrice, limitPrice);
    return (
      (side === OrderSide.LONG && comparison <= 0) || // Buy when price falls to or below limit
      (side === OrderSide.SHORT && comparison >= 0) // Sell when price rises to or above limit
    );
  }

  private async executeLimitOrder(order: LimitOrder): Promise<void> {
    try {
      // Check if user has sufficient margin
      const marginBalance = await this.marginService.getBalance(
        order.userId,
        order.token,
      );

      const marginPrice =
        order.token === 'USDC' ? '1' : await this.priceService.getSolPrice();

      const availableBalanceUsd = multiply(
        marginBalance.availableBalance,
        marginPrice,
      );

      const requiredMarginUsd = multiply(order.requiredMargin, marginPrice);

      if (compare(availableBalanceUsd, requiredMarginUsd) < 0) {
        // Cancel the order if insufficient margin
        await this.databaseService.update<LimitOrder>(
          'limit_orders',
          { status: OrderStatus.CANCELLED },
          { id: order.id },
        );
        this.logger.warn(
          `Cancelled limit order ${order.id} due to insufficient margin`,
        );
        return;
      }

      // Create market order request from limit order
      const orderRequest: OrderRequest = {
        id: order.id,
        userId: order.userId,
        marketId: order.marketId,
        side: order.side,
        size: order.size,
        leverage: order.leverage,
        token: order.token,
      };

      // Execute the trade
      await this.tradeService.openPosition(orderRequest);

      // Update order status
      await this.databaseService.update<LimitOrder>(
        'limit_orders',
        { status: OrderStatus.FILLED },
        { id: order.id },
      );

      // Emit position update event
      this.eventsService.emitPositionsUpdate(orderRequest.userId);

      this.logger.log(`Limit order ${order.id} executed successfully`);
    } catch (error) {
      this.logger.error(`Failed to execute limit order ${order.id}:`, error);
      // You might want to implement retry logic or notification system here
    }
  }

  async getUserLimitOrders(userId: string): Promise<LimitOrder[]> {
    return this.databaseService.select<LimitOrder>('limit_orders', {
      eq: { userId },
      order: { column: 'createdAt', ascending: false },
    });
  }

  async getMarketLimitOrders(marketId: string): Promise<LimitOrder[]> {
    return this.databaseService.select<LimitOrder>('limit_orders', {
      eq: { marketId, status: OrderStatus.OPEN },
      order: { column: 'price', ascending: true },
    });
  }
}
