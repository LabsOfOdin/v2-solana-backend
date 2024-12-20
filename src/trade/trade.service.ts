import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Position } from '../entities/position.entity';
import { PriceService } from '../price/price.service';
import { LiquidityService } from '../liquidity/liquidity.service';
import { UserService } from '../user/user.service';
import { MathService } from '../utils/math.service';
import {
  OrderRequest,
  OrderSide,
  MarginType,
  Trade,
} from '../types/trade.types';
import { Trade as TradeEntity } from '../entities/trade.entity';

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
  constructor(
    @InjectRepository(Position)
    private readonly positionRepository: Repository<Position>,
    @InjectRepository(TradeEntity)
    private readonly tradeRepository: Repository<TradeEntity>,
    private readonly priceService: PriceService,
    private readonly liquidityService: LiquidityService,
    private readonly userService: UserService,
    private readonly mathService: MathService,
  ) {}

  async openPosition(orderRequest: OrderRequest): Promise<Position> {
    // 1. Validate user has enough margin
    const userBalance = await this.userService.getBalance(orderRequest.userId);
    const requiredMargin = this.calculateRequiredMargin(orderRequest);

    if (this.mathService.compare(userBalance, requiredMargin) < 0) {
      throw new Error('Insufficient margin');
    }

    // 2. Check liquidity pool capacity
    await this.liquidityService.validateLiquidityForTrade(orderRequest);

    // 3. Get current market price and calculate entry price with slippage
    const marketPrice = await this.priceService.getCurrentPrice(
      orderRequest.marketId,
    );
    const entryPrice = this.calculateEntryPrice(marketPrice, orderRequest);

    // 4. Calculate liquidation price
    const liquidationPrice = this.calculateLiquidationPrice(
      entryPrice,
      orderRequest.leverage,
      orderRequest.side,
      orderRequest.marginType,
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
        liquidationPrice,
        unrealizedPnl: '0',
        margin: requiredMargin,
      }),
    );

    // 6. Record trade
    await this.recordTrade({
      id: crypto.randomUUID(),
      positionId: position.id,
      userId: orderRequest.userId,
      marketId: orderRequest.marketId,
      side: orderRequest.side,
      size: orderRequest.size,
      price: entryPrice,
      leverage: orderRequest.leverage,
      marginType: orderRequest.marginType,
      fee: this.calculateFee(orderRequest.size, entryPrice),
      createdAt: new Date(),
    });

    // 7. Lock margin
    await this.userService.lockMargin(orderRequest.userId, requiredMargin);

    return position;
  }

  async closePosition(positionId: string): Promise<void> {
    const position = await this.getPosition(positionId);
    const currentPrice = await this.priceService.getCurrentPrice(
      position.marketId,
    );

    // Calculate PnL
    const realizedPnl = this.calculatePnl(
      position.side,
      position.size,
      position.entryPrice,
      currentPrice,
    );

    // Record closing trade
    await this.recordTrade({
      id: crypto.randomUUID(),
      positionId: position.id,
      userId: position.userId,
      marketId: position.marketId,
      side: position.side === OrderSide.LONG ? OrderSide.SHORT : OrderSide.LONG,
      size: position.size,
      price: currentPrice,
      leverage: position.leverage,
      marginType: position.marginType,
      realizedPnl,
      fee: this.calculateFee(position.size, currentPrice),
      createdAt: new Date(),
    });

    // Release margin
    await this.userService.releaseMargin(position.userId, position.id);

    // Delete position
    await this.positionRepository.delete(position.id);
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
    await this.userService.updateUnrealizedPnl(position.userId, unrealizedPnl);
  }

  async getPosition(positionId: string): Promise<Position> {
    const position = await this.positionRepository.findOne({
      where: { id: positionId },
    });

    if (!position) {
      throw new NotFoundException(`Position ${positionId} not found`);
    }

    return position;
  }

  async getUserPositions(userId: string): Promise<Position[]> {
    return this.positionRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
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

  private calculateLiquidationPrice(
    entryPrice: string,
    leverage: string,
    side: OrderSide,
    marginType: MarginType,
  ): string {
    const maintenanceMargin =
      marginType === MarginType.ISOLATED ? '0.05' : '0.03';
    const liquidationThreshold = this.mathService.multiply(
      this.mathService.divide('1', leverage),
      this.mathService.subtract('1', maintenanceMargin),
    );

    if (side === OrderSide.LONG) {
      return this.mathService.multiply(
        entryPrice,
        this.mathService.subtract('1', liquidationThreshold),
      );
    } else {
      return this.mathService.multiply(
        entryPrice,
        this.mathService.add('1', liquidationThreshold),
      );
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
  }

  async getPositionTrades(positionId: string): Promise<TradeEntity[]> {
    return this.tradeRepository.find({
      where: { positionId },
      order: { createdAt: 'DESC' },
    });
  }

  async getUserTrades(userId: string): Promise<TradeEntity[]> {
    return this.tradeRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }
}
