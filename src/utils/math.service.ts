import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';

/**
 * Utility service for precise mathematical calculations.
 * Uses decimal.js to avoid floating point precision issues.
 *
 * All financial calculations in the platform should use this service
 * rather than native JavaScript arithmetic operations.
 */
@Injectable()
export class MathService {
  // Configure Decimal.js globally
  constructor() {
    // Set precision to 20 significant digits
    Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });
  }

  /**
   * Adds two or more numbers with precise decimal arithmetic
   */
  add(...numbers: (number | string)[]): string {
    return numbers
      .reduce(
        (sum, num) => new Decimal(sum).plus(new Decimal(num)),
        new Decimal(0),
      )
      .toString();
  }

  /**
   * Subtracts numbers from the first number
   */
  subtract(base: number | string, ...numbers: (number | string)[]): string {
    return numbers
      .reduce(
        (diff, num) => new Decimal(diff).minus(new Decimal(num)),
        new Decimal(base),
      )
      .toString();
  }

  /**
   * Multiplies two or more numbers
   */
  multiply(...numbers: (number | string)[]): string {
    return numbers
      .reduce(
        (product, num) => new Decimal(product).times(new Decimal(num)),
        new Decimal(1),
      )
      .toString();
  }

  /**
   * Divides the first number by subsequent numbers
   */
  divide(dividend: number | string, ...divisors: (number | string)[]): string {
    return divisors
      .reduce(
        (quotient, num) => new Decimal(quotient).dividedBy(new Decimal(num)),
        new Decimal(dividend),
      )
      .toString();
  }

  /**
   * Calculates a percentage of a number
   */
  percentage(number: number | string, percent: number | string): string {
    return new Decimal(number)
      .times(new Decimal(percent))
      .dividedBy(100)
      .toString();
  }

  /**
   * Rounds a number to specified decimal places
   */
  round(number: number | string, decimalPlaces: number = 8): string {
    return new Decimal(number).toDecimalPlaces(decimalPlaces).toString();
  }

  /**
   * Compares two numbers
   * Returns:
   * -1 if a < b
   *  0 if a = b
   *  1 if a > b
   */
  compare(a: number | string, b: number | string): number {
    return new Decimal(a).comparedTo(new Decimal(b));
  }

  /**
   * Returns the absolute value
   */
  abs(number: number | string): string {
    return new Decimal(number).abs().toString();
  }

  /**
   * Checks if a number is zero
   */
  isZero(number: number | string): boolean {
    return new Decimal(number).isZero();
  }

  /**
   * Checks if a number is positive
   */
  isPositive(number: number | string): boolean {
    return new Decimal(number).isPositive();
  }

  /**
   * Checks if a number is negative
   */
  isNegative(number: number | string): boolean {
    return new Decimal(number).isNegative();
  }

  /**
   * Converts a number to a precise string representation
   */
  toString(number: number | string): string {
    return new Decimal(number).toString();
  }

  /**
   * Returns the minimum of two numbers
   */
  min(a: number | string, b: number | string): string {
    const decimalA = new Decimal(a);
    const decimalB = new Decimal(b);
    return decimalA.lessThan(decimalB)
      ? decimalA.toString()
      : decimalB.toString();
  }

  /**
   * Returns the maximum of two numbers
   */
  max(a: number | string, b: number | string): string {
    const decimalA = new Decimal(a);
    const decimalB = new Decimal(b);
    return decimalA.greaterThan(decimalB)
      ? decimalA.toString()
      : decimalB.toString();
  }
}
