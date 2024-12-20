import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LimitOrder } from '../entities/limit-order.entity';
import { PriceService } from '../price/price.service';
import { TradeService } from '../trade/trade.service';
import { MarginService } from '../margin/margin.service';
import { MathService } from '../utils/math.service';
import {
  OrderRequest,
  OrderStatus,
  OrderType,
  OrderSide,
} from '../types/trade.types';

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

  async createLimitOrder(orderRequest: OrderRequest): Promise<LimitOrder> {
    if (!orderRequest.price) {
      throw new Error('Price is required for limit orders');
    }

    // Calculate required margin
    const requiredMargin = this.mathService.divide(
      this.mathService.multiply(orderRequest.size, orderRequest.price),
      orderRequest.leverage,
    );

    // Validate user has enough balance
    const marginBalance = await this.marginService.getBalance(
      orderRequest.userId,
      orderRequest.token,
    );

    if (
      this.mathService.compare(marginBalance.availableBalance, requiredMargin) <
      0
    ) {
      throw new Error('Insufficient balance for limit order');
    }

    // Lock the margin
    await this.marginService.lockMargin(
      orderRequest.userId,
      orderRequest.token,
      requiredMargin,
      orderRequest.id,
    );

    // Create limit order
    const limitOrder = this.limitOrderRepository.create({
      userId: orderRequest.userId,
      marketId: orderRequest.marketId,
      side: orderRequest.side,
      size: orderRequest.size,
      price: orderRequest.price,
      leverage: orderRequest.leverage,
      marginType: orderRequest.marginType,
      token: orderRequest.token,
      requiredMargin,
      status: OrderStatus.OPEN,
    });

    return this.limitOrderRepository.save(limitOrder);
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

    // Release locked margin
    await this.marginService.releaseMargin(
      userId,
      order.token,
      orderId,
      '0', // No PnL for cancelled orders
    );

    // Update order status
    await this.limitOrderRepository.update(orderId, {
      status: OrderStatus.CANCELLED,
    });
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
    // Create order request
    const orderRequest: OrderRequest = {
      id: order.id,
      userId: order.userId,
      marketId: order.marketId,
      side: order.side,
      size: order.size,
      type: OrderType.LIMIT,
      price: order.price,
      leverage: order.leverage,
      marginType: order.marginType,
      token: order.token,
    };

    try {
      // Execute the trade
      await this.tradeService.openPosition(orderRequest);

      // Update order status
      await this.limitOrderRepository.update(order.id, {
        status: OrderStatus.FILLED,
      });

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
