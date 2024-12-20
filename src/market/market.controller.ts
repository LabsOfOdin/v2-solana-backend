import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { MarketService } from './market.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
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

  @Post()
  @UseGuards(JwtAuthGuard)
  async createMarket(@Body() dto: CreateMarketDto, @Request() req) {
    return this.marketService.createMarket(dto, req.user.publicKey);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async updateMarket(
    @Param('id') id: string,
    @Body() dto: UpdateMarketDto,
    @Request() req,
  ) {
    return this.marketService.updateMarket(id, dto, req.user.publicKey);
  }
}
