import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Position, PositionStatus } from '../entities/position.entity';
import { PriceService } from '../price/price.service';
import { MarginService } from '../margin/margin.service';
import { MathService } from '../utils/math.service';
import { OrderSide } from '../types/trade.types';
import { TokenType } from '../margin/types/token.types';

@Injectable()
export class LiquidationService {
  private readonly logger = new Logger(LiquidationService.name);
  private readonly checkInterval = 5000; // 5 seconds - more frequent than limit orders
  private readonly maintenanceMarginRate = '0.05'; // 5% maintenance margin rate
  private readonly hourlyBorrowingRate = '0.0000125'; // 0.00125% per hour

  constructor(
    @InjectRepository(Position)
    private readonly positionRepository: Repository<Position>,
    private readonly priceService: PriceService,
    private readonly marginService: MarginService,
    private readonly mathService: MathService,
  ) {
    this.startMonitoring();
  }

  private async startMonitoring() {
    setInterval(async () => {
      try {
        await this.checkPositionsForLiquidation();
        await this.updateBorrowingFees();
      } catch (error) {
        this.logger.error('Error checking positions for liquidation:', error);
      }
    }, this.checkInterval);
  }

  async getLiquidationPrice(positionId: string): Promise<string> {
    const position = await this.positionRepository.findOne({
      where: { id: positionId },
    });
    if (!position) {
      throw new Error('Position not found');
    }

    return this.calculateLiquidationPrice(position);
  }

  private async calculateLiquidationPrice(position: Position): Promise<string> {
    // Calculate total fees
    const totalFees = this.mathService.add(
      position.accumulatedFunding || '0',
      position.accumulatedBorrowingFee || '0',
    );

    const solPrice = await this.priceService.getSolPrice();

    // Calculate the USD value of the position's margin
    const marginUSD = this.mathService.add(
      this.mathService.multiply(position.lockedMarginSOL, solPrice),
      position.lockedMarginUSDC,
    );

    // Calculate effective margin (initial margin - fees)
    const effectiveMargin = this.mathService.subtract(marginUSD, totalFees);

    // Position value is just size since it's already in USD
    const positionValue = position.size;

    // Calculate required margin with maintenance requirement
    const requiredMargin = this.mathService.multiply(
      positionValue,
      this.maintenanceMarginRate,
    );

    // Calculate max loss percentage (effective margin - required margin) / position value
    const maxLossPercentage = this.mathService.divide(
      this.mathService.subtract(effectiveMargin, requiredMargin),
      positionValue,
    );

    if (position.side === OrderSide.LONG) {
      // For longs: liquidation_price = entry_price * (1 - maxLossPercentage)
      const multiplier = this.mathService.subtract('1', maxLossPercentage);
      return this.mathService.multiply(position.entryPrice, multiplier);
    } else {
      // For shorts: liquidation_price = entry_price * (1 + maxLossPercentage)
      const multiplier = this.mathService.add('1', maxLossPercentage);
      return this.mathService.multiply(position.entryPrice, multiplier);
    }
  }

  private async shouldLiquidate(
    position: Position,
    currentPrice: string,
  ): Promise<boolean> {
    const liquidationPrice = await this.calculateLiquidationPrice(position);

    if (position.side === OrderSide.LONG) {
      return this.mathService.compare(currentPrice, liquidationPrice) <= 0;
    } else {
      return this.mathService.compare(currentPrice, liquidationPrice) >= 0;
    }
  }

  private async checkPositionsForLiquidation(): Promise<void> {
    const positions = await this.positionRepository.find({
      where: { status: PositionStatus.OPEN },
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
      // Update position status
      await this.positionRepository.update(position.id, {
        status: PositionStatus.LIQUIDATED,
        closedAt: new Date(),
        closingPrice: currentPrice,
        realizedPnl: '0', // No PnL in liquidation - all margin is seized
      });

      this.logger.log(
        `Position ${position.id} liquidated at price ${currentPrice}`,
      );
    } catch (error) {
      this.logger.error(`Failed to liquidate position ${position.id}:`, error);
      throw error;
    }
  }

  private async updateBorrowingFees(): Promise<void> {
    const positions = await this.positionRepository.find({
      where: { status: PositionStatus.OPEN },
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
          const currentPrice = await this.priceService.getCurrentPrice(
            position.marketId,
          );
          const positionValue = this.mathService.multiply(
            position.size,
            currentPrice,
          );

          // Calculate borrowing fee for the elapsed hours
          const hoursToCharge = Math.floor(hoursSinceLastUpdate);
          const borrowingFee = this.mathService.multiply(
            positionValue,
            this.mathService.multiply(
              this.hourlyBorrowingRate,
              hoursToCharge.toString(),
            ),
          );

          // Update accumulated borrowing fee
          position.accumulatedBorrowingFee = this.mathService.add(
            position.accumulatedBorrowingFee,
            borrowingFee,
          );
          position.lastBorrowingFeeUpdate = new Date(
            position.lastBorrowingFeeUpdate.getTime() +
              hoursToCharge * 60 * 60 * 1000,
          );

          await this.positionRepository.save(position);
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
