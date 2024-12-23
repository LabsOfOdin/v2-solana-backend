import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { RateLimiter } from 'limiter';
import { Cache } from 'cache-manager';
import * as WebSocket from 'ws';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Market } from '../entities/market.entity';

/**
 * This service will be responsible for fetching prices for all assets within the protocol. We'll probably use
 * the Jupiter Swap API. Perhaps the QuickNode version if that enables us to get websocket connections.
 */

@Injectable()
export class PriceService {
  private binanceWebSocket: WebSocket;

  // USDC/USD price from Binance
  private usdcPrice: number;
  // SOL/USD price from Binance
  private solPrice: number;

  // Rate limiter --> increase once updated to Metis v6 endpoint
  private solanaLimiter = new RateLimiter({
    tokensPerInterval: 600,
    interval: 'minute', // 600 requests per minute
  });

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @InjectRepository(Market)
    private marketRepository: Repository<Market>,
  ) {
    // Initialize WebSocket connections
    this.connectBinanceWebSocket();
  }

  async getCurrentPrice(marketId: string): Promise<string> {
    const market = await this.getMarketFromMarketId(marketId);

    const price = await this.getDexPrice(market.tokenAddress, market.symbol);
    return price.toString();
  }

  async getSolPrice(): Promise<number> {
    return this.solPrice;
  }

  async getUsdcPrice(): Promise<number> {
    return this.usdcPrice;
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
      // @TODO: Use websocket connection to get price instead
      // await this.binanceLimiter.removeTokens(1);

      const jupiterResponse = await fetch(
        `${jupiterUrl}?ids=${tokenAddress}&showExtraInfo=true`,
      ).then((res) => res.json());

      const jupiterData = jupiterResponse;

      if (!jupiterData.data || !jupiterData.data[tokenAddress]) {
        throw new Error(`Price not found for ${ticker}`);
      }

      const tokenData = jupiterData.data[tokenAddress];

      // Validate the confidence level and type
      if (tokenData.extraInfo?.confidenceLevel === 'low') {
        console.warn(`Low confidence price for ${ticker}`);
      }

      // Get the most accurate price based on available data
      let priceInUsdc: number;

      if (tokenData.extraInfo?.quotedPrice) {
        // Use the average of buy and sell prices if available
        const buyPrice = parseFloat(tokenData.extraInfo.quotedPrice.buyPrice);
        const sellPrice = parseFloat(tokenData.extraInfo.quotedPrice.sellPrice);
        priceInUsdc = (buyPrice + sellPrice) / 2;
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

    this.binanceWebSocket.on('message', (data) => {
      let priceObject = JSON.parse(data.toString());

      const symbol = priceObject.data.s.slice(0, -4);
      const price = parseFloat(priceObject.data.p);

      if (symbol === 'SOLUSDT') {
        this.solPrice = price;
      } else if (symbol === 'USDCUSDT') {
        this.usdcPrice = price;
      }
    });

    this.binanceWebSocket.on('close', (code, reason) => {
      console.error('Binance WebSocket Closed:', code, reason);
      this.reconnectBinance();
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

  private async getMarketFromMarketId(marketId: string): Promise<Market> {
    const cacheKey = `market-${marketId}`;

    const cachedMarket = await this.cacheManager.get<Market>(cacheKey);
    if (cachedMarket) {
      return cachedMarket;
    }

    const market = await this.marketRepository.findOne({
      where: { id: marketId },
    });

    if (!market) {
      throw new Error(`Market with ID ${marketId} not found`);
    }

    // 0 means cache forever
    await this.cacheManager.set(cacheKey, market, 0);

    return market;
  }

  /**
   * @dev Update this to instead calculate the funding rate based on
   * the skew in the market. We can use the PRINT3R formula for this.
   * Either create a funding service or move it to market service.
   */
  async calculateFundingRate(marketId: string): Promise<string> {
    // Implement funding rate calculation based on mark price vs index price
    throw new Error('Not implemented');
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
}
