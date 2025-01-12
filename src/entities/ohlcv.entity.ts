export enum Timeframe {
  ONE_MINUTE = '1m',
  FIVE_MINUTES = '5m',
  FIFTEEN_MINUTES = '15m',
  ONE_HOUR = '1h',
  FOUR_HOURS = '4h',
  TWELVE_HOURS = '12h',
  ONE_DAY = '1d',
}

export interface OHLCV {
  marketId: string;
  timeframe: string;
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}
