import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { RateLimiter } from 'limiter';
import { Cache } from 'cache-manager';
import * as WebSocket from 'ws';
import { DatabaseService } from 'src/database/database.service';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { Program, BN, AnchorProvider } from '@coral-xyz/anchor';
import { VIRTUAL_XYK_IDL } from 'src/lib/idl/virtual_xyk';
import { VirtualXyk } from 'src/lib/idl/virtual_xyk.types';
import { CurveUtil } from 'src/lib/virtual-helpers';
import { multiply, divide, add, subtract, clamp } from 'src/lib/math';
import { getListedDaos, SOLANA_CONFIG } from 'src/common/config';
import { OrderSide } from 'src/types/trade.types';
import { Market } from 'src/entities/market.entity';
import {
  BASE_UNIT_DELTA,
  INITIAL_RESERVE_BALANCE,
  SPL_BASE_UNIT,
  USDC_BASE_UNIT,
} from 'src/common/constants';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OHLCV } from 'src/entities/ohlcv.entity';

/**
 * This service will be responsible for fetching prices for all assets within the protocol. We'll probably use
 * the Jupiter Swap API. Perhaps the QuickNode version if that enables us to get websocket connections.
 */

@Injectable()
export class PriceService {
  private binanceWebSocket: WebSocket;
  private wsConnected: boolean = false;

  // USDC/USD price from Binance
  private usdcPrice: number;
  // SOL/USD price from Binance
  private solPrice: number;

  // Store virtual AMM prices in memory
  private virtualPrices: Map<string, string> = new Map();

  // Number of seconds to converge to the oracle price (4 HRS)
  private CONVERGENCE_TRAJECTORY: number = 14400;

  // Rate limiter --> increase once updated to Metis v6 endpoint
  private solanaLimiter = new RateLimiter({
    tokensPerInterval: 600,
    interval: 'minute', // 600 requests per minute
  });

  private geckoTerminalLimiter = new RateLimiter({
    tokensPerInterval: 30,
    interval: 'minute',
  });

  private daoPrices: Map<string, number> = new Map(); // ticker -> price

  private marketReserves: Map<
    string,
    { baseReserve: string; quoteReserve: string }
  > = new Map();

  private readonly TIMEFRAME_MS = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '12h': 12 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
  };

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly databaseService: DatabaseService,
  ) {
    // Initialize WebSocket connections
    this.connectBinanceWebSocket();
    this.connectDaoWebSocket();
    // Fetch initial prices
    this.fetchInitialPrices();
  }

  /**
   * ========================== Cron Jobs ==========================
   *
   */

  /**
   * @dev Shifts the reserves of all markets to converge to the oracle price
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async shiftReserves(): Promise<void> {
    try {
      // Get all markets
      const markets = await this.databaseService.select<Market>('markets', {});

      await Promise.all(
        markets.map(async (market) => {
          // Get current prices
          const [virtualPrice, oraclePrice] = await Promise.all([
            this.getVirtualPrice(market.id),
            this.getLivePrice(market.id),
          ]);

          // Calculate price difference as a percentage
          const priceDiff = divide(
            subtract(virtualPrice, oraclePrice),
            oraclePrice,
          );

          // If price difference is less than 0.1%, don't adjust
          if (Math.abs(Number(priceDiff)) < 0.001) {
            return;
          }

          /**
           * The ratio the price should converge towards the oracle price each update.
           *
           * The trajectory is the total time it takes to converge, since we update every 10 seconds,
           * we divide the trajectory by 10 to get the number of updates it takes to converge.
           *
           * For example, if the trajectory is 3600 seconds, it will take 360 updates to converge.
           *
           * To get the adjustment factor, we divide 1 by the number of updates it takes to converge,
           * to get the convergence for each individual period.
           *
           * E.g 1/360 = 0.00278
           */
          const ADJUSTMENT_FACTOR = divide(
            '1',
            divide(this.CONVERGENCE_TRAJECTORY, 10),
          );

          // Calculate how much to shift the base reserve
          // If virtual price > oracle price: increase base reserve to lower price
          // If virtual price < oracle price: decrease base reserve to raise price
          const baseReserve = market.virtualBaseReserve;
          const adjustment = multiply(
            multiply(baseReserve, priceDiff),
            ADJUSTMENT_FACTOR,
          );

          // Calculate new base reserve
          const newBaseReserve = add(baseReserve, adjustment);

          // Update market state
          await this.databaseService.update<Market>(
            'markets',
            {
              virtualBaseReserve: newBaseReserve,
            },
            { id: market.id },
          );

          // Clear price cache
          this.virtualPrices.delete(market.id);
          this.marketReserves.delete(market.id);
        }),
      );
    } catch (error) {
      console.error('Error in shiftReserves:', this.getErrorMessage(error));
    }
  }

  /**
   * Update OHLCV data for all markets and timeframes
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async updateOHLCV(): Promise<void> {
    try {
      const markets = await this.databaseService.select<Market>('markets', {});
      const currentTime = Date.now();

      await Promise.all(
        markets.map(async (market) => {
          // Get current price
          const price = await this.getCurrentPrice(market.id);

          // Process each timeframe
          await Promise.all(
            Object.entries(this.TIMEFRAME_MS).map(async ([timeframe, ms]) => {
              // Round down timestamp to the nearest interval
              const timestamp = Math.floor(currentTime / ms) * ms;

              // Get existing candle for this period if it exists
              const [existingCandle] = await this.databaseService.select<OHLCV>(
                'ohlcv_data',
                {
                  eq: {
                    marketId: market.id,
                    timeframe,
                    timestamp,
                  },
                  limit: 1,
                },
              );

              if (existingCandle) {
                // Update existing candle
                await this.storeOHLCV(market.id, timeframe, {
                  timestamp,
                  open: existingCandle.open,
                  high: Math.max(
                    Number(existingCandle.high),
                    Number(price),
                  ).toString(),
                  low: Math.min(
                    Number(existingCandle.low),
                    Number(price),
                  ).toString(),
                  close: price,
                  volume: existingCandle.volume, // Update volume if you have volume data
                });
              } else {
                // Create new candle
                await this.storeOHLCV(market.id, timeframe, {
                  timestamp,
                  open: price,
                  high: price,
                  low: price,
                  close: price,
                  volume: '0', // Update with actual volume if available
                });
              }
            }),
          );
        }),
      );
    } catch (error) {
      console.error('Error updating OHLCV:', this.getErrorMessage(error));
    }
  }

  /**
   * ========================== Public Methods ==========================
   */

  async getCurrentPrice(marketId: string): Promise<string> {
    return this.getVirtualPrice(marketId);
  }

  async getLivePrice(marketId: string): Promise<string> {
    const market = await this.getMarketById(marketId);

    const price = this.daoPrices.get(market.symbol.toUpperCase());

    if (!price) {
      throw new Error(`Price not found for ${market.symbol}`);
    }

    return price.toString();
  }

  /**
   * Get the current virtual AMM price for a market
   */
  async getVirtualPrice(marketId: string): Promise<string> {
    const virtualPrice = this.virtualPrices.get(marketId);
    const market = await this.getMarketById(marketId);

    // Check if reserves have changed
    const cachedReserves = this.marketReserves.get(marketId);
    const reservesChanged =
      !cachedReserves ||
      cachedReserves.baseReserve !== market.virtualBaseReserve ||
      cachedReserves.quoteReserve !== market.virtualQuoteReserve;

    if (!virtualPrice || reservesChanged) {
      // Calculate new price from market reserves
      const adjustedQuoteReserve = multiply(
        market.virtualQuoteReserve,
        BASE_UNIT_DELTA,
      );
      const price = divide(adjustedQuoteReserve, market.virtualBaseReserve);

      // Update cache
      this.virtualPrices.set(marketId, price);
      this.marketReserves.set(marketId, {
        baseReserve: market.virtualBaseReserve,
        quoteReserve: market.virtualQuoteReserve,
      });

      return price;
    }

    return virtualPrice;
  }

  async getSolPrice(): Promise<number> {
    if (!this.wsConnected || !this.solPrice) {
      await this.fetchInitialPrices();
    }
    if (!this.solPrice) {
      throw new Error('Unable to fetch SOL price');
    }
    return this.solPrice;
  }

  async getUsdcPrice(): Promise<number> {
    if (!this.wsConnected || !this.usdcPrice) {
      await this.fetchInitialPrices();
    }
    if (!this.usdcPrice) {
      throw new Error('Unable to fetch USDC price');
    }
    return this.usdcPrice;
  }

  /**
   * Preview the execution price for a trade before it happens
   * This calculates the price impact without updating any state
   */
  async previewPrice(
    marketId: string,
    side: OrderSide,
    size: string,
    isClosing: boolean = false,
  ): Promise<{
    executionPrice: string;
    priceImpact: string;
  }> {
    const market = await this.getMarketById(marketId);
    const baseReserve = market.virtualBaseReserve; // base-9
    const currentPrice = await this.getVirtualPrice(marketId);

    // Convert USD size to base token units (same as in updateVirtualReserves)
    const sizeInTokens = Math.round(
      parseFloat(multiply(divide(size, currentPrice), SPL_BASE_UNIT)),
    ).toString();

    // Calculate new base reserve based on order side and whether it's closing
    let newBaseReserve: string;
    if (side === OrderSide.LONG) {
      if (isClosing) {
        // When closing a long, we're selling base tokens back to the AMM
        newBaseReserve = add(baseReserve, sizeInTokens);
      } else {
        // When opening a long, we're buying base tokens from the AMM
        newBaseReserve = subtract(baseReserve, sizeInTokens);
      }
    } else {
      // For shorts
      if (isClosing) {
        // When closing a short, we're buying base tokens from the AMM
        newBaseReserve = subtract(baseReserve, sizeInTokens);
      } else {
        // When opening a short, we're selling base tokens to the AMM
        newBaseReserve = add(baseReserve, sizeInTokens);
      }
    }

    // Calculate new price based on reserve changes
    const executionPrice = multiply(
      divide(market.virtualQuoteReserve, newBaseReserve),
      BASE_UNIT_DELTA,
    );

    // Calculate price impact as a percentage
    const priceImpact = divide(
      subtract(executionPrice, currentPrice),
      currentPrice,
    );

    return {
      executionPrice,
      priceImpact,
    };
  }

  /**
   * Calculate the virtual AMM price after a trade
   * @param market Current market state
   * @param side Order side (LONG/SHORT)
   * @param size Position size in USD
   * @returns New price after the trade
   */
  async calculateVirtualPrice(
    market: Market,
    side: OrderSide,
    size: string,
  ): Promise<string> {
    const baseReserve = market.virtualBaseReserve;
    const quoteReserve = market.virtualQuoteReserve;

    // For longs: trader buys base token with quote token
    // For shorts: trader sells base token for quote token
    if (side === OrderSide.LONG) {
      // dx = size / P = size / (y/x) = (size * x) / y
      const baseOut = divide(multiply(size, baseReserve), quoteReserve);
      const newBaseReserve = subtract(baseReserve, baseOut);
      const newQuoteReserve = divide(market.virtualK, newBaseReserve);
      return divide(newQuoteReserve.toString(), newBaseReserve);
    } else {
      // dy = size
      const quoteOut = size;
      const newQuoteReserve = subtract(quoteReserve, quoteOut);
      const newBaseReserve = divide(market.virtualK, newQuoteReserve);
      return divide(newQuoteReserve, newBaseReserve);
    }
  }

  /**
   * ========================== Candlestick Methods ==========================
   */

  /**
   * Store OHLCV data for a market
   */
  private async storeOHLCV(
    marketId: string,
    timeframe: string,
    data: {
      timestamp: number;
      open: string;
      high: string;
      low: string;
      close: string;
      volume: string;
    },
  ): Promise<void> {
    try {
      // Validate timestamp
      if (!data.timestamp || data.timestamp <= 0) {
        throw new Error('Invalid timestamp');
      }

      const ohlcvData = {
        marketId,
        timeframe,
        timestamp: data.timestamp, // Store directly as number
        open: data.open,
        high: data.high,
        low: data.low,
        close: data.close,
        volume: data.volume,
      };

      await this.databaseService.upsert<OHLCV>('ohlcv_data', ohlcvData, [
        'marketId',
        'timeframe',
        'timestamp',
      ]);
    } catch (error) {
      console.error('Error storing OHLCV:', {
        error,
        errorMessage: this.getErrorMessage(error),
        data: {
          marketId,
          timeframe,
          timestamp: data.timestamp,
        },
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Get OHLCV data for a market
   */
  async getOHLCV(
    marketId: string,
    timeframe: string,
    startTime?: number,
    endTime?: number | null,
    limit: number = 1000,
  ): Promise<OHLCV[]> {
    const cacheKey = `getOHLCV:${marketId}:${timeframe}:${startTime || 'defaultStartTime'}:${endTime || 'currentTime'}:${limit}`;
    const CACHE_TTL = 60_000; // 1 minute

    try {
      // Attempt to retrieve cached data
      const cachedData = await this.cacheManager.get<OHLCV[]>(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      const currentTime = Date.now();
      // If no start time provided, calculate default based on timeframe
      const defaultStartTime = this.calculateDefaultStartTime(timeframe, limit);
      const validStartTime =
        startTime && startTime > 0 ? startTime : defaultStartTime;
      const validEndTime = endTime && endTime > 0 ? endTime : currentTime;

      if (validEndTime <= validStartTime) {
        throw new Error('End time must be greater than start time');
      }

      const candles = await this.databaseService.select<OHLCV>('ohlcv_data', {
        eq: {
          marketId,
          timeframe,
        },
        gte: {
          timestamp: validStartTime,
        },
        lte: {
          timestamp: validEndTime,
        },
        order: {
          column: 'timestamp',
          ascending: true,
        },
        limit,
      });

      // Store the fetched data in cache
      await this.cacheManager.set(cacheKey, candles, CACHE_TTL); // 5 minutes

      return candles;
    } catch (error) {
      console.error('Error fetching OHLCV:', this.getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Calculate the default start time for OHLCV data based on timeframe
   * @param timeframe The timeframe (e.g., '1m', '5m', '1h')
   * @param limit Number of candles to fetch
   * @returns Default start time in milliseconds
   */
  private calculateDefaultStartTime(timeframe: string, limit: number): number {
    const currentTime = Date.now();
    const timeframeMs = this.TIMEFRAME_MS[timeframe];

    if (!timeframeMs) {
      throw new Error(`Invalid timeframe: ${timeframe}`);
    }

    // Calculate start time by going back (limit) intervals
    return currentTime - timeframeMs * limit;
  }

  /**
   * ========================== Private Methods ==========================
   */

  /**
   * @dev Returns the price from Jupiter Swap API.
   * We can potentially just implement this ourselves as it may be more accurate for
   * blue chip prices like AI16Z.
   */
  private async getDexPrice(
    tokenAddress: string,
    ticker: string,
  ): Promise<number> {
    const cacheKey = `solana-price-${tokenAddress}`;
    const cachedPrice = await this.cacheManager.get<number>(cacheKey);
    if (cachedPrice) {
      return cachedPrice;
    }

    const jupiterUrl = 'https://api.jup.ag/price/v2';

    try {
      // Apply rate limiting
      await this.solanaLimiter.removeTokens(1);

      const jupiterResponse = await fetch(
        `${jupiterUrl}?ids=${tokenAddress}&showExtraInfo=true`,
      ).then((res) => res.json());

      const jupiterData = jupiterResponse;

      if (!jupiterData.data || !jupiterData.data[tokenAddress]) {
        throw new Error(`Price not found for ${ticker}`);
      }

      const tokenData = jupiterData.data[tokenAddress];

      // Get the most accurate price based on available data
      let priceInUsdc: number;

      if (tokenData.extraInfo?.quotedPrice) {
        // Use the average of buy and sell prices if available
        const buyPrice = parseFloat(tokenData.extraInfo.quotedPrice.buyPrice);

        // If 0, undefined or null, we don't have a sell price
        const hasSellPrice =
          tokenData.extraInfo.quotedPrice.sellPrice !== undefined &&
          tokenData.extraInfo.quotedPrice.sellPrice !== null &&
          tokenData.extraInfo.quotedPrice.sellPrice !== 0;

        if (hasSellPrice) {
          const sellPrice = parseFloat(
            tokenData.extraInfo.quotedPrice.sellPrice || 0,
          );

          priceInUsdc = (buyPrice + sellPrice) / 2;
        } else {
          priceInUsdc = buyPrice;
        }
      } else {
        // Fall back to derived price if quoted prices aren't available
        priceInUsdc = parseFloat(tokenData.price);
      }

      // USDC/USD price from Binance WS connection --> set to 1 if N/A
      const usdcUsdPrice = this.usdcPrice > 0 ? this.usdcPrice : 1;

      // Convert USDC price to USD
      const price = priceInUsdc * usdcUsdPrice;

      // Cache the result for 5 seconds
      await this.cacheManager.set(cacheKey, price, 5_000);

      return price;
    } catch (error) {
      console.error(
        `Error fetching Solana price for ${ticker}:`,
        this.getErrorMessage(error),
      );
      throw new Error(`Failed to fetch price for ${ticker}`);
    }
  }

  async getAllCurves(): Promise<PublicKey[]> {
    const connection = new Connection(
      'https://spring-snowy-telescope.solana-mainnet.quiknode.pro/734a01c9192bece76b7b324bc0c19e91cbdd8ce1',
    );
    const programAccounts = await connection.getProgramAccounts(
      new PublicKey(VIRTUAL_XYK_IDL.address),
      {
        filters: [
          // Filter for accounts with the correct size (177 bytes as shown in mock.ts)
          {
            dataSize: 177,
          },
        ],
      },
    );

    return programAccounts.map((account) => account.pubkey);
  }

  /**
   * @param curvePda is the mint authority of the LP token.
   * To find this, get the LP token from Daos Fun site and from
   * there copy over its mint authority.
   */
  async getDaoPrice(curvePda: PublicKey): Promise<string> {
    try {
      const connection = new Connection(SOLANA_CONFIG.MAINNET.RPC_URL);
      const provider = new AnchorProvider(connection, null, {});

      // Create program instance
      const program = new Program<VirtualXyk>(
        VIRTUAL_XYK_IDL as VirtualXyk,
        provider,
      );

      // Fetch curve account
      const curve = await program.account.curve.fetch(curvePda);
      if (!curve) {
        throw new Error('Curve account not found');
      }

      // Use the CurveUtil helper to calculate token values
      const curveHelper = CurveUtil(curve);

      // Get SOL price for 1 token
      const priceInSol =
        curveHelper.token_value_sol(new BN(LAMPORTS_PER_SOL)).toNumber() /
        LAMPORTS_PER_SOL;

      // Get current SOL/USD price from an oracle
      const solUsdPrice = await this.getSolPrice();
      if (!solUsdPrice || solUsdPrice <= 0) {
        throw new Error('Invalid SOL price');
      }

      // Calculate USD price
      const usdPrice = multiply(priceInSol, solUsdPrice);

      return usdPrice;
    } catch (error) {
      console.error(
        `Error getting DAO price for curve ${curvePda.toString()}:`,
        this.getErrorMessage(error),
      );
      throw new Error(
        `Failed to get DAO price: ${this.getErrorMessage(error)}`,
      );
    }
  }

  /**
   * ========================== WS Methods ==========================
   */

  private connectBinanceWebSocket() {
    this.binanceWebSocket = new WebSocket(
      'wss://stream.binance.com:9443/stream?streams=usdcusdt@trade/solusdt@trade',
    );

    this.binanceWebSocket.on('open', () => {
      console.log('Binance WebSocket connected');
      this.wsConnected = true;
    });

    this.binanceWebSocket.on('message', (data) => {
      let priceObject = JSON.parse(data.toString());

      const symbol = priceObject.data.s.slice(0, -4);
      const price = parseFloat(priceObject.data.p);

      if (symbol === 'SOL') {
        this.solPrice = price;
      } else if (symbol === 'USDC') {
        this.usdcPrice = price;
      }
    });

    this.binanceWebSocket.on('close', (code, reason) => {
      console.error('Binance WebSocket Closed:', code, reason);
      this.wsConnected = false;
      this.reconnectBinance();
    });

    this.binanceWebSocket.on('error', (error) => {
      console.error('Binance WebSocket Error:', error);
      this.wsConnected = false;
    });

    this.binanceWebSocket.on('ping', () => {
      this.binanceWebSocket.pong();
    });

    const reconnectBefore24HoursMs = 23 * 60 * 60 * 1000;
    setTimeout(() => {
      this.reconnectBinance();
    }, reconnectBefore24HoursMs);
  }

  private reconnectBinance() {
    if (this.binanceWebSocket.readyState !== WebSocket.OPEN) {
      console.log('Attempting to reconnect to Binance...');
      this.connectBinanceWebSocket();
    }
  }

  private connectDaoWebSocket() {
    const listedDaos = getListedDaos();
    const connection = new Connection(SOLANA_CONFIG.MAINNET.RPC_URL, {
      wsEndpoint: SOLANA_CONFIG.MAINNET.WS_URL,
      commitment: 'confirmed',
    });

    // Subscribe to account changes for each DAO's curve
    Object.entries(listedDaos).forEach(([ticker, curvePda]) => {
      const pubkey = new PublicKey(curvePda);
      connection.onAccountChange(
        pubkey,
        async () => {
          try {
            const price = await this.getDaoPrice(pubkey);
            this.daoPrices.set(ticker.toUpperCase(), Number(price));
          } catch (error) {
            console.error(
              `Error updating ${ticker} price:`,
              this.getErrorMessage(error),
            );
          }
        },
        {
          commitment: 'confirmed',
        },
      );
    });

    // Initialize prices
    this.initializeDaoPrices();

    console.log('Dao Websocket Connected');
  }

  private async initializeDaoPrices() {
    const listedDaos = getListedDaos();

    await Promise.all(
      Object.entries(listedDaos).map(async ([ticker, curvePda]) => {
        try {
          const price = await this.getDaoPrice(new PublicKey(curvePda));
          this.daoPrices.set(ticker.toUpperCase(), Number(price));
        } catch (error) {
          console.error(
            `Error initializing ${ticker} price:`,
            this.getErrorMessage(error),
          );
        }
      }),
    );
  }

  /**
   * ========================== Helper Functions ==========================
   */

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
    } else if (typeof error === 'string') {
      return error;
    } else if (error && typeof error === 'object' && 'message' in error) {
      return String(error.message);
    } else {
      return 'An unknown error occurred';
    }
  }

  private async fetchInitialPrices() {
    try {
      const response = await fetch(
        'https://api.binance.com/api/v3/ticker/price?symbols=["SOLUSDT","USDCUSDT"]',
      );
      const prices = await response.json();

      for (const price of prices) {
        if (price.symbol === 'SOLUSDT') {
          this.solPrice = parseFloat(price.price);
        } else if (price.symbol === 'USDCUSDT') {
          this.usdcPrice = parseFloat(price.price);
        }
      }
    } catch (error) {
      console.error(
        'Error fetching initial prices:',
        this.getErrorMessage(error),
      );
    }
  }

  public getDaoPriceByTicker(ticker: string): number {
    const price = this.daoPrices.get(ticker.toUpperCase());
    if (!price) {
      throw new Error(`Price not found for ${ticker}`);
    }
    return price;
  }

  /**
   * @dev No caching here --> always fetch fresh virtual AMM values.
   * @dev Duplicate to prevent circular dependency.
   */
  async getMarketById(marketId: string): Promise<Market> {
    let [market] = await this.databaseService.select<Market>('markets', {
      eq: { id: marketId },
      limit: 1,
    });

    if (!market) {
      throw new NotFoundException(`Market ${marketId} not found`);
    }

    // Initialize virtual AMM values if they are null
    if (
      !market.virtualBaseReserve ||
      !market.virtualQuoteReserve ||
      !market.virtualK
    ) {
      // Initialize virtual AMM values and update market variable
      market = await this.initializeVirtualAMM(market);
    }

    return market;
  }

  /**
   * Get 24-hour statistics for a given market
   * @param marketId The ID of the market
   * @returns An object containing the 24hr change, high, and low
   */
  async get24hrStats(
    marketId: string,
  ): Promise<{ change: number; high: string; low: string }> {
    const TIMEFRAME = '1m'; // 1-minute intervals for detailed data
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    try {
      // Fetch OHLCV data for the last 24 hours
      const ohlcvData = await this.getOHLCV(
        marketId,
        TIMEFRAME,
        oneDayAgo,
        now,
        1440,
      ); // 1440 minutes in a day

      if (ohlcvData.length === 0) {
        throw new Error('No OHLCV data available for the past 24 hours');
      }

      // Calculate 24hr change
      const openingPrice = parseFloat(ohlcvData[0].open);
      const closingPrice = parseFloat(ohlcvData[ohlcvData.length - 1].close);
      const change = (closingPrice - openingPrice) / openingPrice;

      // Determine 24hr high and low
      let high = parseFloat(ohlcvData[0].high);
      let low = parseFloat(ohlcvData[0].low);

      for (const candle of ohlcvData) {
        const highPrice = parseFloat(candle.high);
        const lowPrice = parseFloat(candle.low);

        if (highPrice > high) {
          high = highPrice;
        }

        if (lowPrice < low) {
          low = lowPrice;
        }
      }

      return {
        change: parseFloat(change.toFixed(5)), // e.g., -0.05000 for -5%
        high: high.toFixed(2),
        low: low.toFixed(2),
      };
    } catch (error) {
      console.error('Error in get24hrStats:', this.getErrorMessage(error));
      throw error;
    }
  }

  private async initializeVirtualAMM(market: Market): Promise<Market> {
    // Get initial oracle price
    const initialPrice = this.daoPrices.get(market.symbol.toUpperCase());

    // Calculate $1M in the market's token
    const baseReserve = Math.round(
      Number(
        multiply(divide(INITIAL_RESERVE_BALANCE, initialPrice), SPL_BASE_UNIT),
      ),
    ).toString();

    // Calculate $1M in USDC (1,000,000 * 1e6)
    const quoteReserve = multiply(INITIAL_RESERVE_BALANCE, USDC_BASE_UNIT);

    // Calculate K
    const k = multiply(baseReserve, quoteReserve);

    // Update the market with initial virtual AMM values
    try {
      const [updatedMarket] = await this.databaseService.update<Market>(
        'markets',
        {
          virtualBaseReserve: baseReserve,
          virtualQuoteReserve: quoteReserve,
          virtualK: k,
        },
        { id: market.id },
      );

      return updatedMarket;
    } catch (error) {
      console.error('Error updating market:', this.getErrorMessage(error));
      throw error;
    }
  }
}
