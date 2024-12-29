import {
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Market } from '../entities/market.entity';
import {
  CreateMarketDto,
  UpdateMarketDto,
  MarketInfo,
  MarketStats,
} from '../types/market.types';
import { PriceService } from '../price/price.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { add } from 'src/lib/math';

@Injectable()
export class MarketService {
  constructor(
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => PriceService))
    private readonly priceService: PriceService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async updateFundingRates(): Promise<void> {
    const markets = await this.databaseService.select<Market>('markets', {});

    await Promise.all(
      markets.map((market) => this.calculateFundingRate(market)),
    );

    console.log('Funding rates updated for all markets');
  }

  async createMarket(dto: CreateMarketDto): Promise<Market> {
    const [existingMarket] = await this.databaseService.select<Market>(
      'markets',
      {
        eq: { symbol: dto.symbol },
        limit: 1,
      },
    );

    if (existingMarket) {
      throw new ConflictException(`Market ${dto.symbol} already exists`);
    }

    const [market] = await this.databaseService.insert<Market>('markets', {
      ...dto,
      longOpenInterest: '0',
      shortOpenInterest: '0',
      fundingRate: '0',
      fundingRateVelocity: '0',
      maxFundingRate: dto.maxFundingRate || '0.0003',
      maxFundingVelocity: dto.maxFundingVelocity || '0.01',
      borrowingRate: dto.borrowingRate || '0.0003',
      lastUpdatedTimestamp: Date.now(),
    });

    await this.invalidateMarketCache();
    return market;
  }

  async updateMarket(marketId: string, dto: UpdateMarketDto): Promise<Market> {
    const market = await this.getMarketById(marketId);
    const updateData: Partial<Market> = { ...dto };

    if (dto.longOpenInterest) {
      updateData.longOpenInterest = dto.longOpenInterest;
    }

    if (dto.shortOpenInterest) {
      updateData.shortOpenInterest = dto.shortOpenInterest;
    }

    if (dto.borrowingRate) {
      updateData.borrowingRate = dto.borrowingRate;
    }

    if (dto.maxFundingRate) {
      updateData.maxFundingRate = dto.maxFundingRate;
    }

    if (dto.maxFundingVelocity) {
      updateData.maxFundingVelocity = dto.maxFundingVelocity;
    }

    const [updatedMarket] = await this.databaseService.update<Market>(
      'markets',
      updateData,
      { id: marketId },
    );

    await this.invalidateMarketCache();
    return updatedMarket;
  }

  async getMarketById(marketId: string): Promise<Market> {
    const cacheKey = `market:${marketId}`;
    const cachedMarket = await this.cacheManager.get<Market>(cacheKey);

    if (cachedMarket) {
      return cachedMarket;
    }

    const [market] = await this.databaseService.select<Market>('markets', {
      eq: { id: marketId },
      limit: 1,
    });

    if (!market) {
      throw new NotFoundException(`Market ${marketId} not found`);
    }

    await this.cacheManager.set(cacheKey, market, 60 * 60 * 1000); // 1 hour TTL
    return market;
  }

  async getMarketBySymbol(symbol: string): Promise<Market> {
    const cacheKey = `market:symbol:${symbol}`;
    const cachedMarket = await this.cacheManager.get<Market>(cacheKey);

    if (cachedMarket) {
      return cachedMarket;
    }

    const [market] = await this.databaseService.select<Market>('markets', {
      eq: { symbol },
      limit: 1,
    });

    if (!market) {
      throw new NotFoundException(`Market ${symbol} not found`);
    }

    await this.cacheManager.set(cacheKey, market, 60 * 60 * 1000); // 1 hour TTL
    return market;
  }

  async getAllMarkets(): Promise<MarketInfo[]> {
    const cacheKey = 'markets:all';
    const cachedMarkets = await this.cacheManager.get<MarketInfo[]>(cacheKey);

    if (cachedMarkets) {
      return cachedMarkets;
    }

    const markets = await this.databaseService.select<Market>('markets', {
      order: { column: 'symbol', ascending: true },
    });

    // Transform markets into MarketInfo array
    const marketsInfo = await Promise.all(
      markets.map(async (market) => {
        const lastPrice = await this.priceService.getCurrentPrice(market.id);
        return {
          ...market,
          lastPrice,
          volume24h: '0',
          openInterest: '0',
        };
      }),
    );

    await this.cacheManager.set(cacheKey, marketsInfo, 60 * 60 * 1000); // 1 hour TTL
    return marketsInfo;
  }

  async getMarketInfo(marketId: string): Promise<MarketInfo> {
    const market = await this.getMarketById(marketId);
    const lastPrice = await this.priceService.getCurrentPrice(marketId);

    return {
      ...market,
      lastPrice,
      volume24h: '0',
      openInterest: '0',
      borrowingRate: market.borrowingRate,
      longOpenInterest: market.longOpenInterest,
      shortOpenInterest: market.shortOpenInterest,
    };
  }

  async updateFundingRate(marketId: string): Promise<void> {
    const market = await this.getMarketById(marketId);
    const newFundingRate = await this.calculateFundingRate(market);

    await this.databaseService.update<Market>(
      'markets',
      { fundingRate: newFundingRate },
      { id: marketId },
    );

    await this.invalidateMarketCache();
  }

  async getFundingRate(marketId: string): Promise<{
    currentRate: string;
    estimatedRate: string;
    unrecordedFunding: string;
  }> {
    const market = await this.getMarketById(marketId);

    // Calculate current funding rate
    const currentFundingRate = await this.calculateFundingRate(market);

    // Calculate unrecorded funding
    const unrecordedFunding = await this.calculateUnrecordedFunding(market);

    // Compute estimated rate
    const estimatedRate = (
      Number(currentFundingRate) + Number(unrecordedFunding)
    ).toFixed(8);

    return {
      currentRate: currentFundingRate,
      estimatedRate,
      unrecordedFunding,
    };
  }

  async getFundingHistory(
    marketId: string,
    startTime?: string,
    endTime?: string,
  ): Promise<{
    history: {
      timestamp: Date;
      rate: string;
      price: string;
    }[];
  }> {
    const cacheKey = `funding:history:${marketId}:${startTime}:${endTime}`;
    const cachedHistory = await this.cacheManager.get<{ history: any[] }>(
      cacheKey,
    );

    if (cachedHistory) {
      return cachedHistory;
    }

    await this.getMarketById(marketId); // Verify market exists

    const start = startTime
      ? new Date(startTime)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endTime ? new Date(endTime) : new Date();

    // Generate history (mock data for now)
    const history = [];
    let currentTime = new Date(start);

    while (currentTime <= end) {
      const price = await this.priceService.getCurrentPrice(marketId);
      history.push({
        timestamp: new Date(currentTime),
        rate: '0.0001',
        price,
      });

      currentTime = new Date(currentTime.getTime() + 8 * 60 * 60 * 1000);
    }

    const result = { history };
    await this.cacheManager.set(cacheKey, result, 5 * 60 * 1000); // 5 minutes TTL
    return result;
  }

  async getMarketStats(marketId: string): Promise<MarketStats> {
    const market = await this.getMarketById(marketId);
    const currentPrice = await this.priceService.getCurrentPrice(marketId);

    const stats = {
      markPrice: currentPrice,
      priceChange24h: '0',
      volume24h: '0',
      openInterest: '0',
      fundingRate: market.fundingRate,
      maxLeverage: market.maxLeverage,
      liquidationFee: '0.025',
      borrowingRate: market.borrowingRate,
      longOpenInterest: market.longOpenInterest,
      shortOpenInterest: market.shortOpenInterest,
    };

    await this.cacheManager.set(`market:stats:${marketId}`, stats, 60 * 1000); // 1 minute TTL
    return stats;
  }

  private async calculateFundingRate(market: Market): Promise<string> {
    const now = Date.now();
    const timeElapsed = (now - market.lastUpdatedTimestamp) / 1000;

    // Calculate skew and skewScale dynamically
    const longOI = Number(market.longOpenInterest);
    const shortOI = Number(market.shortOpenInterest);
    const skew = longOI - shortOI;
    const skewScale = longOI + shortOI;

    // Avoid division by zero
    const proportionalSkew = skewScale > 0 ? skew / skewScale : 0;

    // Scale maxFundingVelocity to the elapsed time
    const maxVelocityPerSecond = Number(market.maxFundingVelocity) / 86400;
    const clampedVelocity =
      Math.min(maxVelocityPerSecond * timeElapsed, Math.abs(proportionalSkew)) *
      Math.sign(proportionalSkew);

    const newFundingRateVelocity =
      Number(market.fundingRateVelocity) + clampedVelocity;

    // Scale maxFundingRate to the elapsed time
    const maxRatePerSecond = Number(market.maxFundingRate) / 86400;
    let currentFundingRate =
      Number(market.fundingRate) +
      newFundingRateVelocity * (timeElapsed / 86400);

    // Clamp funding rate
    currentFundingRate = Math.max(
      -maxRatePerSecond * timeElapsed,
      Math.min(maxRatePerSecond * timeElapsed, currentFundingRate),
    );

    // Update market properties
    await this.databaseService.update<Market>(
      'markets',
      {
        fundingRateVelocity: newFundingRateVelocity.toString(),
        lastUpdatedTimestamp: now,
      },
      { id: market.id },
    );

    return currentFundingRate.toFixed(8);
  }

  private async calculateUnrecordedFunding(market: Market): Promise<string> {
    const now = Date.now();
    const timeElapsed = (now - market.lastUpdatedTimestamp) / 1000; // in seconds

    const currentFundingRate = await this.calculateFundingRate(market);
    const avgFundingRate =
      -(Number(market.fundingRate) + Number(currentFundingRate)) / 2;

    const unrecordedFunding = avgFundingRate * (timeElapsed / 86400); // seconds in a day
    return unrecordedFunding.toFixed(8); // Return a string with 8 decimal places
  }

  private async invalidateMarketCache(market?: Market): Promise<void> {
    const keys = ['markets:all'];

    if (market) {
      keys.push(
        `market:${market.id}`,
        `market:symbol:${market.symbol}`,
        `market:stats:${market.id}`,
      );
    }

    await Promise.all(keys.map((key) => this.cacheManager.del(key)));
  }

  /**
   * @warning CLEARS FEES TO 0! MAKE SURE TO NOTE FEES DOWN IN
   * ORDER TO HANDLE DISTRIBUTION OF REWARDS!!
   */
  async claimFees(marketId: string): Promise<{ claimedAmount: string }> {
    const market = await this.getMarketById(marketId);
    const claimedAmount = market.unclaimedFees;

    await this.databaseService.update<Market>(
      'markets',
      { unclaimedFees: '0' },
      { id: marketId },
    );

    await this.invalidateMarketCache();
    return { claimedAmount };
  }

  async addTradingFees(marketId: string, fees: string): Promise<void> {
    const market = await this.getMarketById(marketId);

    await this.databaseService.update<Market>(
      'markets',
      {
        cumulativeFees: add(market.cumulativeFees, fees),
        unclaimedFees: add(market.unclaimedFees, fees),
      },
      { id: marketId },
    );

    await this.invalidateMarketCache();
  }
}
