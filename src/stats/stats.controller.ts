import { Controller, Get, Param } from '@nestjs/common';
import { StatsService } from './stats.service';
import { MarketStats } from '../entities/market-stats.entity';

@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('market/:marketId')
  async getMarketStats(
    @Param('marketId') marketId: string,
  ): Promise<MarketStats> {
    return this.statsService.getMarketStats(marketId);
  }
}
