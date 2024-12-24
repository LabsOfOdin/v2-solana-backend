import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LimitOrder } from '../entities/limit-order.entity';
import { PriceService } from '../price/price.service';
import { TradeService } from '../trade/trade.service';
import { MarginService } from '../margin/margin.service';
import { MathService } from '../utils/math.service';
import { EventsService } from '../events/events.service';
import {
  OrderRequest,
  LimitOrderRequest,
  OrderStatus,
  OrderSide,
} from '../types/trade.types';
import { Market } from '../entities/market.entity';

@Injectable()
export class LimitOrderService {
  private readonly logger = new Logger(LimitOrderService.name);
  private readonly checkInterval = 10000; // 10 seconds

  constructor(
    @InjectRepository(LimitOrder)
    private readonly limitOrderRepository: Repository<LimitOrder>,
    private readonly priceService: PriceService,
    private readonly tradeService: TradeService,
    private readonly marginService: MarginService,
    private readonly mathService: MathService,
    private readonly eventsService: EventsService,
    @InjectRepository(Market)
    private readonly marketRepository: Repository<Market>,
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
    // Calculate required margin in usd (size / leverage)
    const requiredMargin = this.mathService.divide(
      orderRequest.size,
      orderRequest.leverage,
    );

    // Validate user has enough balance
    const marginBalance = await this.marginService.getBalance(
      orderRequest.userId,
      orderRequest.token,
    );

    const marginPrice =
      orderRequest.token === 'USDC'
        ? '1'
        : await this.priceService.getSolPrice();

    const availableBalanceUsd = this.mathService.multiply(
      marginBalance.availableBalance,
      marginPrice,
    );

    if (this.mathService.compare(availableBalanceUsd, requiredMargin) < 0) {
      throw new Error('Insufficient balance for limit order');
    }

    // Get market details
    const market = await this.marketRepository.findOne({
      where: { id: orderRequest.marketId },
    });

    if (!market) {
      throw new Error('Market not found');
    }

    // Create limit order
    const limitOrder = this.limitOrderRepository.create({
      userId: orderRequest.userId,
      marketId: orderRequest.marketId,
      side: orderRequest.side,
      size: orderRequest.size,
      price: orderRequest.price,
      leverage: orderRequest.leverage,
      token: orderRequest.token,
      symbol: market.symbol,
      requiredMargin: this.mathService.divide(requiredMargin, marginPrice),
      status: OrderStatus.OPEN,
    });

    const savedOrder = await this.limitOrderRepository.save(limitOrder);

    // Emit position update event
    this.eventsService.emitPositionsUpdate();

    return savedOrder;
  }

  async cancelLimitOrder(orderId: string, userId: string): Promise<void> {
    const order = await this.limitOrderRepository.findOne({
      where: { id: orderId, userId },
    });

    if (!order) {
      throw new Error('Limit order not found');
    }

    if (order.status !== OrderStatus.OPEN) {
      throw new Error('Order cannot be cancelled');
    }

    // Update order status
    await this.limitOrderRepository.update(orderId, {
      status: OrderStatus.CANCELLED,
    });

    // Emit position update event
    this.eventsService.emitPositionsUpdate();
  }

  private async checkAndExecuteLimitOrders(): Promise<void> {
    const openOrders = await this.limitOrderRepository.find({
      where: { status: OrderStatus.OPEN },
    });

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
    const comparison = this.mathService.compare(currentPrice, limitPrice);
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

      const availableBalanceUsd = this.mathService.multiply(
        marginBalance.availableBalance,
        marginPrice,
      );

      const requiredMarginUsd = this.mathService.multiply(
        order.requiredMargin,
        marginPrice,
      );

      if (
        this.mathService.compare(availableBalanceUsd, requiredMarginUsd) < 0
      ) {
        // Cancel the order if insufficient margin
        await this.limitOrderRepository.update(order.id, {
          status: OrderStatus.CANCELLED,
        });
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
      };

      // Execute the trade
      await this.tradeService.openPosition(orderRequest);

      // Update order status
      await this.limitOrderRepository.update(order.id, {
        status: OrderStatus.FILLED,
      });

      // Emit position update event
      this.eventsService.emitPositionsUpdate();

      this.logger.log(`Limit order ${order.id} executed successfully`);
    } catch (error) {
      this.logger.error(`Failed to execute limit order ${order.id}:`, error);
      // You might want to implement retry logic or notification system here
    }
  }

  async getUserLimitOrders(userId: string): Promise<LimitOrder[]> {
    return this.limitOrderRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async getMarketLimitOrders(marketId: string): Promise<LimitOrder[]> {
    return this.limitOrderRepository.find({
      where: { marketId, status: OrderStatus.OPEN },
      order: { price: 'ASC' },
    });
  }
}
