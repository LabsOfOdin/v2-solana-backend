import {
  Controller,
  Post,
  Put,
  Delete,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { TradeService } from './trade.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  OrderRequest,
  UpdatePositionRequest,
  PartialCloseRequest,
} from '../types/trade.types';

@Controller('trades')
@UseGuards(JwtAuthGuard)
export class TradeController {
  constructor(private readonly tradeService: TradeService) {}

  @Post('position')
  async openPosition(@Body() orderRequest: OrderRequest, @Request() req) {
    // Ensure the user ID matches the authenticated user
    orderRequest.userId = req.user.id;
    return this.tradeService.openPosition(orderRequest);
  }

  @Put('position/:positionId')
  async updatePosition(
    @Param('positionId') positionId: string,
    @Body() updates: UpdatePositionRequest,
    @Request() req,
  ) {
    return this.tradeService.updatePosition(positionId, req.user.id, updates);
  }

  @Post('position/:positionId/partial-close')
  async partialClosePosition(
    @Param('positionId') positionId: string,
    @Body() request: PartialCloseRequest,
    @Request() req,
  ) {
    return this.tradeService.partialClosePosition(
      positionId,
      req.user.id,
      request,
    );
  }

  @Delete('position/:positionId')
  async closePosition(@Param('positionId') positionId: string, @Request() req) {
    return this.tradeService.closePosition(positionId);
  }

  @Get('position/:positionId/borrowing-history')
  async getBorrowingHistory(
    @Param('positionId') positionId: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
  ) {
    return this.tradeService.getBorrowingHistory(
      positionId,
      startTime,
      endTime,
    );
  }

  @Get('positions')
  async getUserPositions(@Request() req) {
    return this.tradeService.getUserPositions(req.user.id);
  }

  @Get('position/:positionId')
  async getPosition(@Param('positionId') positionId: string, @Request() req) {
    return this.tradeService.getPosition(positionId);
  }

  @Get('position/:positionId/trades')
  async getPositionTrades(@Param('positionId') positionId: string) {
    return this.tradeService.getPositionTrades(positionId);
  }

  @Get('history')
  async getUserTrades(@Request() req) {
    return this.tradeService.getUserTrades(req.user.id);
  }
}
