import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Position, PositionStatus } from '../entities/position.entity';
import { PriceService } from '../price/price.service';
import { LiquidityService } from '../liquidity/liquidity.service';
import { UserService } from '../user/user.service';
import { MathService } from '../utils/math.service';
import { CacheService } from '../utils/cache.service';
import { CACHE_TTL, getCacheKey } from '../constants/cache.constants';
import {
  OrderRequest,
  OrderSide,
  MarginType,
  Trade,
  OrderType,
  UpdatePositionRequest,
  PartialCloseRequest,
} from '../types/trade.types';
import { Trade as TradeEntity } from '../entities/trade.entity';
import { MarginService } from '../margin/margin.service';

/**
 * This module will be responsible for handling all trade-related functionality.
 *
 * We'll need to implement:
 * - Funding Rates
 * - Borrowing Rates
 * - Liquidations
 * - Price Impact
 * - Leverage
 *
 * Trades will be peer to protocol (AMM), so we'll need to handle payouts from the liquidity pool.
 *
 */

@Injectable()
export class TradeService {
  private readonly checkInterval = 10000; // 10 seconds

  constructor(
    @InjectRepository(Position)
    private readonly positionRepository: Repository<Position>,
    @InjectRepository(TradeEntity)
    private readonly tradeRepository: Repository<TradeEntity>,
    private readonly priceService: PriceService,
    private readonly liquidityService: LiquidityService,
    private readonly userService: UserService,
    private readonly mathService: MathService,
    private readonly cacheService: CacheService,
    private readonly marginService: MarginService,
  ) {
    this.startMonitoring();
  }

  private async startMonitoring() {
    setInterval(async () => {
      try {
        await this.checkPositionsForStopLossAndTakeProfit();
      } catch (error) {
        console.error('Error checking positions:', error);
      }
    }, this.checkInterval);
  }

  async openPosition(orderRequest: OrderRequest): Promise<Position> {
    // 1. Validate user has enough margin
    const marginBalance = await this.marginService.getBalance(
      orderRequest.userId,
      orderRequest.token,
    );
    const requiredMargin = this.calculateRequiredMargin(orderRequest);

    if (
      this.mathService.compare(marginBalance.availableBalance, requiredMargin) <
      0
    ) {
      throw new Error('Insufficient margin');
    }

    // 2. Check liquidity pool capacity
    await this.liquidityService.validateLiquidityForTrade(orderRequest);

    // 3. Get current market price and calculate entry price with slippage
    const marketPrice = await this.priceService.getCurrentPrice(
      orderRequest.marketId,
    );
    const entryPrice = this.calculateEntryPrice(marketPrice, orderRequest);

    // 4. Lock margin for the trade
    await this.marginService.lockMargin(
      orderRequest.userId,
      orderRequest.token,
      requiredMargin,
      orderRequest.id,
    );

    // 5. Create position
    const position = await this.positionRepository.save(
      this.positionRepository.create({
        userId: orderRequest.userId,
        marketId: orderRequest.marketId,
        side: orderRequest.side,
        size: orderRequest.size,
        entryPrice,
        leverage: orderRequest.leverage,
        marginType: orderRequest.marginType,
        stopLossPrice: orderRequest.stopLossPrice,
        takeProfitPrice: orderRequest.takeProfitPrice,
        unrealizedPnl: '0',
        margin: requiredMargin,
        token: orderRequest.token,
      }),
    );

    return position;
  }

  async updatePosition(
    positionId: string,
    userId: string,
    updates: UpdatePositionRequest,
  ): Promise<Position> {
    const position = await this.getPosition(positionId);

    if (position.userId !== userId) {
      throw new Error('Not authorized to update this position');
    }

    // Validate stop loss and take profit prices
    if (updates.stopLossPrice) {
      this.validateStopLossPrice(
        position.side,
        position.entryPrice,
        updates.stopLossPrice,
      );
    }

    if (updates.takeProfitPrice) {
      this.validateTakeProfitPrice(
        position.side,
        position.entryPrice,
        updates.takeProfitPrice,
      );
    }

    await this.positionRepository.update(positionId, updates);
    await this.invalidatePositionCache(positionId, userId);
    return this.getPosition(positionId);
  }

  private async checkPositionsForStopLossAndTakeProfit(): Promise<void> {
    const positions = await this.positionRepository.find({
      where: [
        { stopLossPrice: Not(IsNull()) },
        { takeProfitPrice: Not(IsNull()) },
      ],
    });

    for (const position of positions) {
      try {
        const currentPrice = await this.priceService.getCurrentPrice(
          position.marketId,
        );

        if (this.shouldTriggerStopLoss(position, currentPrice)) {
          await this.closePosition(position.id, position.userId);
          continue;
        }

        if (this.shouldTriggerTakeProfit(position, currentPrice)) {
          await this.closePosition(position.id, position.userId);
        }
      } catch (error) {
        console.error(`Error processing position ${position.id}:`, error);
      }
    }
  }

  private async updateTrailingStop(
    position: Position,
    currentPrice: string,
  ): Promise<void> {
    if (!position.trailingStopDistance) return;

    if (position.side === OrderSide.LONG) {
      // For longs, track the highest price and maintain stop distance below it
      if (
        !position.highestPrice ||
        this.mathService.compare(currentPrice, position.highestPrice) > 0
      ) {
        const newStopPrice = this.mathService.subtract(
          currentPrice,
          position.trailingStopDistance,
        );
        await this.positionRepository.update(position.id, {
          highestPrice: currentPrice,
          stopLossPrice: newStopPrice,
        });
      }
    } else {
      // For shorts, track the lowest price and maintain stop distance above it
      if (
        !position.lowestPrice ||
        this.mathService.compare(currentPrice, position.lowestPrice) < 0
      ) {
        const newStopPrice = this.mathService.add(
          currentPrice,
          position.trailingStopDistance,
        );
        await this.positionRepository.update(position.id, {
          lowestPrice: currentPrice,
          stopLossPrice: newStopPrice,
        });
      }
    }
  }

  private shouldTriggerStopLoss(
    position: Position,
    currentPrice: string,
  ): boolean {
    if (!position.stopLossPrice) return false;

    if (position.side === OrderSide.LONG) {
      return (
        this.mathService.compare(currentPrice, position.stopLossPrice) <= 0
      );
    } else {
      return (
        this.mathService.compare(currentPrice, position.stopLossPrice) >= 0
      );
    }
  }

  private shouldTriggerTakeProfit(
    position: Position,
    currentPrice: string,
  ): boolean {
    if (!position.takeProfitPrice) return false;

    if (position.side === OrderSide.LONG) {
      return (
        this.mathService.compare(currentPrice, position.takeProfitPrice) >= 0
      );
    } else {
      return (
        this.mathService.compare(currentPrice, position.takeProfitPrice) <= 0
      );
    }
  }

  private validateStopLossPrice(
    side: OrderSide,
    entryPrice: string,
    stopLossPrice: string,
  ) {
    if (side === OrderSide.LONG) {
      if (this.mathService.compare(stopLossPrice, entryPrice) >= 0) {
        throw new Error(
          'Stop loss price must be below entry price for long positions',
        );
      }
    } else {
      if (this.mathService.compare(stopLossPrice, entryPrice) <= 0) {
        throw new Error(
          'Stop loss price must be above entry price for short positions',
        );
      }
    }
  }

  private validateTakeProfitPrice(
    side: OrderSide,
    entryPrice: string,
    takeProfitPrice: string,
  ) {
    if (side === OrderSide.LONG) {
      if (this.mathService.compare(takeProfitPrice, entryPrice) <= 0) {
        throw new Error(
          'Take profit price must be above entry price for long positions',
        );
      }
    } else {
      if (this.mathService.compare(takeProfitPrice, entryPrice) >= 0) {
        throw new Error(
          'Take profit price must be below entry price for short positions',
        );
      }
    }
  }

  async closePosition(positionId: string, userId: string): Promise<void> {
    const position = await this.getPosition(positionId);

    if (position.userId !== userId) {
      throw new Error('Not authorized to modify this position');
    }

    const currentPrice = await this.priceService.getCurrentPrice(
      position.marketId,
    );

    // Calculate final PnL
    const realizedPnl = this.calculatePnl(
      position.side,
      position.size,
      position.entryPrice,
      currentPrice,
    );

    // Release margin with PnL
    await this.marginService.releaseMargin(
      position.userId,
      position.token,
      position.id,
      realizedPnl,
    );

    // Close position
    await this.positionRepository.update(position.id, {
      status: PositionStatus.CLOSED,
      closedAt: new Date(),
      closingPrice: currentPrice,
      realizedPnl,
    });
  }

  async updatePositionPnl(positionId: string): Promise<void> {
    const position = await this.getPosition(positionId);
    const currentPrice = await this.priceService.getCurrentPrice(
      position.marketId,
    );

    const unrealizedPnl = this.calculatePnl(
      position.side,
      position.size,
      position.entryPrice,
      currentPrice,
    );

    await this.positionRepository.update(position.id, { unrealizedPnl });
    await this.marginService.updateUnrealizedPnl(
      position.userId,
      position.token,
      unrealizedPnl,
    );
  }

  async getPosition(positionId: string): Promise<Position> {
    return this.cacheService.wrap(
      getCacheKey.position(positionId),
      async () => {
        const position = await this.positionRepository.findOne({
          where: { id: positionId },
        });

        if (!position) {
          throw new NotFoundException(`Position ${positionId} not found`);
        }

        return position;
      },
      CACHE_TTL.POSITION,
    );
  }

  async getUserPositions(userId: string): Promise<Position[]> {
    return this.cacheService.wrap(
      getCacheKey.userPositions(userId),
      () =>
        this.positionRepository.find({
          where: { userId },
          order: { createdAt: 'DESC' },
        }),
      CACHE_TTL.POSITION,
    );
  }

  private calculateRequiredMargin(order: OrderRequest): string {
    return this.mathService.divide(
      this.mathService.multiply(order.size, order.price || '0'),
      order.leverage,
    );
  }

  private calculateEntryPrice(
    marketPrice: string,
    order: OrderRequest,
  ): string {
    const slippagePercentage = this.calculateSlippage(order.size);
    const slippageMultiplier =
      order.side === OrderSide.LONG
        ? this.mathService.add('1', slippagePercentage)
        : this.mathService.subtract('1', slippagePercentage);

    return this.mathService.multiply(marketPrice, slippageMultiplier);
  }

  private calculatePnl(
    side: OrderSide,
    size: string,
    entryPrice: string,
    currentPrice: string,
  ): string {
    const priceDiff =
      side === OrderSide.LONG
        ? this.mathService.subtract(currentPrice, entryPrice)
        : this.mathService.subtract(entryPrice, currentPrice);

    return this.mathService.multiply(size, priceDiff);
  }

  private calculateSlippage(size: string): string {
    return this.mathService.min(
      '0.01',
      this.mathService.divide(size, '1000000'),
    );
  }

  private calculateFee(size: string, price: string): string {
    const notionalValue = this.mathService.multiply(size, price);
    return this.mathService.multiply(notionalValue, '0.0005'); // 0.05% fee
  }

  private async recordTrade(trade: Trade): Promise<void> {
    await this.tradeRepository.save(this.tradeRepository.create(trade));
    await this.invalidatePositionCache(trade.positionId, trade.userId);
  }

  async getPositionTrades(positionId: string): Promise<TradeEntity[]> {
    return this.cacheService.wrap(
      getCacheKey.positionTrades(positionId),
      () =>
        this.tradeRepository.find({
          where: { positionId },
          order: { createdAt: 'DESC' },
        }),
      CACHE_TTL.TRADE_HISTORY,
    );
  }

  async getUserTrades(userId: string): Promise<TradeEntity[]> {
    return this.cacheService.wrap(
      getCacheKey.userTrades(userId),
      () =>
        this.tradeRepository.find({
          where: { userId },
          order: { createdAt: 'DESC' },
        }),
      CACHE_TTL.TRADE_HISTORY,
    );
  }

  async partialClosePosition(
    positionId: string,
    userId: string,
    request: PartialCloseRequest,
  ): Promise<Position> {
    const position = await this.getPosition(positionId);

    if (position.userId !== userId) {
      throw new Error('Not authorized to modify this position');
    }

    // Validate partial close size
    if (this.mathService.compare(request.size, position.size) >= 0) {
      throw new Error('Partial close size must be less than position size');
    }

    const currentPrice = await this.priceService.getCurrentPrice(
      position.marketId,
    );
    const remainingSize = this.mathService.subtract(
      position.size,
      request.size,
    );

    // Calculate realized PnL for the closed portion
    const realizedPnl = this.calculatePnl(
      position.side,
      request.size,
      position.entryPrice,
      request.price || currentPrice,
    );

    // Release proportional margin with PnL
    const marginToRelease = this.mathService.multiply(
      position.margin,
      this.mathService.divide(request.size, position.size),
    );
    await this.marginService.releaseMargin(
      position.userId,
      position.token,
      position.id,
      realizedPnl,
    );

    // Update position
    const updatedPosition = await this.positionRepository.save({
      ...position,
      size: remainingSize,
      margin: this.mathService.subtract(position.margin, marginToRelease),
      stopLossPrice: request.stopLossPrice || position.stopLossPrice,
      takeProfitPrice: request.takeProfitPrice || position.takeProfitPrice,
    });

    // Record the partial close trade
    await this.recordTrade({
      id: crypto.randomUUID(),
      positionId: position.id,
      userId: position.userId,
      marketId: position.marketId,
      side: position.side === OrderSide.LONG ? OrderSide.SHORT : OrderSide.LONG,
      size: request.size,
      price: request.price || currentPrice,
      leverage: position.leverage,
      marginType: position.marginType,
      realizedPnl,
      fee: this.calculateFee(request.size, request.price || currentPrice),
      createdAt: new Date(),
      type: request.type,
      isPartialClose: true,
    });

    return updatedPosition;
  }

  private validateTrailingStop(
    side: OrderSide,
    currentPrice: string,
    trailingStopDistance: string,
  ) {
    if (this.mathService.compare(trailingStopDistance, '0') <= 0) {
      throw new Error('Trailing stop distance must be positive');
    }

    // Additional validation could be added here
    // For example, minimum distance requirements
  }

  async getBorrowingHistory(
    positionId: string,
    startTime?: string,
    endTime?: string,
  ): Promise<{
    totalBorrowingFee: string;
    history: {
      timestamp: Date;
      fee: string;
      positionValue: string;
      rate: string;
    }[];
  }> {
    return this.cacheService.wrap(
      getCacheKey.borrowingHistory(positionId, startTime, endTime),
      async () => {
        const position = await this.getPosition(positionId);
        const start = startTime ? new Date(startTime) : position.createdAt;
        const end = endTime ? new Date(endTime) : new Date();

        const history = [];
        let currentTime = new Date(start);

        while (currentTime <= end) {
          const currentPrice = await this.priceService.getCurrentPrice(
            position.marketId,
          );
          const positionValue = this.mathService.multiply(
            position.size,
            currentPrice,
          );
          const hourlyFee = this.mathService.multiply(
            positionValue,
            '0.0000125',
          );

          history.push({
            timestamp: new Date(currentTime),
            fee: hourlyFee,
            positionValue,
            rate: '0.0000125',
          });

          currentTime = new Date(currentTime.getTime() + 60 * 60 * 1000);
        }

        return {
          totalBorrowingFee: history.reduce(
            (sum, entry) => this.mathService.add(sum, entry.fee),
            '0',
          ),
          history,
        };
      },
      CACHE_TTL.TRADE_HISTORY,
    );
  }

  private async invalidatePositionCache(
    positionId: string,
    userId: string,
  ): Promise<void> {
    const keys = [
      getCacheKey.position(positionId),
      getCacheKey.positionTrades(positionId),
      getCacheKey.userPositions(userId),
      getCacheKey.userTrades(userId),
    ];

    await this.cacheService.delMultiple(keys);
  }
}
