import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Position, PositionStatus } from '../entities/position.entity';
import { PriceService } from '../price/price.service';
import { TradeService } from '../trade/trade.service';
import { MarginService } from '../margin/margin.service';
import { MathService } from '../utils/math.service';
import { OrderSide, MarginType } from '../types/trade.types';
import { TokenType } from '../margin/types/token.types';

@Injectable()
export class LiquidationService {
  private readonly logger = new Logger(LiquidationService.name);
  private readonly checkInterval = 5000; // 5 seconds - more frequent than limit orders
  private readonly maintenanceMarginRate = {
    [MarginType.ISOLATED]: '0.05', // 5% for isolated
    [MarginType.CROSS]: '0.03', // 3% for cross
  };
  private readonly hourlyBorrowingRate = '0.0000125'; // 0.00125% per hour

  constructor(
    @InjectRepository(Position)
    private readonly positionRepository: Repository<Position>,
    private readonly priceService: PriceService,
    private readonly tradeService: TradeService,
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

    const currentPrice = await this.priceService.getCurrentPrice(
      position.marketId,
    );
    return this.calculateLiquidationPrice(position, currentPrice);
  }

  private calculateLiquidationPrice(
    position: Position,
    currentPrice: string,
  ): string {
    // Calculate total fees
    const totalFees = this.mathService.add(
      position.accumulatedFunding || '0',
      position.accumulatedBorrowingFee || '0',
    );

    // Calculate effective margin (initial margin - fees)
    const effectiveMargin = this.mathService.subtract(
      position.margin,
      totalFees,
    );

    // Calculate position value
    const positionValue = this.mathService.multiply(
      position.size,
      currentPrice,
    );

    // Calculate maintenance margin requirement
    const maintenanceMarginRate =
      this.maintenanceMarginRate[position.marginType];
    const maintenanceMargin = this.mathService.multiply(
      positionValue,
      maintenanceMarginRate,
    );

    // For longs: liquidation_price = entry_price - (effective_margin - maintenance_margin) / size
    // For shorts: liquidation_price = entry_price + (effective_margin - maintenance_margin) / size
    const marginBuffer = this.mathService.subtract(
      effectiveMargin,
      maintenanceMargin,
    );
    const priceMove = this.mathService.divide(marginBuffer, position.size);

    if (position.side === OrderSide.LONG) {
      return this.mathService.subtract(position.entryPrice, priceMove);
    } else {
      return this.mathService.add(position.entryPrice, priceMove);
    }
  }

  private async shouldLiquidate(
    position: Position,
    currentPrice: string,
  ): Promise<boolean> {
    const liquidationPrice = this.calculateLiquidationPrice(
      position,
      currentPrice,
    );

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

  private async liquidatePosition(
    position: Position,
    currentPrice: string,
  ): Promise<void> {
    try {
      // Calculate realized PnL
      const realizedPnl = this.calculatePnl(
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
          this.mathService.multiply(realizedPnl, solShare),
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
        const usdcPnL = this.mathService.multiply(realizedPnl, usdcShare);
        await this.marginService.releaseMargin(
          position.userId,
          TokenType.USDC,
          position.id,
          usdcPnL,
        );
      }

      // Update position status
      await this.positionRepository.update(position.id, {
        status: PositionStatus.LIQUIDATED,
        closedAt: new Date(),
        closingPrice: currentPrice,
        realizedPnl: realizedPnl,
      });

      this.logger.log(
        `Position ${position.id} liquidated at price ${currentPrice}`,
      );
    } catch (error) {
      this.logger.error(`Failed to liquidate position ${position.id}:`, error);
      throw error;
    }
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
