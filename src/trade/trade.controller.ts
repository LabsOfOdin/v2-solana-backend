import { Controller, Post, Body, Get, Param, Query } from '@nestjs/common';
import { TradeService } from './trade.service';
import { OrderRequest, UpdatePositionRequest } from '../types/trade.types';
import { validatePublicKey } from 'src/common/validators';

@Controller('trade')
export class TradeController {
  constructor(private readonly tradeService: TradeService) {}

  @Post()
  async createOrder(@Body() orderRequest: OrderRequest) {
    validatePublicKey(orderRequest.userId);
    return this.tradeService.openPosition(orderRequest);
  }

  @Post('position/:positionId/margin')
  async editMargin(
    @Param('positionId') positionId: string,
    @Body() request: { marginDelta: string },
    @Query('publicKey') publicKey: string,
  ) {
    validatePublicKey(publicKey);
    return this.tradeService.editMargin(
      positionId,
      publicKey,
      request.marginDelta,
    );
  }

  @Post('position/:positionId/stop-loss')
  async editStopLoss(
    @Param('positionId') positionId: string,
    @Body() request: { stopLossPrice: string | null },
    @Query('publicKey') publicKey: string,
  ) {
    validatePublicKey(publicKey);
    return this.tradeService.editStopLoss(
      positionId,
      publicKey,
      request.stopLossPrice,
    );
  }

  @Post('position/:positionId/take-profit')
  async editTakeProfit(
    @Param('positionId') positionId: string,
    @Body() request: { takeProfitPrice: string | null },
    @Query('publicKey') publicKey: string,
  ) {
    validatePublicKey(publicKey);
    return this.tradeService.editTakeProfit(
      positionId,
      publicKey,
      request.takeProfitPrice,
    );
  }

  @Post('position/:positionId/close')
  async closePosition(
    @Param('positionId') positionId: string,
    @Body() request: { sizeDelta: string; maxSlippage: string },
    @Query('publicKey') publicKey: string,
  ) {
    return this.tradeService.closePosition(
      positionId,
      publicKey,
      request.sizeDelta,
      request.maxSlippage,
    );
  }

  @Get('positions')
  async getUserPositions(@Query('publicKey') publicKey: string) {
    return this.tradeService.getUserPositions(publicKey);
  }

  @Get('position/:positionId')
  async getPosition(
    @Param('positionId') positionId: string,
    @Query('publicKey') publicKey: string,
  ) {
    return this.tradeService.getPosition(positionId);
  }

  @Get('trades')
  async getUserTrades(@Query('publicKey') publicKey: string) {
    return this.tradeService.getUserTrades(publicKey);
  }
}
