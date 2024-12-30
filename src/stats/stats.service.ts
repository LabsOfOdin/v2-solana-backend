import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';
import { MarketStats } from '../entities/market-stats.entity';
import { add } from '../lib/math';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class StatsService {
  constructor(
    private readonly databaseService: DatabaseService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getMarketStats(marketId: string): Promise<MarketStats> {
    const cacheKey = `market:stats:${marketId}`;
    const cachedStats = await this.cacheManager.get<MarketStats>(cacheKey);

    if (cachedStats) {
      return cachedStats;
    }

    const [stats] = await this.databaseService.select<MarketStats>(
      'market_stats',
      {
        eq: { marketId },
        limit: 1,
      },
    );

    if (!stats) {
      throw new NotFoundException(`Stats for market ${marketId} not found`);
    }

    await this.cacheManager.set(cacheKey, stats, 60 * 1000); // 1 minute TTL
    return stats;
  }

  async addVolume(marketId: string, volume: string): Promise<void> {
    try {
      // First try to get existing stats
      let stats: MarketStats;

      try {
        stats = await this.getMarketStats(marketId);
      } catch (error) {
        if (error instanceof NotFoundException) {
          // Create new stats if they don't exist
          [stats] = await this.databaseService.insert<MarketStats>(
            'market_stats',
            {
              id: crypto.randomUUID(),
              marketId,
              allTimeVolume: '0',
              volume24h: '0',
              lastUpdatedTimestamp: Date.now(),
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          );
        } else {
          throw error;
        }
      }

      // Now update the stats
      await this.databaseService.update<MarketStats>(
        'market_stats',
        {
          allTimeVolume: add(stats.allTimeVolume, volume),
          volume24h: add(stats.volume24h, volume),
          lastUpdatedTimestamp: Date.now(),
          updatedAt: new Date(),
        },
        { id: stats.id },
      );

      await this.invalidateStatsCache(marketId);
    } catch (error) {
      console.error('Error adding volume:', error);
      throw new InternalServerErrorException('Failed to update market stats');
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  private async reset24hVolume(): Promise<void> {
    // Reset 24h volume for all markets
    const allStats = await this.databaseService.select<MarketStats>(
      'market_stats',
      {},
    );

    await Promise.all(
      allStats.map(async (stats) => {
        await this.databaseService.update<MarketStats>(
          'market_stats',
          {
            volume24h: '0',
            lastUpdatedTimestamp: Date.now(),
            updatedAt: new Date(),
          },
          { id: stats.id },
        );
        await this.invalidateStatsCache(stats.marketId);
      }),
    );
  }

  private async invalidateStatsCache(marketId: string): Promise<void> {
    const cacheKey = `market:stats:${marketId}`;
    await this.cacheManager.del(cacheKey);
  }
}
