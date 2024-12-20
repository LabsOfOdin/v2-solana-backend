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

@Controller('limit-orders')
@UseGuards(JwtAuthGuard)
export class LimitOrderController {
  constructor(private readonly limitOrderService: LimitOrderService) {}

  @Post()
  async createLimitOrder(@Body() orderRequest: OrderRequest, @Request() req) {
    // Ensure the user ID matches the authenticated user
    orderRequest.userId = req.user.id;
    return this.limitOrderService.createLimitOrder(orderRequest);
  }

  @Delete(':orderId')
  async cancelLimitOrder(@Param('orderId') orderId: string, @Request() req) {
    return this.limitOrderService.cancelLimitOrder(orderId, req.user.id);
  }

  @Get('user')
  async getUserLimitOrders(@Request() req) {
    return this.limitOrderService.getUserLimitOrders(req.user.id);
  }

  @Get('market/:marketId')
  async getMarketLimitOrders(@Param('marketId') marketId: string) {
    return this.limitOrderService.getMarketLimitOrders(marketId);
  }
}
