import { Controller, Get, Param } from '@nestjs/common';
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
    return this.priceService.getSolPrice();
  }

  @Get('usdc')
  async getUsdcPrice(): Promise<number> {
    return this.priceService.getUsdcPrice();
  }
}
