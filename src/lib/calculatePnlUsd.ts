import { divide, multiply, subtract } from './math';
import { Position } from 'src/entities/position.entity';
import { add } from './math';

export const calculatePnlUSD = (
  position: Position,
  currentPrice: string,
): string => {
  /**
   * @audit Might be confusion here with positive vs negative funding
   */
  const totalFees = add(
    position.accumulatedFunding || '0',
    position.accumulatedBorrowingFee || '0',
  );

  const priceDelta =
    position.side === 'LONG'
      ? subtract(currentPrice, position.entryPrice)
      : subtract(position.entryPrice, currentPrice);

  const priceDeltaPercentage = divide(priceDelta, position.entryPrice);

  // For longs: ((currentPrice - entryPrice) / entryPrice) * size
  // For shorts: ((entryPrice - currentPrice) / entryPrice) * size
  let pnl = multiply(priceDeltaPercentage, position.size);

  // Account for any fees
  pnl = subtract(pnl, totalFees);

  return pnl;
};
