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
import { OrderSide } from 'src/types/trade.types';

@Injectable()
export class MarketService {
  // Initial virtual AMM reserves and k value
  private readonly INITIAL_RESERVE_BALANCE = 1_000_000; // $1M each side
  private readonly SPL_BASE_UNIT = 1e9;
  private readonly USDC_BASE_UNIT = 1e6;
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
        // Calculate new funding rate based on price difference
        const newFundingRate = await this.calculateFundingRate(market);

        await this.databaseService.update<Market>(
          'markets',
          {
            fundingRate: newFundingRate,
          },
          { id: market.id },
        );
      }),
    );
  }

  /**
   * @audit - Make vAMM model optional --> tokens with sufficient liq can avoid?
   */
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

    // Get initial oracle price
    const initialPrice = await this.priceService.getCurrentPrice(
      dto.tokenAddress,
    );

    /**
     * $1m / price = tokens --> expand to base 9
     * e.g price = $2.22
     * $1m of asset = 450,450 tokens
     * expand to base 9 = 450,450 * 1e9 = 450,450.000_000_000
     * Rounded to nearest integer.
     */
    const baseReserve = Math.round(
      Number(
        multiply(
          divide(this.INITIAL_RESERVE_BALANCE, initialPrice),
          this.SPL_BASE_UNIT,
        ),
      ),
    ).toString();
    // Convert 1m USD to USDC by expanding units to base 6
    const quoteReserve = multiply(baseReserve, this.USDC_BASE_UNIT);
    const k = multiply(baseReserve, quoteReserve);

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
      // Virtual AMM initialization
      virtualBaseReserve: baseReserve,
      virtualQuoteReserve: quoteReserve,
      virtualK: k,
    });

    // Initialize market stats
    await this.statsService.addVolume(market.id, '0');

    await this.invalidateMarketCache();
    return market;
  }

  async updateMarket(marketId: string, dto: UpdateMarketDto): Promise<Market> {
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

    return await this.calculateFundingRate(market);
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

  /**
   * Update virtual AMM state after a trade
   * @param marketId Market ID
   * @param side Order side
   * @param size Position size in USD
   */
  async updateVirtualAMM(
    marketId: string,
    side: OrderSide,
    size: string,
  ): Promise<void> {
    const market = await this.getMarketById(marketId);

    // Calculate new reserves
    const baseReserve = market.virtualBaseReserve;
    const quoteReserve = market.virtualQuoteReserve;

    let newBaseReserve: string;
    let newQuoteReserve: string;

    if (side === OrderSide.LONG) {
      const baseOut = divide(multiply(size, baseReserve), quoteReserve);
      newBaseReserve = subtract(baseReserve, baseOut);
      newQuoteReserve = add(quoteReserve, size);
    } else {
      const quoteOut = size;
      newQuoteReserve = subtract(quoteReserve, quoteOut);
      newBaseReserve = add(
        baseReserve,
        divide(size, divide(quoteReserve, baseReserve)),
      );
    }

    // Update market state
    await this.databaseService.update<Market>(
      'markets',
      {
        virtualBaseReserve: newBaseReserve,
        virtualQuoteReserve: newQuoteReserve,
      },
      { id: marketId },
    );

    await this.invalidateMarketCache();
  }

  /**
   * Calculate funding rate based on difference between virtual price and oracle price
   * @audit Need new formula --> this doesn't work
   * @param market Current market state
   * @returns Updated funding rate
   */
  private async calculateFundingRate(market: Market): Promise<string> {
    // Get latest oracle price
    const [virtualPrice, oraclePrice] = await Promise.all([
      this.priceService.getVirtualPrice(market.id),
      this.priceService.getOraclePrice(market.id),
    ]);

    // Calculate price difference percentage
    const priceDiff = divide(subtract(virtualPrice, oraclePrice), oraclePrice);

    // Funding rate is proportional to price difference
    // If virtual price > oracle price, longs pay shorts
    // If virtual price < oracle price, shorts pay longs
    const fundingRate = multiply(priceDiff, '0.01'); // 1% dampening factor

    // Clamp funding rate to max
    return clamp(
      fundingRate,
      multiply(market.maxFundingRate, '-1'),
      market.maxFundingRate,
    );
  }

  /**
   * Update virtual AMM reserves after a trade
   */
  async updateVirtualReserves(
    marketId: string,
    side: OrderSide,
    size: string,
  ): Promise<void> {
    const market = await this.getMarketById(marketId);
    const baseReserve = market.virtualBaseReserve; // base-9
    const quoteReserve = market.virtualQuoteReserve; // base-6

    let newBaseReserve: string;
    let newQuoteReserve: string;

    if (side === OrderSide.LONG) {
      // Convert USD size to USDC base-6 units, accounting for USDC price
      const usdcPrice = await this.priceService.getUsdcPrice();
      const sizeInBaseUnits = multiply(
        divide(size, usdcPrice),
        this.USDC_BASE_UNIT,
      );

      const baseOut = divide(
        multiply(sizeInBaseUnits, baseReserve),
        quoteReserve,
      );
      newBaseReserve = subtract(baseReserve, baseOut);
      newQuoteReserve = add(quoteReserve, sizeInBaseUnits);
    } else {
      // For shorts: Convert USD size to base token units using token price
      const tokenPrice = await this.priceService.getCurrentPrice(marketId);
      const sizeInBaseUnits = multiply(
        divide(size, tokenPrice),
        this.SPL_BASE_UNIT,
      ); // Convert to base-9

      newBaseReserve = add(baseReserve, sizeInBaseUnits);
      newQuoteReserve = divide(market.virtualK, newBaseReserve);
    }

    await this.databaseService.update<Market>(
      'markets',
      {
        virtualBaseReserve: newBaseReserve,
        virtualQuoteReserve: newQuoteReserve,
      },
      { id: marketId },
    );

    // Update virtual price in PriceService
    await this.priceService.updateVirtualPrice(marketId, side, size);

    await this.invalidateMarketCache();
  }
}
