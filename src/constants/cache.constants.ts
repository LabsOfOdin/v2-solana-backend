// Cache TTLs (in milliseconds)
export const CACHE_TTL = {
  POSITION: 1 * 1000, // 1 seconds
  TRADE_HISTORY: 5 * 60 * 1000, // 5 minutes
  MARKET_INFO: 60 * 60 * 1000, // 1 hour
  FUNDING_HISTORY: 5 * 60 * 1000, // 5 minutes
  MARKET_STATS: 60 * 1000, // 1 minute
};

// Cache key prefixes
export const CACHE_KEY = {
  POSITION: 'position',
  USER_POSITIONS: 'user:positions',
  TRADE_HISTORY: 'trade:history',
  USER_TRADES: 'user:trades',
  MARKET: 'market',
  MARKET_STATS: 'market:stats',
  FUNDING_HISTORY: 'funding:history',
  BORROWING_HISTORY: 'borrowing:history',
};

// Cache key generators
export const getCacheKey = {
  position: (positionId: string) => `${CACHE_KEY.POSITION}:${positionId}`,
  userPositions: (userId: string) => `${CACHE_KEY.USER_POSITIONS}:${userId}`,
  positionTrades: (positionId: string) =>
    `${CACHE_KEY.TRADE_HISTORY}:${positionId}`,
  userTrades: (userId: string) => `${CACHE_KEY.USER_TRADES}:${userId}`,
  market: (marketId: string) => `${CACHE_KEY.MARKET}:${marketId}`,
  marketBySymbol: (symbol: string) => `${CACHE_KEY.MARKET}:symbol:${symbol}`,
  marketStats: (marketId: string) => `${CACHE_KEY.MARKET_STATS}:${marketId}`,
  fundingHistory: (marketId: string, startTime?: string, endTime?: string) =>
    `${CACHE_KEY.FUNDING_HISTORY}:${marketId}:${startTime}:${endTime}`,
  borrowingHistory: (
    positionId: string,
    startTime?: string,
    endTime?: string,
  ) => `${CACHE_KEY.BORROWING_HISTORY}:${positionId}:${startTime}:${endTime}`,
};
