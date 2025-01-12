import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { PriceService } from './price.service';
import { PublicKey } from '@solana/web3.js';

@Controller('price')
export class PriceController {
  constructor(private readonly priceService: PriceService) {}

  @Get('market/:marketId')
  async getCurrentPrice(@Param('marketId') marketId: string): Promise<string> {
    return this.priceService.getCurrentPrice(marketId);
  }

  @Get('virtual-price/:marketId')
  async getVirtualPrice(@Param('marketId') marketId: string): Promise<string> {
    return this.priceService.getVirtualPrice(marketId);
  }

  @Get('sol')
  async getSolPrice(): Promise<number> {
    return await this.priceService.getSolPrice();
  }

  @Get('usdc')
  async getUsdcPrice(): Promise<number> {
    return await this.priceService.getUsdcPrice();
  }

  @Get('ohlcv')
  async getOHLCV(
    @Query('marketId') marketId: string,
    @Query('timeframe') timeframe: string,
    @Query('startTime') startTime: number,
    @Query('endTime') endTime: number,
    @Query('limit') limit?: number,
  ) {
    try {
      return this.priceService.getOHLCV(
        marketId,
        timeframe,
        startTime,
        endTime,
        limit,
      );
    } catch (error) {
      throw new NotFoundException('Params Error');
    }
  }

  @Get('dao-curves')
  async getAllCurves(): Promise<PublicKey[]> {
    return this.priceService.getAllCurves();
  }

  @Get('dao/:depositor')
  async getDaoPrice(@Param('depositor') depositor: string) {
    try {
      const depositorPubkey = new PublicKey(depositor);
      return await this.priceService.getDaoPrice(depositorPubkey);
    } catch (error) {
      throw new NotFoundException(
        'Invalid depositor address or price not found',
      );
    }
  }
}
