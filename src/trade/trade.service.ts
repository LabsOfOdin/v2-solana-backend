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
  UpdatePositionRequest,
  PartialCloseRequest,
} from '../types/trade.types';
import { Trade as TradeEntity } from '../entities/trade.entity';
import { MarginService } from '../margin/margin.service';
import { TokenType } from '../margin/types/token.types';

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
    // 1. Get current market price and calculate entry price with slippage
    const marketPrice = await this.priceService.getCurrentPrice(
      orderRequest.marketId,
    );
    const entryPrice = this.calculateEntryPrice(marketPrice, orderRequest);

    // 2. Calculate required margin in USD
    const requiredMarginUSD = await this.calculateRequiredMargin(orderRequest);

    // 3. Get margin balances for supported tokens
    const [solBalance, usdcBalance] = await Promise.all([
      this.marginService.getBalance(orderRequest.userId, TokenType.SOL),
      this.marginService.getBalance(orderRequest.userId, TokenType.USDC),
    ]);

    // 4. Convert SOL balance to USD for comparison
    const solPrice = await this.priceService.getSolPrice();
    const solBalanceInUSD = this.mathService.multiply(
      solBalance.availableBalance,
      solPrice,
    );

    // 5. Calculate how much of each token to lock based on their USD values
    let solAmountToLock = '0';
    let usdcAmountToLock = '0';
    let marginType = MarginType.ISOLATED;

    const totalAvailableUSD = this.mathService.add(
      solBalanceInUSD,
      usdcBalance.availableBalance,
    );

    if (this.mathService.compare(totalAvailableUSD, requiredMarginUSD) < 0) {
      throw new Error('Insufficient margin');
    }

    // First try to use a single token (USDC first, then SOL) for isolated margin
    if (
      this.mathService.compare(
        usdcBalance.availableBalance,
        requiredMarginUSD,
      ) >= 0
    ) {
      usdcAmountToLock = requiredMarginUSD;
    } else if (
      this.mathService.compare(solBalanceInUSD, requiredMarginUSD) >= 0
    ) {
      solAmountToLock = this.mathService.divide(requiredMarginUSD, solPrice);
    } else {
      // If no single token has enough, use both tokens (cross margin)
      marginType = MarginType.CROSS;
      usdcAmountToLock = usdcBalance.availableBalance;
      const remainingMarginUSD = this.mathService.subtract(
        requiredMarginUSD,
        usdcBalance.availableBalance,
      );
      solAmountToLock = this.mathService.divide(remainingMarginUSD, solPrice);
    }

    // 6. Lock margins
    const positionId = crypto.randomUUID();
    if (this.mathService.compare(usdcAmountToLock, '0') > 0) {
      await this.marginService.lockMargin(
        orderRequest.userId,
        TokenType.USDC,
        usdcAmountToLock,
        positionId,
      );
    }
    if (this.mathService.compare(solAmountToLock, '0') > 0) {
      await this.marginService.lockMargin(
        orderRequest.userId,
        TokenType.SOL,
        solAmountToLock,
        positionId,
      );
    }

    // 7. Check liquidity pool capacity
    await this.liquidityService.validateLiquidityForTrade(orderRequest);

    // 8. Create position
    const position = await this.positionRepository.save(
      this.positionRepository.create({
        id: positionId,
        userId: orderRequest.userId,
        marketId: orderRequest.marketId,
        side: orderRequest.side,
        size: orderRequest.size,
        entryPrice,
        leverage: orderRequest.leverage,
        marginType,
        stopLossPrice: orderRequest.stopLossPrice,
        takeProfitPrice: orderRequest.takeProfitPrice,
        unrealizedPnl: '0',
        margin: requiredMarginUSD,
        lockedMarginSOL: solAmountToLock,
        lockedMarginUSDC: usdcAmountToLock,
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

    // Calculate final PnL in USD
    const realizedPnlUSD = this.calculatePnl(
      position.side,
      position.size,
      position.entryPrice,
      currentPrice,
    );

    // Get SOL price to convert PnL
    const solPrice = await this.priceService.getSolPrice();

    // Distribute PnL proportionally to locked margins
    const totalLockedUSD = this.mathService.add(
      this.mathService.multiply(position.lockedMarginSOL, solPrice),
      position.lockedMarginUSDC,
    );

    if (this.mathService.compare(position.lockedMarginSOL, '0') > 0) {
      const solShare = this.mathService.divide(
        this.mathService.multiply(position.lockedMarginSOL, solPrice),
        totalLockedUSD,
      );
      const solPnL = this.mathService.divide(
        this.mathService.multiply(realizedPnlUSD, solShare),
        solPrice,
      );
      await this.marginService.releaseMargin(
        position.userId,
        TokenType.SOL,
        position.id,
        solPnL,
      );
    }

    if (this.mathService.compare(position.lockedMarginUSDC, '0') > 0) {
      const usdcShare = this.mathService.divide(
        position.lockedMarginUSDC,
        totalLockedUSD,
      );
      const usdcPnL = this.mathService.multiply(realizedPnlUSD, usdcShare);
      await this.marginService.releaseMargin(
        position.userId,
        TokenType.USDC,
        position.id,
        usdcPnL,
      );
    }

    // Close position
    await this.positionRepository.update(position.id, {
      status: PositionStatus.CLOSED,
      closedAt: new Date(),
      closingPrice: currentPrice,
      realizedPnl: realizedPnlUSD,
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

    // Update PnL for both token types if they are locked
    if (this.mathService.compare(position.lockedMarginSOL, '0') > 0) {
      await this.marginService.updateUnrealizedPnl(
        position.userId,
        TokenType.SOL,
        unrealizedPnl,
      );
    }
    if (this.mathService.compare(position.lockedMarginUSDC, '0') > 0) {
      await this.marginService.updateUnrealizedPnl(
        position.userId,
        TokenType.USDC,
        unrealizedPnl,
      );
    }
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

  private async calculateRequiredMargin(order: OrderRequest): Promise<string> {
    const marketPrice = await this.priceService.getCurrentPrice(order.marketId);
    return this.mathService.divide(
      this.mathService.multiply(order.size, marketPrice),
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

    // Calculate realized PnL for the closed portion in USD
    const realizedPnlUSD = this.calculatePnl(
      position.side,
      request.size,
      position.entryPrice,
      request.price || currentPrice,
    );

    // Get SOL price to convert PnL
    const solPrice = await this.priceService.getCurrentPrice('SOL/USD');

    // Calculate proportion of position being closed
    const closeProportion = this.mathService.divide(
      request.size,
      position.size,
    );

    // Calculate margin to release for each token
    const solMarginToRelease = this.mathService.multiply(
      position.lockedMarginSOL,
      closeProportion,
    );
    const usdcMarginToRelease = this.mathService.multiply(
      position.lockedMarginUSDC,
      closeProportion,
    );

    // Calculate total locked value in USD for PnL distribution
    const totalLockedUSD = this.mathService.add(
      this.mathService.multiply(solMarginToRelease, solPrice),
      usdcMarginToRelease,
    );

    // Release proportional margin with PnL for each token
    if (this.mathService.compare(solMarginToRelease, '0') > 0) {
      const solShare = this.mathService.divide(
        this.mathService.multiply(solMarginToRelease, solPrice),
        totalLockedUSD,
      );
      const solPnL = this.mathService.divide(
        this.mathService.multiply(realizedPnlUSD, solShare),
        solPrice,
      );
      await this.marginService.releaseMargin(
        position.userId,
        TokenType.SOL,
        position.id,
        solPnL,
      );
    }

    if (this.mathService.compare(usdcMarginToRelease, '0') > 0) {
      const usdcShare = this.mathService.divide(
        usdcMarginToRelease,
        totalLockedUSD,
      );
      const usdcPnL = this.mathService.multiply(realizedPnlUSD, usdcShare);
      await this.marginService.releaseMargin(
        position.userId,
        TokenType.USDC,
        position.id,
        usdcPnL,
      );
    }

    // Update position
    const updatedPosition = await this.positionRepository.save({
      ...position,
      size: remainingSize,
      lockedMarginSOL: this.mathService.subtract(
        position.lockedMarginSOL,
        solMarginToRelease,
      ),
      lockedMarginUSDC: this.mathService.subtract(
        position.lockedMarginUSDC,
        usdcMarginToRelease,
      ),
      margin: this.mathService.subtract(
        position.margin,
        this.mathService.multiply(position.margin, closeProportion),
      ),
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
      realizedPnl: realizedPnlUSD,
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
