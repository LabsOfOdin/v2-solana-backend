import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Request,
  Query,
} from '@nestjs/common';
import { TradeService } from './trade.service';
import {
  OrderRequest,
  UpdatePositionRequest,
  PartialCloseRequest,
} from '../types/trade.types';
import { Request as ExpressRequest } from 'express';
import { User } from '../entities/user.entity';

interface RequestWithUser extends ExpressRequest {
  user: User;
}

@Controller('trade')
export class TradeController {
  constructor(private readonly tradeService: TradeService) {}

  @Post()
  async createOrder(
    @Body() orderRequest: OrderRequest,
    @Request() req: RequestWithUser,
  ) {
    orderRequest.userId = req.user.publicKey;
    return this.tradeService.openPosition(orderRequest);
  }

  @Post('position/:positionId/update')
  async updatePosition(
    @Param('positionId') positionId: string,
    @Body() updates: UpdatePositionRequest,
    @Request() req: RequestWithUser,
  ) {
    return this.tradeService.updatePosition(
      positionId,
      req.user.publicKey,
      updates,
    );
  }

  @Post('position/:positionId/partial-close')
  async partialClosePosition(
    @Param('positionId') positionId: string,
    @Body() request: PartialCloseRequest,
    @Request() req: RequestWithUser,
  ) {
    return this.tradeService.partialClosePosition(
      positionId,
      req.user.publicKey,
      request,
    );
  }

  @Post('position/:positionId/close')
  async closePosition(
    @Param('positionId') positionId: string,
    @Request() req: RequestWithUser,
  ) {
    return this.tradeService.closePosition(positionId, req.user.publicKey);
  }

  @Get('positions')
  async getUserPositions(@Request() req: RequestWithUser) {
    return this.tradeService.getUserPositions(req.user.publicKey);
  }

  @Get('position/:positionId')
  async getPosition(
    @Param('positionId') positionId: string,
    @Request() req: RequestWithUser,
  ) {
    return this.tradeService.getPosition(positionId);
  }

  @Get('trades')
  async getUserTrades(@Request() req: RequestWithUser) {
    return this.tradeService.getUserTrades(req.user.publicKey);
  }
}
