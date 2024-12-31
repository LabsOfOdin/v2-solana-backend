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
} from '../types/market.types';
import { PriceService } from '../price/price.service';
import { StatsService } from '../stats/stats.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { add, clamp, divide, multiply, subtract } from 'src/lib/math';
import { TokenType } from 'src/types/token.types';
import { SECONDS_IN_DAY } from 'src/common/config';

@Injectable()
export class MarketService {
  constructor(
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => PriceService))
    private readonly priceService: PriceService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly statsService: StatsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async updateFundingRates(): Promise<void> {
    const markets = await this.databaseService.select<Market>('markets', {});

    await Promise.all(
      markets.map(async (market) => {
        // Calculate the new rate and velocity
        const currentFundingRate = await this.getCurrentFundingRate(market);

        const newFundingRateVelocity = await this.getCurrentVelocity(market);

        // Update them in the database
        await this.databaseService.update<Market>(
          'markets',
          {
            fundingRate: currentFundingRate,
            fundingRateVelocity: newFundingRateVelocity,
          },
          { id: market.id },
        );
      }),
    );
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
      availableLiquidity: dto.availableLiquidity || '0',
      cumulativeFeesSol: '0',
      cumulativeFeesUsdc: '0',
      unclaimedFeesSol: '0',
      unclaimedFeesUsdc: '0',
    });

    // Initialize market stats
    await this.statsService.addVolume(market.id, '0');

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

    if (dto.availableLiquidity) {
      updateData.availableLiquidity = dto.availableLiquidity;
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
    const marketsInfo: MarketInfo[] = await Promise.all(
      markets.map(async (market) => {
        const lastPrice = await this.priceService.getCurrentPrice(market.id);

        let volume24h = '0';
        try {
          const stats = await this.statsService.getMarketStats(market.id);
          volume24h = stats.volume24h;
        } catch (error) {
          // If stats don't exist yet, default to 0
        }

        return {
          id: market.id,
          symbol: market.symbol,
          tokenAddress: market.tokenAddress,
          poolAddress: market.poolAddress,
          maxLeverage: market.maxLeverage,
          maintainanceMargin: market.maintainanceMargin,
          borrowingRate: market.borrowingRate,
          fundingRate: market.fundingRate,
          fundingRateVelocity: market.fundingRateVelocity,
          lastUpdatedTimestamp: market.lastUpdatedTimestamp,
          longOpenInterest: market.longOpenInterest,
          shortOpenInterest: market.shortOpenInterest,
          availableLiquidity: market.availableLiquidity,
          volume24h,
          lastPrice,
        };
      }),
    );

    await this.cacheManager.set(cacheKey, marketsInfo, 60 * 60 * 1000); // 1 hour TTL
    return marketsInfo;
  }

  async getMarketInfo(marketId: string): Promise<MarketInfo> {
    const market = await this.getMarketById(marketId);

    const lastPrice = await this.priceService.getCurrentPrice(market.id);

    let volume24h = '0';
    try {
      const stats = await this.statsService.getMarketStats(market.id);
      volume24h = stats.volume24h;
    } catch (error) {
      // If stats don't exist yet, default to 0
    }

    const marketInfo: MarketInfo = {
      id: market.id,
      symbol: market.symbol,
      tokenAddress: market.tokenAddress,
      poolAddress: market.poolAddress,
      maxLeverage: market.maxLeverage,
      maintainanceMargin: market.maintainanceMargin,
      borrowingRate: market.borrowingRate,
      fundingRate: market.fundingRate,
      fundingRateVelocity: market.fundingRateVelocity,
      lastUpdatedTimestamp: market.lastUpdatedTimestamp,
      longOpenInterest: market.longOpenInterest,
      shortOpenInterest: market.shortOpenInterest,
      availableLiquidity: market.availableLiquidity,
      volume24h,
      lastPrice,
    };

    return marketInfo;
  }

  async getFundingRate(marketId: string): Promise<string> {
    const market = await this.getMarketById(marketId);

    return await this.getCurrentFundingRate(market);
  }

  /**
   * @dev currentFundingRate = fundingRate + fundingRateVelocity * timeElapsed
   * @audit make sure to clamp between max and min
   */
  private async getCurrentFundingRate(market: Market): Promise<string> {
    const proportionalTimeElapsed = divide(
      Date.now() - market.lastUpdatedTimestamp,
      SECONDS_IN_DAY,
    );

    const currentFundingRate = add(
      market.fundingRate,
      multiply(market.fundingRateVelocity, proportionalTimeElapsed),
    );

    return currentFundingRate;
  }

  /**
   * @dev proportionalSkew = skew / skewScale
   * @dev velocity         = proportionalSkew * maxFundingVelocity
   */
  private async getCurrentVelocity(market: Market): Promise<string> {
    const skew = subtract(market.longOpenInterest, market.shortOpenInterest);

    const skewScale = add(market.longOpenInterest, market.shortOpenInterest);

    const proportionalSkew = divide(skew, skewScale);

    // Clamp proportionalSkew between -1 and 1
    const pSkewBounded = clamp(proportionalSkew, -1, 1);

    return multiply(pSkewBounded, market.maxFundingVelocity);
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
   * @dev CLEARS FEES TO 0! MAKE SURE TO NOTE FEES DOWN IN
   * ORDER TO HANDLE DISTRIBUTION OF REWARDS!!
   */
  async claimFees(
    marketId: string,
    token: TokenType,
  ): Promise<{ claimedAmount: string }> {
    const market = await this.getMarketById(marketId);

    let claimedAmount: string;
    const updateData: Partial<Market> = {};

    if (token === TokenType.SOL) {
      claimedAmount = market.unclaimedFeesSol;
      updateData.unclaimedFeesSol = '0';
    } else if (token === TokenType.USDC) {
      claimedAmount = market.unclaimedFeesUsdc;
      updateData.unclaimedFeesUsdc = '0';
    } else {
      throw new Error('Invalid token type');
    }

    await this.databaseService.update<Market>('markets', updateData, {
      id: marketId,
    });

    await this.invalidateMarketCache();
    return { claimedAmount };
  }

  async addTradingFees(
    marketId: string,
    fees: string,
    token: TokenType,
  ): Promise<void> {
    const market = await this.getMarketById(marketId);
    const updateData: Partial<Market> = {};

    if (token === TokenType.SOL) {
      updateData.cumulativeFeesSol = add(market.cumulativeFeesSol, fees);
      updateData.unclaimedFeesSol = add(market.unclaimedFeesSol, fees);
    } else if (token === TokenType.USDC) {
      updateData.cumulativeFeesUsdc = add(market.cumulativeFeesUsdc, fees);
      updateData.unclaimedFeesUsdc = add(market.unclaimedFeesUsdc, fees);
    } else {
      throw new Error('Invalid token type');
    }

    await this.databaseService.update<Market>('markets', updateData, {
      id: marketId,
    });

    await this.invalidateMarketCache();
  }
}
