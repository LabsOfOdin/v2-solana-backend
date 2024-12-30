import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import { MarketService } from './market.service';
import { PinAuthGuard } from '../auth/pin-auth.guard';
import { CreateMarketDto, UpdateMarketDto } from '../types/market.types';

@Controller('markets')
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  @Get()
  async getAllMarkets() {
    return this.marketService.getAllMarkets();
  }

  @Get(':id')
  async getMarket(@Param('id') id: string) {
    return this.marketService.getMarketInfo(id);
  }

  @Get('symbol/:symbol')
  async getMarketBySymbol(@Param('symbol') symbol: string) {
    return this.marketService.getMarketBySymbol(symbol);
  }

  @Get(':id/funding-rate')
  async getFundingRate(@Param('id') id: string) {
    return this.marketService.getFundingRate(id);
  }

  @Post()
  @UseGuards(PinAuthGuard)
  async createMarket(@Body() dto: CreateMarketDto) {
    return this.marketService.createMarket(dto);
  }

  @Put(':id')
  @UseGuards(PinAuthGuard)
  async updateMarket(@Param('id') id: string, @Body() dto: UpdateMarketDto) {
    return this.marketService.updateMarket(id, dto);
  }
}
