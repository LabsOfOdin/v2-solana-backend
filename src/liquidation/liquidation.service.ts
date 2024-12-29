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
import { add, compare, divide, multiply, subtract } from 'src/lib/math';

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
          this.updateBorrowingFees(),
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

  private async calculateLiquidationPrice(position: Position): Promise<string> {
    // Calculate total fees
    const totalFees = add(
      position.accumulatedFunding || '0',
      position.accumulatedBorrowingFee || '0',
    );

    const solPrice = await this.priceService.getSolPrice();

    // Calculate the USD value of the position's margin
    const marginUSD = add(
      multiply(position.lockedMarginSOL, solPrice),
      position.lockedMarginUSDC,
    );

    // Calculate effective margin (initial margin - fees)
    const effectiveMargin = subtract(marginUSD, totalFees);

    // Position value is just size since it's already in USD
    const positionValue = position.size;

    // Calculate required margin with maintenance requirement
    const requiredMargin = multiply(positionValue, this.maintenanceMarginRate);

    // Calculate max loss percentage (effective margin - required margin) / position value
    const maxLossPercentage = divide(
      subtract(effectiveMargin, requiredMargin),
      positionValue,
    );

    if (position.side === OrderSide.LONG) {
      // For longs: liquidation_price = entry_price * (1 - maxLossPercentage)
      const multiplier = subtract('1', maxLossPercentage);
      return multiply(position.entryPrice, multiplier);
    } else {
      // For shorts: liquidation_price = entry_price * (1 + maxLossPercentage)
      const multiplier = add('1', maxLossPercentage);
      return multiply(position.entryPrice, multiplier);
    }
  }

  private async shouldLiquidate(
    position: Position,
    currentPrice: string,
  ): Promise<boolean> {
    const liquidationPrice = await this.calculateLiquidationPrice(position);

    if (position.side === OrderSide.LONG) {
      return compare(currentPrice, liquidationPrice) <= 0;
    } else {
      return compare(currentPrice, liquidationPrice) >= 0;
    }
  }

  private async checkPositionsForLiquidation(): Promise<void> {
    const positions = await this.databaseService.select<Position>('positions', {
      eq: { status: PositionStatus.OPEN },
    });

    for (const position of positions) {
      try {
        const currentPrice = await this.priceService.getCurrentPrice(
          position.marketId,
        );

        if (await this.shouldLiquidate(position, currentPrice)) {
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
    }
  }

  /**
   * @audit Seems fishy. Why is there pnl calculation here?
   * Should just nuke the margin from their account.
   * We should also probably have something in the DB so we can track
   * the funds we've earned from:
   * - liquidation fees
   * - borrowing fees
   * - funding fees
   * - position fees
   */
  private async liquidatePosition(
    position: Position,
    currentPrice: string,
  ): Promise<void> {
    try {
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

      this.logger.log(
        `Position ${position.id} liquidated at price ${currentPrice}`,
      );
    } catch (error) {
      this.logger.error(`Failed to liquidate position ${position.id}:`, error);
      throw error;
    }
  }

  private async updateBorrowingFees(): Promise<void> {
    const positions = await this.databaseService.select<Position>('positions', {
      eq: { status: PositionStatus.OPEN },
    });
    const now = new Date();

    for (const position of positions) {
      try {
        if (!position.lastBorrowingFeeUpdate) {
          position.lastBorrowingFeeUpdate = position.createdAt;
        }

        const hoursSinceLastUpdate =
          (now.getTime() - position.lastBorrowingFeeUpdate.getTime()) /
          (1000 * 60 * 60);

        if (hoursSinceLastUpdate >= 1) {
          const [market] = await this.databaseService.select<Market>(
            'markets',
            {
              eq: { id: position.marketId },
              limit: 1,
            },
          );

          if (!market) {
            throw new Error('Market not found');
          }

          const currentPrice = await this.priceService.getCurrentPrice(
            position.marketId,
          );
          const positionValue = multiply(position.size, currentPrice);

          // Calculate borrowing fee for the elapsed hours
          const hoursToCharge = Math.floor(hoursSinceLastUpdate);
          const borrowingFeeUsd = multiply(
            positionValue,
            multiply(market.borrowingRate, hoursToCharge.toString()),
          );

          // Get token price for conversion
          const tokenPrice =
            position.token === TokenType.SOL
              ? await this.priceService.getSolPrice()
              : await this.priceService.getUsdcPrice();

          // Convert fee to token amount
          const feeInToken = divide(borrowingFeeUsd, tokenPrice);

          // Deduct fee from user's margin balance
          await this.marginService.deductMargin(
            position.userId,
            position.token,
            feeInToken,
          );

          // Add fee to market's tracking
          /**
           * @audit Need to distinguish between trading fees in SOL and USDC
           */
          await this.marketService.addTradingFees(market.id, feeInToken);

          // Update position's accumulated borrowing fee and last update time
          await this.databaseService.update<Position>(
            'positions',
            {
              accumulatedBorrowingFee: add(
                position.accumulatedBorrowingFee,
                feeInToken,
              ),
              lastBorrowingFeeUpdate: new Date(
                position.lastBorrowingFeeUpdate.getTime() +
                  hoursToCharge * 60 * 60 * 1000,
              ),
            },
            { id: position.id },
          );

          // Emit fee charged event
          this.eventsService.emitBorrowingFeeCharged({
            userId: position.userId,
            positionId: position.id,
            marketId: market.id,
            feeUsd: feeInToken,
            feeToken: feeInToken,
            token: position.token,
          });
        }
      } catch (error) {
        this.logger.error(
          `Error updating borrowing fees for position ${position.id}:`,
          error,
        );
      }
    }
  }
}
