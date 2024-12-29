import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { RateLimiter } from 'limiter';
import { Cache } from 'cache-manager';
import * as WebSocket from 'ws';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Market } from '../entities/market.entity';
import { TokenType } from '../margin/types/token.types';

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

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @InjectRepository(Market)
    private marketRepository: Repository<Market>,
  ) {
    // Initialize WebSocket connections
    this.connectBinanceWebSocket();
    // Fetch initial prices
    this.fetchInitialPrices();
  }

  /**
   * ========================== Public Methods ==========================
   */

  async getCurrentPrice(marketId: string): Promise<string> {
    const market = await this.getMarketFromMarketId(marketId);

    const price = await this.getDexPrice(market.tokenAddress, market.symbol);

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

  /**
   * @audit Adjust price history length in period of volatility, or on a per-market
   * basis. If boolean flag is set (twapActivated), default to 5 mins.
   */
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

  private async getMarketFromMarketId(marketId: string): Promise<Market> {
    const cacheKey = `market-${marketId}`;

    const cachedMarket = await this.cacheManager.get<Market>(cacheKey);
    if (cachedMarket) {
      return cachedMarket;
    }

    try {
      const market = await this.marketRepository.findOne({
        where: { id: marketId },
      });

      // 0 means cache forever
      await this.cacheManager.set(cacheKey, market, 0);

      return market;
    } catch (error) {
      console.error(
        `Error fetching market with ID ${marketId}:`,
        this.getErrorMessage(error),
      );
      throw new Error(`Market with ID ${marketId} not found`);
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
}
