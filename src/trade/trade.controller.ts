import { Controller, Post, Body, Get, Param, Query } from '@nestjs/common';
import { TradeService } from './trade.service';
import {
  OrderRequest,
  UpdatePositionRequest,
  PartialCloseRequest,
} from '../types/trade.types';
import { validatePublicKey } from 'src/common/validators';

@Controller('trade')
export class TradeController {
  constructor(private readonly tradeService: TradeService) {}

  @Post()
  async createOrder(@Body() orderRequest: OrderRequest) {
    validatePublicKey(orderRequest.userId);
    return this.tradeService.openPosition(orderRequest);
  }

  @Post('position/:positionId/update')
  async updatePosition(
    @Param('positionId') positionId: string,
    @Body() updates: UpdatePositionRequest,
    @Query('publicKey') publicKey: string,
  ) {
    return this.tradeService.updatePosition(positionId, publicKey, updates);
  }

  @Post('position/:positionId/partial-close')
  async partialClosePosition(
    @Param('positionId') positionId: string,
    @Body() request: PartialCloseRequest,
    @Query('publicKey') publicKey: string,
  ) {
    return this.tradeService.partialClosePosition(
      positionId,
      publicKey,
      request,
    );
  }

  @Post('position/:positionId/close')
  async closePosition(
    @Param('positionId') positionId: string,
    @Query('publicKey') publicKey: string,
  ) {
    return this.tradeService.closePosition(positionId, publicKey);
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
