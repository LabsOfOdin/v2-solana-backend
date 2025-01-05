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
import { CacheService } from '../utils/cache.service';
import { CACHE_TTL, getCacheKey } from '../constants/cache.constants';
import { OrderRequest, OrderSide, Trade } from '../types/trade.types';
import { Trade as TradeEntity } from '../entities/trade.entity';
import { MarginService } from '../margin/margin.service';
import { TokenType } from 'src/types/token.types';
import { EventsService } from '../events/events.service';
import { TRADING_FEE } from '../common/config';
import { MarketService } from '../market/market.service';
import { abs, add, compare, divide, multiply, subtract } from 'src/lib/math';
import { DatabaseService } from 'src/database/database.service';
import { StatsService } from '../stats/stats.service';
import { calculatePnlUSD } from 'src/lib/calculatePnlUsd';

@Injectable()
export class TradeService {
  private readonly checkInterval = 10000; // 10 seconds

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly priceService: PriceService,
    private readonly cacheService: CacheService,
    private readonly marginService: MarginService,
    private readonly eventsService: EventsService,
    private readonly marketService: MarketService,
    private readonly statsService: StatsService,
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
    const positionsWithStopLosses: Position[] =
      await this.databaseService.select('positions', {
        and: [
          { status: 'OPEN' },
          {
            stopLossPrice: { notNull: true },
          },
        ],
      });

    const positionsWithTakeProfits: Position[] =
      await this.databaseService.select('positions', {
        and: [{ status: 'OPEN' }, { takeProfitPrice: { notNull: true } }],
      });

    await Promise.all([
      ...positionsWithStopLosses.map(async (position) => {
        try {
          const currentPrice = await this.priceService.getCurrentPrice(
            position.marketId,
          );

          if (
            this.shouldTriggerOrderClose(position, currentPrice, 'stopLoss')
          ) {
            await this.closePosition(
              position.id,
              position.userId,
              position.size,
            );
          }
        } catch (error) {
          console.error(`Error processing position ${position.id}:`, error);
        }
      }),
      ...positionsWithTakeProfits.map(async (position) => {
        try {
          const currentPrice = await this.priceService.getCurrentPrice(
            position.marketId,
          );

          if (
            this.shouldTriggerOrderClose(position, currentPrice, 'takeProfit')
          ) {
            await this.closePosition(
              position.id,
              position.userId,
              position.size,
            );
          }
        } catch (error) {
          console.error(`Error processing position ${position.id}:`, error);
        }
      }),
    ]);
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
      // PART 1: Validations and Data Gathering
      // -------------------------------------

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

      // 3. Validate leverage and liquidity
      const leverage = parseFloat(orderRequest.leverage);

      if (leverage === 0 || leverage > parseFloat(market.maxLeverage)) {
        throw new BadRequestException('Invalid Leverage');
      }

      const currentOpenInterest =
        Number(market.longOpenInterest) + Number(market.shortOpenInterest);

      if (
        Number(orderRequest.size) + currentOpenInterest >
        Number(market.availableLiquidity)
      ) {
        throw new BadRequestException('Insufficient liquidity');
      }

      // PART 2: Calculations and Price Checks
      // -------------------------------------

      // 4. Calculate entry price using virtual AMM and check slippage
      const { executionPrice, priceImpact } =
        await this.priceService.previewPrice(
          market.id,
          orderRequest.side,
          orderRequest.size,
        );

      // Check if slippage is within acceptable bounds
      const slippagePercentage = abs(priceImpact);
      if (compare(slippagePercentage, orderRequest.maxSlippage) > 0) {
        throw new BadRequestException('Slippage exceeds maximum allowed');
      }

      // 5. Calculate required margin and validate user's balance
      const requiredMarginUSD =
        await this.calculateRequiredMargin(orderRequest);
      const marginBalance = await this.marginService.getBalance(
        orderRequest.userId,
        orderRequest.token,
      );
      const solPrice = await this.priceService.getSolPrice();

      // 6. Convert and validate available balance
      let availableMarginUSD = marginBalance.availableBalance;
      const isSol = orderRequest.token === TokenType.SOL;
      if (isSol) {
        availableMarginUSD = multiply(availableMarginUSD, solPrice);
      }

      if (compare(availableMarginUSD, requiredMarginUSD) < 0) {
        throw new Error('Insufficient margin');
      }

      // 7. Calculate amount to lock
      let amountToLock = requiredMarginUSD;
      if (isSol) {
        amountToLock = divide(requiredMarginUSD, solPrice);
      }

      // 8. Calculate fees for opening position
      const fee = this.calculateFee(orderRequest.size, isSol ? solPrice : 1);

      // 9. Subtract fee from amount to lock
      amountToLock = subtract(amountToLock, fee);

      // PART 3: Database Updates (all or nothing)
      // -------------------------------------

      const positionId = crypto.randomUUID();

      // 1. Subtract fee from the user's margin balance
      await this.marginService.deductMargin(
        orderRequest.userId,
        orderRequest.token,
        fee,
      );

      // 2. Increase the accumulated fees in storage
      await this.marketService.addTradingFees(
        market.id,
        fee,
        orderRequest.token,
      );

      // 3. Lock margin
      await this.marginService.lockMargin(
        orderRequest.userId,
        orderRequest.token,
        amountToLock,
        positionId,
      );

      // 4. Update virtual AMM state and market's open interest
      await this.marketService.updateVirtualReserves(
        market.id,
        orderRequest.side,
        orderRequest.size,
      );

      await this.marketService.updateMarket(market.id, {
        longOpenInterest:
          orderRequest.side === OrderSide.LONG
            ? add(market.longOpenInterest, orderRequest.size)
            : market.longOpenInterest,
        shortOpenInterest:
          orderRequest.side === OrderSide.SHORT
            ? add(market.shortOpenInterest, orderRequest.size)
            : market.shortOpenInterest,
      });

      // 5. Create position
      const [position] = await this.databaseService.insert('positions', {
        id: positionId,
        userId: orderRequest.userId,
        marketId: orderRequest.marketId,
        symbol: market.symbol,
        side: orderRequest.side,
        size: orderRequest.size,
        entryPrice: executionPrice,
        leverage: orderRequest.leverage,
        stopLossPrice: orderRequest.stopLossPrice,
        takeProfitPrice: orderRequest.takeProfitPrice,
        margin: requiredMarginUSD,
        token: orderRequest.token,
        lockedMarginSOL: isSol ? amountToLock : '0',
        lockedMarginUSDC: !isSol ? amountToLock : '0',
        status: PositionStatus.OPEN,
      });

      // PART 4: Non-critical updates
      // -------------------------------------

      // Emit position update event (non-critical)
      this.eventsService.emitPositionsUpdate(orderRequest.userId);

      return position.status === PositionStatus.OPEN;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException ||
        error instanceof NotFoundException
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
      // PART 1: Validations and Data Gathering
      // -------------------------------------

      // 1. Validate inputs
      if (!positionId) throw new BadRequestException('Position ID is required');
      if (!userId) throw new BadRequestException('User ID is required');
      if (!sizeDelta) throw new BadRequestException('Size delta is required');

      // 2. Retrieve position
      const position = await this.getPosition(positionId);
      if (!position) {
        throw new NotFoundException(`Position ${positionId} not found`);
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

      // PART 2: Calculations
      // -------------------------------------

      // 5. Calculate all necessary values
      // @audit add max slippage
      const { executionPrice } = await this.priceService.previewPrice(
        position.marketId,
        position.side === OrderSide.LONG ? OrderSide.SHORT : OrderSide.LONG,
        sizeDelta,
      );

      const remainingSize = subtract(position.size, sizeDelta);

      const realizedPnlUSD = calculatePnlUSD(position, executionPrice);

      const solPrice = await this.priceService.getSolPrice();

      const closeProportion = divide(sizeDelta, position.size);

      const solMarginToRelease = multiply(
        position.lockedMarginSOL,
        closeProportion,
      );

      const usdcMarginToRelease = multiply(
        position.lockedMarginUSDC,
        closeProportion,
      );

      const totalLockedUSD = add(
        multiply(solMarginToRelease, solPrice),
        usdcMarginToRelease,
      );

      // Calculate PnL distribution
      const solShare = divide(
        multiply(solMarginToRelease, solPrice),
        totalLockedUSD,
      );
      const solPnL = divide(multiply(realizedPnlUSD, solShare), solPrice);
      const usdcShare = divide(usdcMarginToRelease, totalLockedUSD);
      const usdcPnL = multiply(realizedPnlUSD, usdcShare);

      // Prepare the trade record
      const tradeRecord: Trade = {
        id: crypto.randomUUID(),
        positionId: position.id,
        userId: position.userId,
        marketId: position.marketId,
        side:
          position.side === OrderSide.LONG ? OrderSide.SHORT : OrderSide.LONG,
        size: sizeDelta,
        price: executionPrice,
        leverage: position.leverage,
        realizedPnl: realizedPnlUSD,
        fee: this.calculateFee(
          sizeDelta,
          position.token === TokenType.SOL ? solPrice : 1,
        ),
        createdAt: new Date(),
      };

      // 6. Get the market
      const market = await this.marketService.getMarketById(position.marketId);
      if (!market) {
        throw new NotFoundException(`Market ${position.marketId} not found`);
      }

      // PART 3: Database Updates (all or nothing)
      // -------------------------------------

      // 1. Handle margin releases and re-locks
      if (compare(solMarginToRelease, '0') > 0) {
        if (isPartialClose) {
          const remainingSolMargin = subtract(
            position.lockedMarginSOL,
            solMarginToRelease,
          );
          await this.marginService.releaseMargin(
            position.userId,
            TokenType.SOL,
            position.id,
            position.lockedMarginSOL,
          );
          if (compare(remainingSolMargin, '0') > 0) {
            await this.marginService.lockMargin(
              position.userId,
              TokenType.SOL,
              remainingSolMargin,
              position.id,
            );
          }
        } else {
          await this.marginService.releaseMargin(
            position.userId,
            TokenType.SOL,
            position.id,
            solPnL,
          );
        }
      }

      if (compare(usdcMarginToRelease, '0') > 0) {
        if (isPartialClose) {
          const remainingUsdcMargin = subtract(
            position.lockedMarginUSDC,
            usdcMarginToRelease,
          );
          await this.marginService.releaseMargin(
            position.userId,
            TokenType.USDC,
            position.id,
            position.lockedMarginUSDC,
          );
          if (compare(remainingUsdcMargin, '0') > 0) {
            await this.marginService.lockMargin(
              position.userId,
              TokenType.USDC,
              remainingUsdcMargin,
              position.id,
            );
          }
        } else {
          await this.marginService.releaseMargin(
            position.userId,
            TokenType.USDC,
            position.id,
            usdcPnL,
          );
        }
      }

      // 2. Update position
      const [updatedPosition] = await this.databaseService.update(
        'positions',
        isFullClose
          ? {
              ...position,
              status: PositionStatus.CLOSED,
              closedAt: new Date(),
              closingPrice: executionPrice,
              realizedPnl: realizedPnlUSD,
            }
          : {
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

      await this.marketService.updateMarket(market.id, {
        longOpenInterest:
          position.side === OrderSide.LONG
            ? subtract(market.longOpenInterest, sizeDelta)
            : market.longOpenInterest,
        shortOpenInterest:
          position.side === OrderSide.SHORT
            ? subtract(market.shortOpenInterest, sizeDelta)
            : market.shortOpenInterest,
      });

      // Update virtual AMM reserves
      await this.marketService.updateVirtualReserves(
        market.id,
        position.side === OrderSide.LONG ? OrderSide.SHORT : OrderSide.LONG,
        sizeDelta,
        true,
      );

      // 3. Record the trade
      await this.recordTrade(tradeRecord);

      // PART 4: Non-critical updates
      // -------------------------------------

      // Emit position update event (non-critical)
      try {
        this.eventsService.emitPositionsUpdate(position.userId);
      } catch (error) {
        console.error('Failed to emit position update:', error);
      }

      return position;
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
      // PART 1: Validations and Data Gathering
      // -------------------------------------

      // 1. Validate basic inputs and fetch position
      if (!positionId) {
        throw new BadRequestException('Position ID is required');
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

      if (position.status !== PositionStatus.OPEN) {
        throw new BadRequestException(
          'Cannot edit stop loss of a closed position',
        );
      }

      // 2. Validate stop loss price if provided
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

      // PART 2: Database Updates (all or nothing)
      // -------------------------------------

      const [updatedPosition] = await this.databaseService.update(
        'positions',
        {
          ...position,
          stopLossPrice,
        },
        { id: position.id },
      );

      // PART 3: Non-critical updates
      // -------------------------------------

      try {
        await this.invalidatePositionCache(positionId, userId);
        this.eventsService.emitPositionsUpdate(userId);
      } catch (error) {
        console.error('Failed to perform non-critical updates:', error);
      }

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
      // PART 1: Validations and Data Gathering
      // -------------------------------------

      // 1. Validate basic inputs and fetch position
      if (!positionId) {
        throw new BadRequestException('Position ID is required');
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

      if (position.status !== PositionStatus.OPEN) {
        throw new BadRequestException(
          'Cannot edit take profit of a closed position',
        );
      }

      // 2. Validate take profit price if provided
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

      // PART 2: Database Updates (all or nothing)
      // -------------------------------------

      const [updatedPosition] = await this.databaseService.update(
        'positions',
        {
          ...position,
          takeProfitPrice,
        },
        { id: position.id },
      );

      // PART 3: Non-critical updates
      // -------------------------------------

      try {
        await this.invalidatePositionCache(positionId, userId);
        this.eventsService.emitPositionsUpdate(userId);
      } catch (error) {
        console.error('Failed to perform non-critical updates:', error);
      }

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
      // PART 1: Validations and Data Gathering
      // -------------------------------------

      // 1. Validate basic inputs and fetch position
      if (!positionId) {
        throw new BadRequestException('Position ID is required');
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

      if (position.status !== PositionStatus.OPEN) {
        throw new BadRequestException(
          'Cannot edit margin of a closed position',
        );
      }

      // 2. Fetch market and validate leverage constraints
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

      // 3. Calculate proportions and deltas
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

      // PART 2: Database Updates (all or nothing)
      // -------------------------------------

      // 1. Handle margin adjustments
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

      // 2. Update position
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

      // PART 3: Non-critical updates
      // -------------------------------------

      try {
        await this.invalidatePositionCache(positionId, userId);
        this.eventsService.emitPositionsUpdate(userId);
      } catch (error) {
        console.error('Failed to perform non-critical updates:', error);
      }

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

  /**
   * @audit Update for vAMM
   */
  private calculateSlippage(
    size: string,
    priceImpact: string,
    positivelyImpacted: boolean,
  ): string {
    if (positivelyImpacted) {
      // If impact was positively beneficial, the position did not experience any slippage
      return '0';
    }

    // If negatively impacted, the slippage is the price impact percentage (price impact / size)
    return divide(priceImpact, size);
  }

  private calculateFee(size: string, collateralPrice: number): string {
    try {
      if (!size || !collateralPrice) {
        throw new BadRequestException(
          'Size and price are required for fee calculation',
        );
      }

      const feeUsd = multiply(size, TRADING_FEE);

      const feeCollateral = divide(feeUsd, collateralPrice);

      return feeCollateral;
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

      const insertedTrade = await this.databaseService.insert('trades', trade);

      // Add volume to market stats -> multiply by 2 for entry and exit
      const volume = multiply(trade.size, '2');
      await this.statsService.addVolume(trade.marketId, volume);

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
