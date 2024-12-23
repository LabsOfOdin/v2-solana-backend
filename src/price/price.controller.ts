import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { PriceService } from './price.service';

@Controller('price')
export class PriceController {
  constructor(private readonly priceService: PriceService) {}

  @Get('market/:marketId')
  async getCurrentPrice(@Param('marketId') marketId: string): Promise<string> {
    return this.priceService.getCurrentPrice(marketId);
  }

  @Get('sol')
  async getSolPrice(): Promise<number> {
    return await this.priceService.getSolPrice();
  }

  @Get('usdc')
  async getUsdcPrice(): Promise<number> {
    return await this.priceService.getUsdcPrice();
  }

  @Get('geckoterminal-ohlcv')
  async getGeckoTerminalOHLCV(
    @Query('network') network: string,
    @Query('poolAddress') poolAddress: string,
    @Query('timeframe') timeframe: string,
    @Query('aggregate') aggregate: string,
    @Query('beforeTimestamp') beforeTimestamp?: number,
    @Query('limit') limit?: number,
    @Query('currency') currency?: string,
    @Query('token') token?: string,
  ) {
    try {
      return this.priceService.fetchGeckoTerminalOHLCV(
        network,
        poolAddress,
        timeframe,
        aggregate,
        beforeTimestamp,
        limit,
        currency,
        token,
      );
    } catch (error) {
      throw new NotFoundException('Params Error');
    }
  }
}
