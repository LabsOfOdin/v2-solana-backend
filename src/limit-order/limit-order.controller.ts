import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { LimitOrderService } from './limit-order.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrderRequest } from '../types/trade.types';
import { Request as ExpressRequest } from 'express';
import { User } from '../entities/user.entity';

interface RequestWithUser extends ExpressRequest {
  user: User;
}

@Controller('limit-orders')
@UseGuards(JwtAuthGuard)
export class LimitOrderController {
  constructor(private readonly limitOrderService: LimitOrderService) {}

  @Post()
  async createLimitOrder(
    @Body() orderRequest: OrderRequest,
    @Request() req: RequestWithUser,
  ) {
    orderRequest.userId = req.user.publicKey;
    return this.limitOrderService.createLimitOrder(orderRequest);
  }

  @Delete(':orderId')
  async cancelLimitOrder(
    @Param('orderId') orderId: string,
    @Request() req: RequestWithUser,
  ) {
    return this.limitOrderService.cancelLimitOrder(orderId, req.user.publicKey);
  }

  @Get()
  async getUserLimitOrders(@Request() req: RequestWithUser) {
    return this.limitOrderService.getUserLimitOrders(req.user.publicKey);
  }

  @Get('market/:marketId')
  async getMarketLimitOrders(@Param('marketId') marketId: string) {
    return this.limitOrderService.getMarketLimitOrders(marketId);
  }
}
