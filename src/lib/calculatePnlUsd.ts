import { divide, multiply, subtract } from './math';
import { Position } from 'src/entities/position.entity';

export const calculatePnlUSD = (
  position: Position,
  currentPrice: string,
): string => {
  const priceDelta =
    position.side === 'LONG'
      ? subtract(currentPrice, position.entryPrice)
      : subtract(position.entryPrice, currentPrice);

  const priceDeltaPercentage = divide(priceDelta, position.entryPrice);

  // For longs: ((currentPrice - entryPrice) / entryPrice) * size
  // For shorts: ((entryPrice - currentPrice) / entryPrice) * size
  const pnl = multiply(priceDeltaPercentage, position.size);

  return pnl;
};
