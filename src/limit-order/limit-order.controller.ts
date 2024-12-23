import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { LimitOrderService } from './limit-order.service';
import { LimitOrderRequest } from '../types/trade.types';
import { validatePublicKey } from 'src/common/validators';

@Controller('limit-orders')
export class LimitOrderController {
  constructor(private readonly limitOrderService: LimitOrderService) {}

  @Post()
  async createLimitOrder(@Body() orderRequest: LimitOrderRequest) {
    validatePublicKey(orderRequest.userId);
    return this.limitOrderService.createLimitOrder(orderRequest);
  }

  @Delete(':orderId')
  async cancelLimitOrder(
    @Param('orderId') orderId: string,
    @Query('publicKey') publicKey: string,
  ) {
    validatePublicKey(publicKey);
    return this.limitOrderService.cancelLimitOrder(orderId, publicKey);
  }

  @Get()
  async getUserLimitOrders(@Query('publicKey') publicKey: string) {
    validatePublicKey(publicKey);
    return this.limitOrderService.getUserLimitOrders(publicKey);
  }

  @Get('market/:marketId')
  async getMarketLimitOrders(@Param('marketId') marketId: string) {
    return this.limitOrderService.getMarketLimitOrders(marketId);
  }
}
