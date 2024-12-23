import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Market } from '../entities/market.entity';
import {
  CreateMarketDto,
  UpdateMarketDto,
  MarketInfo,
  MarketStats,
} from '../types/market.types';
import { MathService } from '../utils/math.service';
import { PriceService } from '../price/price.service';
import { getAdminWallet } from 'src/common/config';

@Injectable()
export class MarketService {
  constructor(
    @InjectRepository(Market)
    private readonly marketRepository: Repository<Market>,
    private readonly mathService: MathService,
    private readonly priceService: PriceService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async createMarket(
    dto: CreateMarketDto,
    adminPublicKey: string,
  ): Promise<Market> {
    if (adminPublicKey !== getAdminWallet()) {
      throw new UnauthorizedException('Only admin can create markets');
    }

    const existingMarket = await this.marketRepository.findOne({
      where: { symbol: dto.symbol },
    });

    if (existingMarket) {
      throw new ConflictException(`Market ${dto.symbol} already exists`);
    }

    const market = this.marketRepository.create({
      ...dto,
      fundingRate: '0',
    });

    const savedMarket = await this.marketRepository.save(market);
    await this.invalidateMarketCache();
    return savedMarket;
  }

  async updateMarket(
    marketId: string,
    dto: UpdateMarketDto,
    adminPublicKey: string,
  ): Promise<Market> {
    if (adminPublicKey !== getAdminWallet()) {
      throw new UnauthorizedException('Only admin can update markets');
    }

    const market = await this.getMarketById(marketId);
    Object.assign(market, dto);

    const updatedMarket = await this.marketRepository.save(market);
    await this.invalidateMarketCache();
    return updatedMarket;
  }

  async getMarketById(marketId: string): Promise<Market> {
    const cacheKey = `market:${marketId}`;
    const cachedMarket = await this.cacheManager.get<Market>(cacheKey);

    if (cachedMarket) {
      return cachedMarket;
    }

    const market = await this.marketRepository.findOne({
      where: { id: marketId },
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

    const market = await this.marketRepository.findOne({
      where: { symbol },
    });

    if (!market) {
      throw new NotFoundException(`Market ${symbol} not found`);
    }

    await this.cacheManager.set(cacheKey, market, 60 * 60 * 1000); // 1 hour TTL
    return market;
  }

  async getAllMarkets(): Promise<Market[]> {
    const cacheKey = 'markets:all';
    const cachedMarkets = await this.cacheManager.get<Market[]>(cacheKey);

    if (cachedMarkets) {
      return cachedMarkets;
    }

    const markets = await this.marketRepository.find({
      order: { symbol: 'ASC' },
    });

    await this.cacheManager.set(cacheKey, markets, 60 * 60 * 1000); // 1 hour TTL
    return markets;
  }

  async getMarketInfo(marketId: string): Promise<MarketInfo> {
    const market = await this.getMarketById(marketId);
    const lastPrice = await this.priceService.getCurrentPrice(marketId);

    // Don't cache this as it includes real-time price
    const volume24h = '0';
    const openInterest = '0';

    return {
      ...market,
      lastPrice,
      volume24h,
      openInterest,
    };
  }

  async updateFundingRate(marketId: string): Promise<void> {
    const market = await this.getMarketById(marketId);
    const newFundingRate = await this.calculateFundingRate(market);

    await this.marketRepository.update(marketId, {
      fundingRate: newFundingRate,
    });

    await this.invalidateMarketCache();
  }

  async getFundingRate(marketId: string): Promise<{
    currentRate: string;
    nextFundingTime: Date;
    estimatedRate: string;
  }> {
    const market = await this.getMarketById(marketId);
    const nextFundingTime = this.getNextFundingTime();
    const estimatedRate = await this.calculateEstimatedFundingRate(market);

    // Don't cache as funding rates change frequently
    return {
      currentRate: market.fundingRate,
      nextFundingTime,
      estimatedRate,
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
    const cacheKey = `market:stats:${marketId}`;
    const cachedStats = await this.cacheManager.get<MarketStats>(cacheKey);

    if (cachedStats) {
      return cachedStats;
    }

    const market = await this.getMarketById(marketId);
    const currentPrice = await this.priceService.getCurrentPrice(marketId);

    const stats = {
      price: currentPrice,
      priceChange24h: '0',
      volume24h: '0',
      openInterest: '0',
      fundingRate: market.fundingRate,
      nextFundingTime: this.getNextFundingTime(),
      markPrice: currentPrice,
      indexPrice: currentPrice,
      maxLeverage: market.maxLeverage,
      liquidationFee: '0.025',
      tradingFee: market.takerFee,
      borrowingRate: '0.0003',
    };

    await this.cacheManager.set(cacheKey, stats, 60 * 1000); // 1 minute TTL
    return stats;
  }

  private getNextFundingTime(): Date {
    const now = new Date();
    const nextFunding = new Date(now);
    const hours = now.getUTCHours();
    const nextFundingHour = Math.ceil(hours / 8) * 8;

    nextFunding.setUTCHours(nextFundingHour, 0, 0, 0);

    if (nextFunding <= now) {
      nextFunding.setTime(nextFunding.getTime() + 8 * 60 * 60 * 1000);
    }

    return nextFunding;
  }

  private async calculateFundingRate(market: Market): Promise<string> {
    return '0.0001';
  }

  private async calculateEstimatedFundingRate(market: Market): Promise<string> {
    return '0.0001';
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
}
