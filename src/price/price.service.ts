import { Injectable } from '@nestjs/common';

/**
 * This service will be responsible for fetching prices for all assets within the protocol. We'll probably use
 * the Jupiter Swap API. Perhaps the QuickNode version if that enables us to get websocket connections.
 */

@Injectable()
export class PriceService {
  async getCurrentPrice(marketId: string): Promise<string> {
    // Implement price fetching from your chosen oracle
    // This could be from Pyth, Chainlink, or your own price feeds
    throw new Error('Not implemented');
  }

  async getPriceHistory(
    marketId: string,
    startTime: Date,
    endTime: Date,
  ): Promise<{ timestamp: Date; price: string }[]> {
    // Implement historical price fetching
    throw new Error('Not implemented');
  }

  async getMarkPrice(marketId: string): Promise<string> {
    // Implement mark price calculation
    // This might differ from spot price based on funding rates
    throw new Error('Not implemented');
  }

  async calculateFundingRate(marketId: string): Promise<string> {
    // Implement funding rate calculation based on mark price vs index price
    throw new Error('Not implemented');
  }
}
