import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { RateLimiter } from 'limiter';
import { Cache } from 'cache-manager';
import * as WebSocket from 'ws';
import { MarketService } from 'src/market/market.service';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { Program, BN, AnchorProvider } from '@coral-xyz/anchor';
import { VIRTUAL_XYK_IDL } from 'src/lib/idl/virtual_xyk';
import { VirtualXyk } from 'src/lib/idl/virtual_xyk.types';
import { CurveUtil } from 'src/lib/virtual-helpers';
import { multiply, divide, add, subtract, clamp } from 'src/lib/math';
import { getListedDaos, SOLANA_CONFIG } from 'src/common/config';
import { OrderSide } from 'src/types/trade.types';
import { Market } from 'src/entities/market.entity';

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
  // Store oracle prices in memory
  private oraclePrices: Map<string, string> = new Map();

  // Rate limiter --> increase once updated to Metis v6 endpoint
  private solanaLimiter = new RateLimiter({
    tokensPerInterval: 600,
    interval: 'minute', // 600 requests per minute
  });

  private geckoTerminalLimiter = new RateLimiter({
    tokensPerInterval: 30,
    interval: 'minute',
  });

  // Store up to 5 minutes of data, or choose a suitable time period
  private readonly TWAP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

  // Map each token address to an array of { timestamp, price }
  private priceHistory: Map<string, { timestamp: number; price: number }[]> =
    new Map();

  private daoPrices: Map<string, number> = new Map(); // ticker -> price

  // Base units for token math
  private readonly SPL_BASE_UNIT = '1000000000'; // base-9
  private readonly USDC_BASE_UNIT = '1000000'; // base-6
  private readonly BASE_UNIT_DELTA = '1000'; // base-3 (9-6)

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @Inject(forwardRef(() => MarketService))
    private readonly marketService: MarketService,
  ) {
    // Initialize WebSocket connections
    this.connectBinanceWebSocket();
    this.connectDaoWebSocket();
    // Fetch initial prices
    this.fetchInitialPrices();
  }

  /**
   * ========================== Public Methods ==========================
   */

  async getCurrentPrice(marketId: string): Promise<string> {
    const market = await this.marketService.getMarketById(marketId);

    const price = this.daoPrices.get(market.symbol.toUpperCase());

    if (!price) {
      throw new Error(`Price not found for ${market.symbol}`);
    }

    this.updatePriceHistory(market.tokenAddress, price);

    const twap = this.computeTwap(market.tokenAddress, price);

    return twap.toString();
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
  /**
   * @audit Review
   */
  async previewPrice(
    marketId: string,
    side: OrderSide,
    size: string,
  ): Promise<{
    executionPrice: string;
    priceImpact: string;
  }> {
    const market = await this.marketService.getMarketById(marketId);
    const baseReserve = market.virtualBaseReserve; // base-9
    const quoteReserve = market.virtualQuoteReserve; // base-6
    const currentPrice = await this.getVirtualPrice(marketId);

    let executionPrice: string;
    let newQuoteReserve: string;
    let newBaseReserve: string;

    if (side === OrderSide.LONG) {
      // Convert USD size to USDC base-6 units
      const usdcPrice = await this.getUsdcPrice();
      const sizeInBaseUnits = multiply(
        divide(size, usdcPrice),
        this.USDC_BASE_UNIT,
      );

      // Calculate how many base tokens we get for our quote tokens
      const baseOut = divide(
        multiply(sizeInBaseUnits, baseReserve),
        quoteReserve,
      );

      // Update reserves
      newBaseReserve = subtract(baseReserve, baseOut);
      newQuoteReserve = add(quoteReserve, sizeInBaseUnits);
    } else {
      // For shorts: Convert USD size to base token units
      const tokenPrice = await this.getVirtualPrice(marketId);
      const sizeInBaseUnits = multiply(
        divide(size, tokenPrice),
        this.SPL_BASE_UNIT,
      );

      // Update reserves
      newBaseReserve = add(baseReserve, sizeInBaseUnits);
      newQuoteReserve = divide(market.virtualK, newBaseReserve);
    }

    // Calculate execution price (need to adjust for base unit difference)
    executionPrice = multiply(
      divide(newQuoteReserve, newBaseReserve),
      this.BASE_UNIT_DELTA,
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
   * Get the current virtual AMM price for a market
   */
  async getVirtualPrice(marketId: string): Promise<string> {
    const virtualPrice = this.virtualPrices.get(marketId);
    if (!virtualPrice) {
      // If no virtual price exists, calculate it from market reserves
      const market = await this.marketService.getMarketById(marketId);

      // Convert reserves to same base units before division
      // quoteReserve is base-6, baseReserve is base-9
      const adjustedQuoteReserve = multiply(
        market.virtualQuoteReserve,
        this.BASE_UNIT_DELTA,
      );
      const price = divide(adjustedQuoteReserve, market.virtualBaseReserve);

      this.virtualPrices.set(marketId, price);
      return price;
    }
    return virtualPrice;
  }

  /**
   * Update virtual price after a trade is executed
   * This should only be called after the trade is confirmed
   */
  async updateVirtualPrice(
    marketId: string,
    side: OrderSide,
    size: string,
  ): Promise<void> {
    const { executionPrice } = await this.previewPrice(marketId, side, size);
    this.virtualPrices.set(marketId, executionPrice);
  }

  /**
   * Get the current oracle price for a market
   */
  async getOraclePrice(marketId: string): Promise<string> {
    const oraclePrice = this.oraclePrices.get(marketId);
    if (!oraclePrice) {
      // If no oracle price exists, fetch it from the DAO
      const market = await this.marketService.getMarketById(marketId);
      const price = await this.getDaoPrice(new PublicKey(market.poolAddress));
      this.oraclePrices.set(marketId, price);
      return price;
    }
    return oraclePrice;
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

  async fetchGeckoTerminalOHLCV(
    network: string,
    poolAddress: string,
    timeframe: string,
    aggregate: string,
    beforeTimestamp?: number,
    limit: number = 1000,
    currency: string = 'usd',
    token: string = 'base',
  ): Promise<any> {
    const cacheKey = `geckoterminal-${network}-${poolAddress}-${timeframe}-${aggregate}-${beforeTimestamp}-${limit}-${currency}-${token}`;

    // Check if the data is in the cache
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    const baseUrl = 'https://api.geckoterminal.com/api/v2';

    const params = new URLSearchParams({
      aggregate,
      limit: limit.toString(),
      currency,
      token,
    });

    if (beforeTimestamp) {
      params.append('before_timestamp', beforeTimestamp.toString());
    }

    let mappedTimeframe = 'day';

    // Map timeframe from CryptoCompare equivalents to GeckoTerminal
    if (timeframe === 'histominute') {
      mappedTimeframe = 'minute';
    } else if (timeframe === 'histohour') {
      mappedTimeframe = 'hour';
    } else if (timeframe === 'histoday') {
      mappedTimeframe = 'day';
    } else {
      mappedTimeframe = 'minute';
    }

    const url = `${baseUrl}/networks/${network}/pools/${poolAddress}/ohlcv/${mappedTimeframe}?${params}`;

    // Apply rate limiting
    await this.geckoTerminalLimiter.removeTokens(1);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json;version=20230302',
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `HTTP error! status: ${response.status}, body: ${errorBody}`,
        );
      }

      const data = await response.json();

      // Cache the result for 5 minutes
      await this.cacheManager.set(cacheKey, data, 300_000); // 300000 ms = 5 minutes
      return data;
    } catch (error) {
      console.error('Error fetching data from GeckoTerminal:', {
        error: error instanceof Error ? error.message : String(error),
        url,
        network,
        poolAddress,
        timeframe,
        aggregate,
        beforeTimestamp,
        limit,
        currency,
        token,
      });
      throw error;
    }
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

  private updatePriceHistory(tokenAddress: string, price: number): void {
    const now = Date.now();
    const history = this.priceHistory.get(tokenAddress) || [];

    // Add the new data point
    history.push({ timestamp: now, price });

    // Remove old entries beyond TWAP_WINDOW_MS
    const cutoff = now - this.TWAP_WINDOW_MS;
    while (history.length && history[0].timestamp < cutoff) {
      history.shift();
    }

    // Save updated history
    this.priceHistory.set(tokenAddress, history);
  }

  private computeTwap(tokenAddress: string, fallbackPrice: number): number {
    const history = this.priceHistory.get(tokenAddress) || [];
    // If no history, return the freshly fetched 'fallbackPrice'
    if (!history.length) {
      return fallbackPrice;
    }

    this.filterOutliers(history);

    let totalWeightedPrice = 0;
    let totalDuration = 0;

    for (let i = 0; i < history.length - 1; i++) {
      const current = history[i];
      const next = history[i + 1];
      // How long 'current.price' was valid until the next timestamp
      const durationMs = next.timestamp - current.timestamp;
      totalWeightedPrice += current.price * durationMs;
      totalDuration += durationMs;
    }

    // Weight the final data point from its timestamp to "now"
    const lastEntry = history[history.length - 1];
    const now = Date.now();
    const lastDurationMs = now - lastEntry.timestamp;
    totalWeightedPrice += lastEntry.price * lastDurationMs;
    totalDuration += lastDurationMs;

    // If totalDuration is 0 for some reason (e.g. only one sample with identical timestamps), fallback
    if (totalDuration === 0) {
      return fallbackPrice;
    }

    return totalWeightedPrice / totalDuration;
  }

  private filterOutliers(
    history: { timestamp: number; price: number }[],
  ): void {
    // Calculate simple mean
    const sum = history.reduce((acc, h) => acc + h.price, 0);
    const mean = sum / history.length;

    // Calculate sample standard deviation
    const variance =
      history.reduce((acc, h) => acc + Math.pow(h.price - mean, 2), 0) /
      history.length;
    const stdDev = Math.sqrt(variance);

    // Define an outlier threshold (e.g., 3 standard deviations)
    const lowerBound = mean - 3 * stdDev;
    const upperBound = mean + 3 * stdDev;

    // Filter in-place (remove outliers outside the bounds)
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].price < lowerBound || history[i].price > upperBound) {
        history.splice(i, 1);
      }
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    } else if (typeof error === 'string') {
      return error;
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
}
