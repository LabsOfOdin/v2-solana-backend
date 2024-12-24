import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Position, PositionStatus } from '../entities/position.entity';
import { Market } from '../entities/market.entity';
import { PriceService } from '../price/price.service';
import { LiquidityService } from '../liquidity/liquidity.service';
import { MathService } from '../utils/math.service';
import { CacheService } from '../utils/cache.service';
import { CACHE_TTL, getCacheKey } from '../constants/cache.constants';
import {
  OrderRequest,
  OrderSide,
  Trade,
  UpdatePositionRequest,
  OrderType,
} from '../types/trade.types';
import { Trade as TradeEntity } from '../entities/trade.entity';
import { MarginService } from '../margin/margin.service';
import { TokenType } from '../margin/types/token.types';
import { EventsService } from '../events/events.service';

@Injectable()
export class TradeService {
  private readonly checkInterval = 10000; // 10 seconds

  constructor(
    @InjectRepository(Position)
    private readonly positionRepository: Repository<Position>,
    @InjectRepository(TradeEntity)
    private readonly tradeRepository: Repository<TradeEntity>,
    @InjectRepository(Market)
    private readonly marketRepository: Repository<Market>,
    private readonly priceService: PriceService,
    private readonly liquidityService: LiquidityService,
    private readonly mathService: MathService,
    private readonly cacheService: CacheService,
    private readonly marginService: MarginService,
    private readonly eventsService: EventsService,
  ) {
    this.startMonitoring();
  }

  private async startMonitoring() {
    setInterval(async () => {
      try {
        await this.checkPositionsForStopLossAndTakeProfit();
      } catch (error) {
        console.error('Error in position monitoring:', error);
        // Don't throw here as this is a background process
      }
    }, this.checkInterval);
  }

  async openPosition(orderRequest: OrderRequest): Promise<boolean> {
    try {
      if (!orderRequest || !orderRequest.marketId || !orderRequest.userId) {
        throw new BadRequestException('Invalid order request parameters');
      }

      if (orderRequest.size === '0') {
        throw new BadRequestException('Size must be greater than 0');
      }

      // Get market details to get the symbol
      const market = await this.marketRepository.findOne({
        where: { id: orderRequest.marketId },
      });

      if (!market) {
        throw new NotFoundException('Market not found');
      }

      const leverage = parseFloat(orderRequest.leverage);

      if (leverage === 0 || leverage > parseFloat(market.maxLeverage)) {
        throw new BadRequestException('Invalid Leverage');
      }

      // 1. Get current market price and calculate entry price with slippage
      const marketPrice = await this.priceService
        .getCurrentPrice(orderRequest.marketId)
        .catch(() => {
          throw new InternalServerErrorException(
            'Failed to fetch market price',
          );
        });

      const entryPrice = this.calculateEntryPrice(marketPrice, orderRequest);

      // 2. Calculate required margin in USD
      const requiredMarginUSD =
        await this.calculateRequiredMargin(orderRequest);

      // 3. Get margin balances for supported tokens
      const [solBalance, usdcBalance] = await Promise.all([
        this.marginService.getBalance(orderRequest.userId, TokenType.SOL),
        this.marginService.getBalance(orderRequest.userId, TokenType.USDC),
      ]).catch(() => {
        throw new InternalServerErrorException(
          'Failed to fetch margin balances',
        );
      });

      // 4. Convert SOL balance to USD for comparison
      const solPrice = await this.priceService.getSolPrice();
      const solBalanceInUSD = this.mathService.multiply(
        solBalance.availableBalance,
        solPrice,
      );

      // 5. Calculate how much of each token to lock based on their USD values
      let solAmountToLock = '0';
      let usdcAmountToLock = '0';

      const totalAvailableUSD = this.mathService.add(
        solBalanceInUSD,
        usdcBalance.availableBalance,
      );

      if (this.mathService.compare(totalAvailableUSD, requiredMarginUSD) < 0) {
        throw new Error('Insufficient margin');
      }

      // First try to use a single token (USDC first, then SOL)
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
        // If no single token has enough, use both tokens
        usdcAmountToLock = usdcBalance.availableBalance;
        const remainingMarginUSD = this.mathService.subtract(
          requiredMarginUSD,
          usdcBalance.availableBalance,
        );
        solAmountToLock = this.mathService.divide(remainingMarginUSD, solPrice);
      }

      // 6. Lock margins
      const positionId = crypto.randomUUID();
      try {
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
      } catch (error) {
        throw new InternalServerErrorException('Failed to lock margin');
      }

      // 7. Check liquidity pool capacity
      try {
        await this.liquidityService.validateLiquidityForTrade(orderRequest);
      } catch (error) {
        throw new BadRequestException('Insufficient liquidity for trade');
      }

      // 8. Create position
      const position = await this.positionRepository.save(
        this.positionRepository.create({
          id: positionId,
          userId: orderRequest.userId,
          marketId: orderRequest.marketId,
          symbol: market.symbol,
          side: orderRequest.side,
          size: orderRequest.size,
          entryPrice,
          leverage: orderRequest.leverage,
          stopLossPrice: orderRequest.stopLossPrice,
          takeProfitPrice: orderRequest.takeProfitPrice,
          margin: requiredMarginUSD,
          lockedMarginSOL: solAmountToLock,
          lockedMarginUSDC: usdcAmountToLock,
          status: PositionStatus.OPEN,
        }),
      );

      // Emit position update event
      this.eventsService.emitPositionsUpdate();

      return position.status === PositionStatus.OPEN;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to open position');
    }
  }

  async updatePosition(
    positionId: string,
    userId: string,
    updates: UpdatePositionRequest,
  ): Promise<Position> {
    try {
      const position = await this.getPosition(positionId);

      if (!position) {
        throw new NotFoundException(`Position ${positionId} not found`);
      }

      if (position.userId !== userId) {
        throw new UnauthorizedException(
          'Not authorized to update this position',
        );
      }

      // Validate stop loss and take profit prices
      if (updates.stopLossPrice) {
        try {
          this.validateStopLossPrice(
            position.side,
            position.entryPrice,
            updates.stopLossPrice,
          );
        } catch (error) {
          throw new BadRequestException(error.message);
        }
      }

      if (updates.takeProfitPrice) {
        try {
          this.validateTakeProfitPrice(
            position.side,
            position.entryPrice,
            updates.takeProfitPrice,
          );
        } catch (error) {
          throw new BadRequestException(error.message);
        }
      }

      await this.positionRepository.update(positionId, updates);
      await this.invalidatePositionCache(positionId, userId);

      // Emit position update event
      this.eventsService.emitPositionsUpdate();

      return this.getPosition(positionId);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to update position');
    }
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
          await this.closePosition(position.id, position.userId, position.size);
          continue;
        }

        if (this.shouldTriggerTakeProfit(position, currentPrice)) {
          await this.closePosition(position.id, position.userId, position.size);
        }
      } catch (error) {
        console.error(`Error processing position ${position.id}:`, error);
      }
    }
  }

  /**
   * @audit To implement.
   */
  private async updateTrailingStop(
    position: Position,
    currentPrice: string,
  ): Promise<void> {
    if (!position.trailingStopDistance) return;

    if (position.side === OrderSide.LONG) {
      // For longs, update stop loss based on current price and trailing distance
      const newStopPrice = this.mathService.subtract(
        currentPrice,
        position.trailingStopDistance,
      );
      if (
        !position.stopLossPrice ||
        this.mathService.compare(newStopPrice, position.stopLossPrice) > 0
      ) {
        await this.positionRepository.update(position.id, {
          stopLossPrice: newStopPrice,
        });
      }
    } else {
      // For shorts, update stop loss based on current price and trailing distance
      const newStopPrice = this.mathService.add(
        currentPrice,
        position.trailingStopDistance,
      );
      if (
        !position.stopLossPrice ||
        this.mathService.compare(newStopPrice, position.stopLossPrice) < 0
      ) {
        await this.positionRepository.update(position.id, {
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

  async closePosition(
    positionId: string,
    userId: string,
    sizeDelta: string,
  ): Promise<Position> {
    try {
      if (!sizeDelta) {
        throw new BadRequestException('Size delta is required');
      }

      const position = await this.getPosition(positionId);

      if (!position) {
        throw new NotFoundException(`Position ${positionId} not found`);
      }

      if (position.userId !== userId) {
        throw new UnauthorizedException(
          'Not authorized to modify this position',
        );
      }

      // Validate close size
      if (this.mathService.compare(sizeDelta, position.size) > 0) {
        throw new BadRequestException(
          'Close size must be less than or equal to position size',
        );
      }

      const currentPrice = await this.priceService.getCurrentPrice(
        position.marketId,
      );
      const remainingSize = this.mathService.subtract(position.size, sizeDelta);

      // Calculate realized PnL for the closed portion in USD
      const realizedPnlUSD = this.calculatePnl(
        position.side,
        sizeDelta,
        position.entryPrice,
        currentPrice,
      );

      // Get SOL price to convert PnL
      const solPrice = await this.priceService.getSolPrice();

      // Calculate proportion of position being closed
      const closeProportion = this.mathService.divide(sizeDelta, position.size);

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

      // If closing entire position
      if (this.mathService.compare(sizeDelta, position.size) === 0) {
        const closedPosition = await this.positionRepository.save({
          ...position,
          status: PositionStatus.CLOSED,
          closedAt: new Date(),
          closingPrice: currentPrice,
          realizedPnl: realizedPnlUSD,
        });

        // Emit position update event
        this.eventsService.emitPositionsUpdate();

        return closedPosition;
      }

      // Update position for partial close
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
      });

      // Record the trade
      await this.recordTrade({
        id: crypto.randomUUID(),
        positionId: position.id,
        userId: position.userId,
        marketId: position.marketId,
        side:
          position.side === OrderSide.LONG ? OrderSide.SHORT : OrderSide.LONG,
        size: sizeDelta,
        price: currentPrice,
        leverage: position.leverage,
        realizedPnl: realizedPnlUSD,
        fee: this.calculateFee(sizeDelta, currentPrice),
        createdAt: new Date(),
        type: OrderType.MARKET,
        isPartialClose: this.mathService.compare(sizeDelta, position.size) < 0,
      });

      // Emit position update event
      this.eventsService.emitPositionsUpdate();

      return updatedPosition;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to close position');
    }
  }

  async getPosition(positionId: string): Promise<Position> {
    try {
      if (!positionId) {
        throw new BadRequestException('Position ID is required');
      }

      return this.cacheService.wrap(
        getCacheKey.position(positionId),
        async () => {
          const position = await this.positionRepository
            .findOne({
              where: { id: positionId },
            })
            .catch(() => {
              throw new InternalServerErrorException(
                'Failed to fetch position',
              );
            });

          if (!position) {
            throw new NotFoundException(`Position ${positionId} not found`);
          }

          return position;
        },
        CACHE_TTL.POSITION,
      );
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to get position');
    }
  }

  async getUserPositions(userId: string): Promise<Position[]> {
    try {
      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      return this.cacheService.wrap(
        getCacheKey.userPositions(userId),
        async () => {
          const positions = await this.positionRepository
            .find({
              where: { userId },
              order: { createdAt: 'DESC' },
            })
            .catch(() => {
              throw new InternalServerErrorException(
                'Failed to fetch user positions',
              );
            });

          return positions;
        },
        CACHE_TTL.POSITION,
      );
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to get user positions');
    }
  }

  // E.g $5 size, 2x leverage = $2.5 margin
  private async calculateRequiredMargin(order: OrderRequest): Promise<string> {
    try {
      if (!order.size || !order.leverage) {
        throw new BadRequestException(
          'Size and leverage are required for margin calculation',
        );
      }

      if (this.mathService.compare(order.leverage, '0') <= 0) {
        throw new BadRequestException('Leverage must be greater than 0');
      }

      return this.mathService.divide(order.size, order.leverage);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to calculate required margin',
      );
    }
  }

  private calculateEntryPrice(
    marketPrice: string,
    order: OrderRequest,
  ): string {
    try {
      if (!marketPrice || !order) {
        throw new BadRequestException(
          'Market price and order details are required',
        );
      }

      const slippagePercentage = this.calculateSlippage(order.size);
      const slippageMultiplier =
        order.side === OrderSide.LONG
          ? this.mathService.add('1', slippagePercentage)
          : this.mathService.subtract('1', slippagePercentage);

      return this.mathService.multiply(marketPrice, slippageMultiplier);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to calculate entry price');
    }
  }

  private calculatePnl(
    side: OrderSide,
    size: string,
    entryPrice: string,
    currentPrice: string,
  ): string {
    try {
      if (!side || !size || !entryPrice || !currentPrice) {
        throw new BadRequestException(
          'Missing required parameters for PnL calculation',
        );
      }

      const priceDiff =
        side === OrderSide.LONG
          ? this.mathService.subtract(currentPrice, entryPrice)
          : this.mathService.subtract(entryPrice, currentPrice);

      return this.mathService.multiply(size, priceDiff);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to calculate PnL');
    }
  }

  private calculateSlippage(size: string): string {
    try {
      if (!size) {
        throw new BadRequestException(
          'Size is required for slippage calculation',
        );
      }

      return this.mathService.min(
        '0.01',
        this.mathService.divide(size, '1000000'),
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to calculate slippage');
    }
  }

  private calculateFee(size: string, price: string): string {
    try {
      if (!size || !price) {
        throw new BadRequestException(
          'Size and price are required for fee calculation',
        );
      }

      const notionalValue = this.mathService.multiply(size, price);
      return this.mathService.multiply(notionalValue, '0.0005'); // 0.05% fee
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to calculate fee');
    }
  }

  async recordTrade(trade: Trade): Promise<void> {
    try {
      if (!trade || !trade.positionId || !trade.userId) {
        throw new BadRequestException('Invalid trade data');
      }

      await this.tradeRepository
        .save(this.tradeRepository.create(trade))
        .catch(() => {
          throw new InternalServerErrorException('Failed to save trade');
        });

      await this.invalidatePositionCache(trade.positionId, trade.userId);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to record trade');
    }
  }

  async getPositionTrades(positionId: string): Promise<TradeEntity[]> {
    try {
      if (!positionId) {
        throw new BadRequestException('Position ID is required');
      }

      return this.cacheService.wrap(
        getCacheKey.positionTrades(positionId),
        async () => {
          const trades = await this.tradeRepository
            .find({
              where: { positionId },
              order: { createdAt: 'DESC' },
            })
            .catch(() => {
              throw new InternalServerErrorException(
                'Failed to fetch position trades',
              );
            });

          return trades;
        },
        CACHE_TTL.TRADE_HISTORY,
      );
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to get position trades');
    }
  }

  async getUserTrades(userId: string): Promise<TradeEntity[]> {
    try {
      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      return this.cacheService.wrap(
        getCacheKey.userTrades(userId),
        async () => {
          const trades = await this.tradeRepository
            .find({
              where: { userId },
              order: { createdAt: 'DESC' },
            })
            .catch(() => {
              throw new InternalServerErrorException(
                'Failed to fetch user trades',
              );
            });

          return trades;
        },
        CACHE_TTL.TRADE_HISTORY,
      );
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to get user trades');
    }
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
    try {
      if (!positionId) {
        throw new BadRequestException('Position ID is required');
      }

      return this.cacheService.wrap(
        getCacheKey.borrowingHistory(positionId, startTime, endTime),
        async () => {
          const position = await this.getPosition(positionId);
          const start = startTime ? new Date(startTime) : position.createdAt;
          const end = endTime ? new Date(endTime) : new Date();

          if (start > end) {
            throw new BadRequestException('Start time must be before end time');
          }

          const history = [];
          let currentTime = new Date(start);

          while (currentTime <= end) {
            try {
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
            } catch (error) {
              console.error('Error calculating borrowing fee:', error);
              // Continue to next iteration even if there's an error
              currentTime = new Date(currentTime.getTime() + 60 * 60 * 1000);
            }
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
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to get borrowing history');
    }
  }

  private async invalidatePositionCache(
    positionId: string,
    userId: string,
  ): Promise<void> {
    try {
      if (!positionId || !userId) {
        throw new BadRequestException(
          'Position ID and User ID are required for cache invalidation',
        );
      }

      const keys = [
        getCacheKey.position(positionId),
        getCacheKey.positionTrades(positionId),
        getCacheKey.userPositions(userId),
        getCacheKey.userTrades(userId),
      ];

      await this.cacheService.delMultiple(keys).catch(() => {
        throw new InternalServerErrorException('Failed to invalidate cache');
      });
    } catch (error) {
      // Log the error but don't throw since this is an internal operation
      console.error('Error invalidating position cache:', error);
    }
  }
}
