import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Position, PositionStatus } from '../entities/position.entity';
import { Market } from '../entities/market.entity';
import { PriceService } from '../price/price.service';
import { LiquidityService } from '../liquidity/liquidity.service';
import { CacheService } from '../utils/cache.service';
import { CACHE_TTL, getCacheKey } from '../constants/cache.constants';
import { OrderRequest, OrderSide, Trade } from '../types/trade.types';
import { Trade as TradeEntity } from '../entities/trade.entity';
import { MarginService } from '../margin/margin.service';
import { TokenType } from 'src/types/token.types';
import { EventsService } from '../events/events.service';
import { LIQUIDITY_SCALAR, TRADING_FEE } from '../common/config';
import { MarketService } from '../market/market.service';
import { MarginBalance } from 'src/entities/margin-balance.entity';
import {
  abs,
  add,
  compare,
  divide,
  isNegative,
  isPositive,
  isZero,
  lt,
  min,
  multiply,
  subtract,
} from 'src/lib/math';
import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class TradeService {
  private readonly checkInterval = 10000; // 10 seconds

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly priceService: PriceService,
    private readonly liquidityService: LiquidityService,
    private readonly cacheService: CacheService,
    private readonly marginService: MarginService,
    private readonly eventsService: EventsService,
    private readonly marketService: MarketService,
  ) {
    this.startMonitoring();
  }

  // ----------------------------------------------------------------
  // 1) Position Monitoring
  // ----------------------------------------------------------------

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

  private async checkPositionsForStopLossAndTakeProfit(): Promise<void> {
    const positions: Position[] = await this.databaseService.select(
      'positions',
      {
        or: [
          {
            eq: {
              status: 'OPEN',
            },
            notNull: ['stopLossPrice'],
          },
          {
            eq: {
              status: 'OPEN',
            },
            notNull: ['takeProfitPrice'],
          },
        ],
      },
    );

    for (const position of positions) {
      try {
        const currentPrice = await this.priceService.getCurrentPrice(
          position.marketId,
        );

        if (this.shouldTriggerOrderClose(position, currentPrice, 'stopLoss')) {
          await this.closePosition(position.id, position.userId, position.size);
          continue;
        }

        if (
          this.shouldTriggerOrderClose(position, currentPrice, 'takeProfit')
        ) {
          await this.closePosition(position.id, position.userId, position.size);
        }
      } catch (error) {
        console.error(`Error processing position ${position.id}:`, error);
      }
    }
  }

  private shouldTriggerOrderClose(
    position: Position,
    currentPrice: string,
    type: 'stopLoss' | 'takeProfit',
  ): boolean {
    const triggerPrice =
      type === 'stopLoss' ? position.stopLossPrice : position.takeProfitPrice;
    if (!triggerPrice) return false;

    const comparison = compare(currentPrice, triggerPrice);

    if (position.side === OrderSide.LONG) {
      // Long position:
      // - Stop Loss: Close when price falls to/below stop price
      // - Take Profit: Close when price rises to/above take profit price
      return type === 'stopLoss' ? comparison <= 0 : comparison >= 0;
    } else {
      // Short position:
      // - Stop Loss: Close when price rises to/above stop price
      // - Take Profit: Close when price falls to/below take profit price
      return type === 'stopLoss' ? comparison >= 0 : comparison <= 0;
    }
  }

  private validateOrderPrice(
    side: OrderSide,
    entryPrice: string,
    price: string,
    type: 'stopLoss' | 'takeProfit',
  ): void {
    const comparison = compare(price, entryPrice);
    const isInvalid =
      side === OrderSide.LONG
        ? type === 'stopLoss'
          ? comparison >= 0
          : comparison <= 0
        : type === 'stopLoss'
          ? comparison <= 0
          : comparison >= 0;

    if (isInvalid) {
      const direction =
        side === OrderSide.LONG
          ? type === 'stopLoss'
            ? 'below'
            : 'above'
          : type === 'stopLoss'
            ? 'above'
            : 'below';

      throw new Error(
        `${type === 'stopLoss' ? 'Stop loss' : 'Take profit'} price must be ${direction} entry price for ${side.toLowerCase()} positions`,
      );
    }
  }

  // ----------------------------------------------------------------
  // 2) Position Interaction
  // ----------------------------------------------------------------

  async openPosition(orderRequest: OrderRequest): Promise<boolean> {
    try {
      // 1. Validate basic input parameters
      if (!orderRequest || !orderRequest.marketId || !orderRequest.userId) {
        throw new BadRequestException('Invalid order request parameters');
      }
      if (orderRequest.size === '0') {
        throw new BadRequestException('Size must be greater than 0');
      }

      // 2. Fetch market
      let market: Market;
      try {
        market = await this.marketService.getMarketById(orderRequest.marketId);
      } catch (error) {
        throw new InternalServerErrorException(
          `Failed to fetch market: ${error.message}`,
        );
      }
      if (!market) {
        throw new NotFoundException('Market not found');
      }

      // 3. Validate leverage
      const leverage = parseFloat(orderRequest.leverage);
      if (leverage === 0 || leverage > parseFloat(market.maxLeverage)) {
        throw new BadRequestException('Invalid Leverage');
      }

      // 4. Fetch current market price
      let marketPrice: string;
      try {
        marketPrice = await this.priceService.getCurrentPrice(
          orderRequest.marketId,
        );
      } catch {
        throw new InternalServerErrorException('Failed to fetch market price');
      }

      // 5. Calculate entry price with slippage/price impact
      const entryPrice = await this.calculateEntryPrice(
        marketPrice,
        orderRequest,
      );

      // 6. Calculate required margin (USD)
      const requiredMarginUSD =
        await this.calculateRequiredMargin(orderRequest);

      // 7. Get user's margin balance
      let marginBalance: MarginBalance;
      try {
        marginBalance = await this.marginService.getBalance(
          orderRequest.userId,
          orderRequest.token,
        );
      } catch {
        throw new InternalServerErrorException(
          'Failed to fetch margin balance',
        );
      }

      const solPrice = await this.priceService.getSolPrice();

      // 8. Convert available balance to USD if token is SOL
      let availableMarginUSD = marginBalance.availableBalance;
      const isSol = orderRequest.token === TokenType.SOL;
      if (isSol) {
        availableMarginUSD = multiply(availableMarginUSD, solPrice);
      }

      // 9. Check if user has enough margin
      if (compare(availableMarginUSD, requiredMarginUSD) < 0) {
        throw new Error('Insufficient margin');
      }

      // 10. Calculate amount to lock (token-based)
      let amountToLock = requiredMarginUSD;
      if (isSol) {
        amountToLock = divide(requiredMarginUSD, solPrice);
      }

      // 11. Lock margin
      const positionId = crypto.randomUUID();
      try {
        await this.marginService.lockMargin(
          orderRequest.userId,
          orderRequest.token,
          amountToLock,
          positionId,
        );
      } catch {
        throw new InternalServerErrorException('Failed to lock margin');
      }

      // 12. Validate liquidity
      try {
        await this.liquidityService.validateLiquidityForTrade(orderRequest);
      } catch {
        throw new BadRequestException('Insufficient liquidity for trade');
      }

      // 13. Create position
      const [position] = await this.databaseService.insert('positions', {
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
        token: orderRequest.token,
        lockedMarginSOL: isSol ? amountToLock : '0',
        lockedMarginUSDC: !isSol ? amountToLock : '0',
        status: PositionStatus.OPEN,
      });

      // 14. Emit position update event
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

  async closePosition(
    positionId: string,
    userId: string,
    sizeDelta: string,
  ): Promise<Position> {
    try {
      // 1. Validate inputs
      if (!positionId) throw new BadRequestException('Position ID is required');
      if (!userId) throw new BadRequestException('User ID is required');
      if (!sizeDelta) throw new BadRequestException('Size delta is required');

      // 2. Retrieve position
      let position: Position;
      try {
        position = await this.getPosition(positionId);
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        throw new InternalServerErrorException(
          `Failed to fetch position: ${error.message}`,
        );
      }

      // 3. Authorization check
      if (position.userId !== userId) {
        throw new UnauthorizedException(
          'Not authorized to modify this position',
        );
      }

      // 4. Validate close size
      const closeSizeComparison = compare(sizeDelta, position.size);
      if (closeSizeComparison > 0) {
        throw new BadRequestException(
          'Close size must be less than or equal to position size',
        );
      }
      const isPartialClose = closeSizeComparison < 0;
      const isFullClose = closeSizeComparison === 0;

      // 5. Fetch current price
      let currentPrice: string = await this.priceService.getCurrentPrice(
        position.marketId,
      );

      const remainingSize = subtract(position.size, sizeDelta);

      // 6. Calculate realized PnL
      const realizedPnlUSD = this.calculatePnl(
        position.side,
        sizeDelta,
        position.entryPrice,
        currentPrice,
      );

      // 7. Fetch SOL price
      const solPrice = await this.priceService.getSolPrice();

      // 8. Calculate proportions for margin release
      const closeProportion = divide(sizeDelta, position.size);
      const solMarginToRelease = multiply(
        position.lockedMarginSOL,
        closeProportion,
      );
      const usdcMarginToRelease = multiply(
        position.lockedMarginUSDC,
        closeProportion,
      );

      // Total locked value in USD (for distributing PnL across tokens)
      const totalLockedUSD = add(
        multiply(solMarginToRelease, solPrice),
        usdcMarginToRelease,
      );

      // 9. Release margin (and re-lock remaining if partial close)
      try {
        // For SOL
        if (compare(solMarginToRelease, '0') > 0) {
          const solShare = divide(
            multiply(solMarginToRelease, solPrice),
            totalLockedUSD,
          );
          const solPnL = divide(multiply(realizedPnlUSD, solShare), solPrice);

          // Partial close
          if (isPartialClose) {
            const remainingSolMargin = subtract(
              position.lockedMarginSOL,
              solMarginToRelease,
            );

            // Release entire original lock
            await this.marginService.releaseMargin(
              position.userId,
              TokenType.SOL,
              position.id,
              position.lockedMarginSOL,
            );

            // Re-lock remaining
            if (compare(remainingSolMargin, '0') > 0) {
              await this.marginService.lockMargin(
                position.userId,
                TokenType.SOL,
                remainingSolMargin,
                position.id,
              );
            }
          } else {
            // Full close
            await this.marginService.releaseMargin(
              position.userId,
              TokenType.SOL,
              position.id,
              solPnL,
            );
          }
        }

        // For USDC
        if (compare(usdcMarginToRelease, '0') > 0) {
          const usdcShare = divide(usdcMarginToRelease, totalLockedUSD);
          const usdcPnL = multiply(realizedPnlUSD, usdcShare);

          // Partial close
          if (isPartialClose) {
            const remainingUsdcMargin = subtract(
              position.lockedMarginUSDC,
              usdcMarginToRelease,
            );

            // Release entire original lock
            await this.marginService.releaseMargin(
              position.userId,
              TokenType.USDC,
              position.id,
              position.lockedMarginUSDC,
            );

            // Re-lock remaining
            if (compare(remainingUsdcMargin, '0') > 0) {
              await this.marginService.lockMargin(
                position.userId,
                TokenType.USDC,
                remainingUsdcMargin,
                position.id,
              );
            }
          } else {
            // Full close
            await this.marginService.releaseMargin(
              position.userId,
              TokenType.USDC,
              position.id,
              usdcPnL,
            );
          }
        }
      } catch (error) {
        throw new InternalServerErrorException(
          `Failed to release margin: ${error.message}`,
        );
      }

      // 10. Update position in DB
      let updatedPosition: Position;
      try {
        if (isFullClose) {
          [updatedPosition] = await this.databaseService.update(
            'positions',
            {
              ...position,
              status: PositionStatus.CLOSED,
              closedAt: new Date(),
              closingPrice: currentPrice,
              realizedPnl: realizedPnlUSD,
            },
            { id: position.id },
          );
        } else {
          [updatedPosition] = await this.databaseService.update(
            'positions',
            {
              ...position,
              size: remainingSize,
              lockedMarginSOL: subtract(
                position.lockedMarginSOL,
                solMarginToRelease,
              ),
              lockedMarginUSDC: subtract(
                position.lockedMarginUSDC,
                usdcMarginToRelease,
              ),
              margin: subtract(
                position.margin,
                multiply(position.margin, closeProportion),
              ),
            },
            { id: position.id },
          );
        }
      } catch (error) {
        throw new InternalServerErrorException(
          `Failed to update position: ${error.message}`,
        );
      }

      // 11. Record the trade
      try {
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
          isPartialClose,
        });
      } catch (error) {
        throw new InternalServerErrorException(
          `Failed to record trade: ${error.message}`,
        );
      }

      // 12. Emit position update event (non-critical)
      try {
        this.eventsService.emitPositionsUpdate();
      } catch (error) {
        console.error('Failed to emit position update:', error);
      }

      return updatedPosition;
    } catch (error) {
      console.error('Error in closePosition:', error);

      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof UnauthorizedException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        `Failed to close position: ${error.message}`,
      );
    }
  }

  async editStopLoss(
    positionId: string,
    userId: string,
    stopLossPrice: string | null,
  ): Promise<Position> {
    try {
      const position = await this.getPosition(positionId);

      if (!position) {
        throw new NotFoundException(`Position ${positionId} not found`);
      }

      if (position.userId !== userId) {
        throw new UnauthorizedException(
          'Not authorized to modify this position',
        );
      }

      if (position.status !== PositionStatus.OPEN) {
        throw new BadRequestException(
          'Cannot edit stop loss of a closed position',
        );
      }

      // If stopLossPrice is null, we're removing the stop loss
      if (stopLossPrice !== null) {
        try {
          this.validateOrderPrice(
            position.side,
            position.entryPrice,
            stopLossPrice,
            'stopLoss',
          );
        } catch (error) {
          throw new BadRequestException(error.message);
        }
      }

      // Update position
      const [updatedPosition] = await this.databaseService.update(
        'positions',
        {
          ...position,
          stopLossPrice,
        },
        { id: position.id },
      );

      await this.invalidatePositionCache(positionId, userId);
      this.eventsService.emitPositionsUpdate();

      return updatedPosition;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to edit stop loss');
    }
  }

  async editTakeProfit(
    positionId: string,
    userId: string,
    takeProfitPrice: string | null,
  ): Promise<Position> {
    try {
      const position = await this.getPosition(positionId);

      if (!position) {
        throw new NotFoundException(`Position ${positionId} not found`);
      }

      if (position.userId !== userId) {
        throw new UnauthorizedException(
          'Not authorized to modify this position',
        );
      }

      if (position.status !== PositionStatus.OPEN) {
        throw new BadRequestException(
          'Cannot edit take profit of a closed position',
        );
      }

      // If takeProfitPrice is null, we're removing the take profit
      if (takeProfitPrice !== null) {
        try {
          this.validateOrderPrice(
            position.side,
            position.entryPrice,
            takeProfitPrice,
            'takeProfit',
          );
        } catch (error) {
          throw new BadRequestException(error.message);
        }
      }

      // Update position
      const [updatedPosition] = await this.databaseService.update(
        'positions',
        {
          ...position,
          takeProfitPrice,
        },
        { id: position.id },
      );

      await this.invalidatePositionCache(positionId, userId);
      this.eventsService.emitPositionsUpdate();

      return updatedPosition;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to edit take profit');
    }
  }

  async editMargin(
    positionId: string,
    userId: string,
    marginDelta: string,
  ): Promise<Position> {
    try {
      const position = await this.getPosition(positionId);

      if (!position) {
        throw new NotFoundException(`Position ${positionId} not found`);
      }

      if (position.userId !== userId) {
        throw new UnauthorizedException(
          'Not authorized to modify this position',
        );
      }

      if (position.status !== PositionStatus.OPEN) {
        throw new BadRequestException(
          'Cannot edit margin of a closed position',
        );
      }

      const market = await this.marketService.getMarketById(position.marketId);

      if (!market) {
        throw new NotFoundException('Market not found');
      }

      const newMargin = add(position.margin, marginDelta);

      // Check if withdrawal would exceed max leverage
      if (compare(marginDelta, '0') < 0) {
        const newLeverage = divide(position.size, newMargin);
        if (compare(newLeverage, market.maxLeverage) > 0) {
          throw new BadRequestException(
            'Withdrawal would exceed maximum leverage',
          );
        }
      } else {
        // Check if deposit would go below 1x leverage
        const newLeverage = divide(position.size, newMargin);
        if (compare(newLeverage, '1') < 0) {
          throw new BadRequestException(
            'Deposit would result in leverage below 1x',
          );
        }

        // Check if user has sufficient margin for deposit
        const [solBalance, usdcBalance] = await Promise.all([
          this.marginService.getBalance(userId, TokenType.SOL),
          this.marginService.getBalance(userId, TokenType.USDC),
        ]);

        const solPrice = await this.priceService.getSolPrice();
        const solBalanceInUSD = multiply(solBalance.availableBalance, solPrice);
        const totalAvailableUSD = add(
          solBalanceInUSD,
          usdcBalance.availableBalance,
        );

        if (compare(totalAvailableUSD, marginDelta) < 0) {
          throw new BadRequestException(
            'Insufficient margin available for deposit',
          );
        }
      }

      // Calculate proportions for SOL and USDC based on current locked amounts
      const totalLockedUSD = add(
        multiply(
          position.lockedMarginSOL,
          await this.priceService.getSolPrice(),
        ),
        position.lockedMarginUSDC,
      );

      const solProportion = divide(
        multiply(
          position.lockedMarginSOL,
          await this.priceService.getSolPrice(),
        ),
        totalLockedUSD,
      );

      const solPrice = await this.priceService.getSolPrice();
      const marginDeltaSOL = divide(
        multiply(marginDelta, solProportion),
        solPrice,
      );
      const marginDeltaUSDC = multiply(
        marginDelta,
        subtract('1', solProportion),
      );

      // Handle margin adjustments
      if (compare(marginDelta, '0') > 0) {
        // Deposit
        if (compare(marginDeltaSOL, '0') > 0) {
          await this.marginService.lockMargin(
            userId,
            TokenType.SOL,
            marginDeltaSOL,
            positionId,
          );
        }
        if (compare(marginDeltaUSDC, '0') > 0) {
          await this.marginService.lockMargin(
            userId,
            TokenType.USDC,
            marginDeltaUSDC,
            positionId,
          );
        }
      } else {
        // Withdrawal
        if (compare(marginDeltaSOL, '0') < 0) {
          await this.marginService.releaseMargin(
            userId,
            TokenType.SOL,
            positionId,
            abs(marginDeltaSOL),
          );
        }
        if (compare(marginDeltaUSDC, '0') < 0) {
          await this.marginService.releaseMargin(
            userId,
            TokenType.USDC,
            positionId,
            abs(marginDeltaUSDC),
          );
        }
      }

      // Update position
      const [updatedPosition] = await this.databaseService.update(
        'positions',
        {
          ...position,
          margin: newMargin,
          lockedMarginSOL: add(position.lockedMarginSOL, marginDeltaSOL),
          lockedMarginUSDC: add(position.lockedMarginUSDC, marginDeltaUSDC),
        },
        { id: position.id },
      );

      await this.invalidatePositionCache(positionId, userId);
      this.eventsService.emitPositionsUpdate();

      return updatedPosition;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to edit position margin');
    }
  }

  // ----------------------------------------------------------------
  // 3) Helper Functions
  // ----------------------------------------------------------------

  private async calculateEntryPrice(
    marketPrice: string,
    order: OrderRequest,
  ): Promise<string> {
    try {
      if (!marketPrice || !order) {
        throw new BadRequestException(
          'Market price and order details are required',
        );
      }

      // Get market details
      const market = await this.marketService.getMarketById(order.marketId);

      if (!market) {
        throw new NotFoundException('Market not found');
      }

      // Calculate price impact
      const priceImpact = await this.calculatePriceImpact(order, market);

      // Calculate slippage
      const slippagePercentage = this.calculateSlippage(order.size);
      const slippageMultiplier =
        order.side === OrderSide.LONG
          ? add('1', slippagePercentage)
          : subtract('1', slippagePercentage);

      // Apply both price impact and slippage
      const impactedPrice = multiply(marketPrice, add('1', priceImpact));
      return multiply(impactedPrice, slippageMultiplier);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to calculate entry price');
    }
  }

  private async calculatePriceImpact(
    order: OrderRequest,
    market: Market,
  ): Promise<string> {
    try {
      // Calculate skew and OI
      const initialSkew = subtract(
        market.longOpenInterest,
        market.shortOpenInterest,
      );
      const initialTotalOI = add(
        market.longOpenInterest,
        market.shortOpenInterest,
      );

      // Calculate updated state after trade
      const updatedLongOI =
        order.side === OrderSide.LONG
          ? add(market.longOpenInterest, order.size)
          : market.longOpenInterest;
      const updatedShortOI =
        order.side === OrderSide.SHORT
          ? add(market.shortOpenInterest, order.size)
          : market.shortOpenInterest;
      const updatedSkew = subtract(updatedLongOI, updatedShortOI);
      const updatedTotalOI = add(updatedLongOI, updatedShortOI);

      // Check if skew flips direction
      const skewFlipped =
        (isNegative(initialSkew) && isPositive(updatedSkew)) ||
        (isPositive(initialSkew) && isNegative(updatedSkew));

      let priceImpactUsd: string;

      if (skewFlipped) {
        const equilibriumSize = abs(initialSkew);
        const sizeToEquilibrium = min(order.size, equilibriumSize);
        const remainingSize = subtract(order.size, sizeToEquilibrium);
        const equilibriumTotalOI = add(initialTotalOI, sizeToEquilibrium);

        // Calculate positive impact up to equilibrium
        const positiveImpact = this.calculateImpactComponent(
          sizeToEquilibrium,
          '0',
          initialSkew,
          initialTotalOI,
          equilibriumTotalOI,
          this.getAvailableOI(
            market,
            order.side === OrderSide.LONG ? OrderSide.SHORT : OrderSide.LONG,
          ),
          LIQUIDITY_SCALAR,
        );

        // Calculate negative impact beyond equilibrium (if any)
        const negativeImpact = isZero(remainingSize)
          ? '0'
          : this.calculateImpactComponent(
              remainingSize,
              updatedSkew,
              '0',
              equilibriumTotalOI,
              updatedTotalOI,
              this.getAvailableOI(market, order.side),
              LIQUIDITY_SCALAR,
            );

        priceImpactUsd = subtract(positiveImpact, negativeImpact);
      } else {
        priceImpactUsd = this.calculateImpactComponent(
          order.size,
          updatedSkew,
          initialSkew,
          initialTotalOI,
          updatedTotalOI,
          this.getAvailableOI(market, order.side),
          LIQUIDITY_SCALAR,
        );
      }

      // Handle impact pool
      const finalImpactUsd =
        order.side === OrderSide.LONG
          ? multiply(priceImpactUsd, '-1')
          : priceImpactUsd;

      // Update impact pool and return capped impact
      if (isPositive(finalImpactUsd)) {
        const cappedImpact = min(finalImpactUsd, market.impactPool);
        await this.marketService.updateMarket(market.id, {
          impactPool: subtract(market.impactPool, cappedImpact),
        });
        return cappedImpact;
      }

      await this.marketService.updateMarket(market.id, {
        impactPool: add(market.impactPool, abs(finalImpactUsd)),
      });
      return finalImpactUsd;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to calculate price impact',
      );
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

      if (compare(order.leverage, '0') <= 0) {
        throw new BadRequestException('Leverage must be greater than 0');
      }

      return divide(order.size, order.leverage);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to calculate required margin',
      );
    }
  }

  private calculateImpactComponent(
    sizeDeltaUsd: string,
    updatedSkew: string,
    initialSkew: string,
    initialTotalOI: string,
    updatedTotalOI: string,
    availableOI: string,
    priceImpactScalar: string,
  ): string {
    if (isZero(updatedTotalOI)) return '0';

    // Calculate skew factor
    const skewFactor = isZero(initialTotalOI)
      ? divide(abs(updatedSkew), updatedTotalOI)
      : subtract(
          divide(abs(initialSkew), initialTotalOI),
          divide(abs(updatedSkew), updatedTotalOI),
        );

    let priceImpactUsd = multiply(sizeDeltaUsd, skewFactor);

    // Apply liquidity factor (minimum 1%)
    let liquidityFactor = divide(sizeDeltaUsd, availableOI);
    if (lt(liquidityFactor, '0.01')) {
      liquidityFactor = '0.01';
    }

    return multiply(
      multiply(priceImpactUsd, liquidityFactor),
      priceImpactScalar,
    );
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
          ? subtract(currentPrice, entryPrice)
          : subtract(entryPrice, currentPrice);

      return multiply(size, priceDiff);
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

      return min('0.01', divide(size, '1000000'));
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

      const notionalValue = multiply(size, price);
      return multiply(notionalValue, '0.0005'); // 0.05% fee
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

      await this.databaseService.insert('trades', trade);

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

  // ----------------------------------------------------------------
  // 4) Getter Functions
  // ----------------------------------------------------------------

  async getPosition(positionId: string): Promise<Position> {
    try {
      if (!positionId) {
        throw new BadRequestException('Position ID is required');
      }

      return this.cacheService.wrap(
        getCacheKey.position(positionId),
        async () => {
          const [position] = await this.databaseService.select<Position>(
            'positions',
            {
              eq: { id: positionId },
            },
          );

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
          const positions = await this.databaseService.select<Position>(
            'positions',
            {
              eq: { userId },
              order: { column: 'createdAt', ascending: false },
            },
          );

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

  private getAvailableOI(market: Market, side: OrderSide): string {
    return subtract(
      market.maxLeverage,
      side === OrderSide.LONG
        ? market.longOpenInterest
        : market.shortOpenInterest,
    );
  }

  async getPositionTrades(positionId: string): Promise<TradeEntity[]> {
    try {
      if (!positionId) {
        throw new BadRequestException('Position ID is required');
      }

      return this.cacheService.wrap(
        getCacheKey.positionTrades(positionId),
        async () => {
          const trades = await this.databaseService.select<TradeEntity>(
            'trades',
            {
              eq: { positionId },
              order: { column: 'createdAt', ascending: false },
            },
          );

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
          const trades = await this.databaseService.select<TradeEntity>(
            'trades',
            {
              eq: { userId },
              order: { column: 'createdAt', ascending: false },
            },
          );

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
