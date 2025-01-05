import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Position, PositionStatus } from '../entities/position.entity';
import { Market } from '../entities/market.entity';
import { PriceService } from '../price/price.service';
import { OrderSide } from '../types/trade.types';
import { TokenType } from 'src/types/token.types';
import { MarginService } from '../margin/margin.service';
import { MarketService } from '../market/market.service';
import { EventsService } from '../events/events.service';
import { add, divide, multiply, subtract, compare } from 'src/lib/math';
import { calculatePnlUSD } from 'src/lib/calculatePnlUsd';
import { SECONDS_IN_DAY } from 'src/common/config';

@Injectable()
export class LiquidationService {
  private readonly logger = new Logger(LiquidationService.name);
  private readonly checkInterval = 5000;
  private readonly maintenanceMarginRate = '0.05';

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly priceService: PriceService,
    private readonly eventsService: EventsService,
    private readonly marginService: MarginService,
    private readonly marketService: MarketService,
  ) {
    this.startMonitoring();
  }

  private async startMonitoring() {
    setInterval(async () => {
      try {
        await Promise.all([
          this.checkPositionsForLiquidation(),
          this.updatePositionFees(),
        ]);
      } catch (error) {
        this.logger.error('Error checking positions for liquidation:', error);
      }
    }, this.checkInterval);
  }

  async getLiquidationPrice(positionId: string): Promise<string> {
    const [position] = await this.databaseService.select<Position>(
      'positions',
      {
        eq: { id: positionId },
        limit: 1,
      },
    );

    if (!position) {
      throw new Error('Position not found');
    }

    return this.calculateLiquidationPrice(position);
  }

  private async isLiquidatable(
    position: Position,
    currentPrice: string,
  ): Promise<boolean> {
    const solPrice = await this.priceService.getSolPrice();

    const pnl = calculatePnlUSD(position, currentPrice);

    const collateralValue = add(
      multiply(position.lockedMarginSOL || '0', solPrice.toString()),
      position.lockedMarginUSDC || '0',
    );

    // Calculate the minimum collateral required (maintenance margin)
    const maintenanceMargin = multiply(
      collateralValue,
      this.maintenanceMarginRate,
    );

    // Calculate remaining collateral after PnL
    const remainingCollateral = add(collateralValue, pnl);

    // Liquidate if remaining collateral is less than maintenance margin
    return compare(remainingCollateral, maintenanceMargin) < 0;
  }

  private async calculateLiquidationPrice(position: Position): Promise<string> {
    const solPrice = await this.priceService.getSolPrice();

    // Calculate total collateral value in USD
    const collateralValue = add(
      multiply(position.lockedMarginSOL, solPrice),
      position.lockedMarginUSDC,
    );

    // Account for accumulated fees
    const totalFees = add(
      position.accumulatedFunding || '0',
      position.accumulatedBorrowingFee || '0',
    );

    // For liquidation: abs(pnl) = collateralValue
    // pnl = (currentPrice - entryPrice) * size for longs
    // pnl = (entryPrice - currentPrice) * size for shorts

    if (position.side === OrderSide.LONG) {
      // (currentPrice - entryPrice) * size - fees = -collateralValue
      // currentPrice * size = -collateralValue + fees + entryPrice * size
      return divide(
        subtract(
          subtract(
            multiply(position.entryPrice, position.size),
            collateralValue,
          ),
          totalFees,
        ),
        position.size,
      );
    } else {
      // (entryPrice - currentPrice) * size - fees = -collateralValue
      // currentPrice * size = entryPrice * size + collateralValue + fees
      return divide(
        add(
          add(multiply(position.entryPrice, position.size), collateralValue),
          totalFees,
        ),
        position.size,
      );
    }
  }

  private async checkPositionsForLiquidation(): Promise<void> {
    const positions = await this.databaseService.select<Position>('positions', {
      eq: { status: PositionStatus.OPEN },
    });

    await Promise.all(
      positions.map(async (position) => {
        try {
          const currentPrice = await this.priceService.getCurrentPrice(
            position.marketId,
          );

          const isLiquidatable = await this.isLiquidatable(
            position,
            currentPrice,
          );

          if (isLiquidatable) {
            await this.liquidatePosition(position, currentPrice);
            this.logger.warn(
              `Liquidated position ${position.id} at price ${currentPrice}`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Error processing position ${position.id} for liquidation:`,
            error,
          );
        }
      }),
    );
  }

  private async liquidatePosition(
    position: Position,
    currentPrice: string,
  ): Promise<void> {
    try {
      // Get market for updating open interest and reserves
      const market = await this.marketService.getMarketById(position.marketId);
      if (!market) {
        throw new Error(`Market ${position.marketId} not found`);
      }

      // Update position status
      await this.databaseService.update<Position>(
        'positions',
        {
          status: PositionStatus.LIQUIDATED,
          closedAt: new Date(),
          closingPrice: currentPrice,
          realizedPnl: '0',
        },
        { id: position.id },
      );

      // Update market's open interest
      await this.marketService.updateMarket(market.id, {
        longOpenInterest:
          position.side === OrderSide.LONG
            ? subtract(market.longOpenInterest, position.size)
            : market.longOpenInterest,
        shortOpenInterest:
          position.side === OrderSide.SHORT
            ? subtract(market.shortOpenInterest, position.size)
            : market.shortOpenInterest,
      });

      // Update virtual AMM reserves - treat liquidation like a position close
      await this.marketService.updateVirtualReserves(
        market.id,
        position.side,
        position.size,
        true,
      );

      this.eventsService.emitPositionsUpdate(position.userId);

      this.logger.log(
        `Position ${position.id} liquidated at price ${currentPrice}`,
      );
    } catch (error) {
      this.logger.error(`Failed to liquidate position ${position.id}:`, error);
      throw error;
    }
  }

  private async updatePositionFees(): Promise<void> {
    const positions = await this.databaseService.select<Position>('positions', {
      eq: { status: PositionStatus.OPEN },
    });
    const now = new Date();

    await Promise.all(
      positions.map(async (position) => {
        try {
          await Promise.all([
            this.updateBorrowingFee(position, now),
            this.updateFundingFee(position, now),
          ]);
        } catch (error) {
          this.logger.error(
            `Error updating fees for position ${position.id}:`,
            error,
          );
        }
      }),
    );
  }

  private async updateFundingFee(position: Position, now: Date): Promise<void> {
    if (!position.lastFundingUpdate) {
      position.lastFundingUpdate = position.createdAt;
    }

    // Calculate seconds since last update
    const secondsSinceLastUpdate =
      (now.getTime() - new Date(position.lastFundingUpdate).getTime()) / 1000;

    // Only proceed if at least 1 second has passed
    if (secondsSinceLastUpdate >= 1) {
      const market = await this.marketService.getMarketById(position.marketId);
      if (!market) {
        throw new Error('Market not found');
      }

      // Get current funding rate
      const currentFundingRate = await this.marketService.getFundingRate(
        market.id,
      );

      // Calculate funding fee based on position size and funding rate
      // Note: Funding rate is already in daily terms
      const fundingFeeUsd = multiply(
        position.size,
        multiply(
          currentFundingRate,
          divide(secondsSinceLastUpdate.toString(), SECONDS_IN_DAY),
        ),
      );

      // For shorts, they receive funding when rate is positive and pay when negative
      // For longs, they pay funding when rate is positive and receive when negative
      const adjustedFundingFeeUsd =
        position.side === OrderSide.LONG
          ? fundingFeeUsd
          : multiply(fundingFeeUsd, '-1');

      // Get token price for conversion
      const tokenPrice =
        position.token === TokenType.SOL
          ? await this.priceService.getSolPrice()
          : await this.priceService.getUsdcPrice();

      // Convert fee to token amount
      const feeInToken = divide(adjustedFundingFeeUsd, tokenPrice);

      // If fee is positive, user pays. If negative, user receives
      if (parseFloat(feeInToken) > 0) {
        // Deduct fee from user's margin balance
        await this.marginService.reduceLockedMargin(
          position.userId,
          position.token,
          feeInToken,
        );

        // Add fee to market's tracking
        await this.marketService.addTradingFees(
          market.id,
          feeInToken,
          position.token,
        );
      } else {
        // User receives funding payment
        const receivedAmount = multiply(feeInToken, '-1'); // Convert negative to positive
        await this.marginService.addToLockedMargin(
          position.userId,
          position.token,
          receivedAmount,
        );
      }

      // Update position with accumulated funding and timestamp
      await this.databaseService.update<Position>(
        'positions',
        {
          accumulatedFunding: add(
            position.accumulatedFunding || '0',
            feeInToken,
          ),
          lastFundingUpdate: now,
        },
        { id: position.id },
      );

      // Emit funding fee event
      this.eventsService.emitFundingFeeCharged({
        userId: position.userId,
        positionId: position.id,
        marketId: market.id,
        feeUsd: adjustedFundingFeeUsd,
        feeToken: feeInToken,
        token: position.token,
      });
    }
  }

  private async updateBorrowingFee(
    position: Position,
    now: Date,
  ): Promise<void> {
    try {
      if (!position.lastBorrowingFeeUpdate) {
        position.lastBorrowingFeeUpdate = position.createdAt;
      }

      // Calculate seconds since last update
      const secondsSinceLastUpdate =
        (now.getTime() - new Date(position.lastBorrowingFeeUpdate).getTime()) /
        1000;

      // Only proceed if at least 1 second has passed
      if (secondsSinceLastUpdate >= 1) {
        const [market] = await this.databaseService.select<Market>('markets', {
          eq: { id: position.marketId },
          limit: 1,
        });

        if (!market) {
          throw new Error('Market not found');
        }

        const positionValue = position.size || '0';

        // Calculate the portion of daily rate to charge
        // market.borrowingRate is daily rate, so divide by seconds in a day
        const borrowingFeeUsd = multiply(
          positionValue,
          multiply(
            market.borrowingRate || '0',
            divide(secondsSinceLastUpdate.toString(), SECONDS_IN_DAY),
          ),
        );

        // Get token price for conversion
        const tokenPrice =
          position.token === TokenType.SOL
            ? await this.priceService.getSolPrice()
            : await this.priceService.getUsdcPrice();

        // Convert fee to token amount
        const feeInToken = divide(borrowingFeeUsd || '0', tokenPrice || '1');

        // Deduct fee from user's margin balance
        await this.marginService.reduceLockedMargin(
          position.userId,
          position.token,
          feeInToken,
        );

        // Add fee to market's tracking
        await this.marketService.addTradingFees(
          market.id,
          feeInToken,
          position.token,
        );

        // Update with exact timestamp
        await this.databaseService.update<Position>(
          'positions',
          {
            accumulatedBorrowingFee: add(
              position.accumulatedBorrowingFee || '0',
              feeInToken,
            ),
            lastBorrowingFeeUpdate: now, // Use current timestamp
          },
          { id: position.id },
        );

        // Emit fee charged event
        this.eventsService.emitBorrowingFeeCharged({
          userId: position.userId,
          positionId: position.id,
          marketId: market.id,
          feeUsd: borrowingFeeUsd,
          feeToken: feeInToken,
          token: position.token,
        });
      }
    } catch (error) {
      this.logger.error(
        `Error updating borrowing fees for position ${position.id}:`,
        error,
      );
      throw error;
    }
  }
}
