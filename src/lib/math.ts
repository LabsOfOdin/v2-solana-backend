import { Decimal } from 'decimal.js';

// Configure Decimal.js globally
Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

/**
 * Adds two or more numbers with precise decimal arithmetic
 */
export function add(...numbers: (number | string)[]): string {
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
export function subtract(
  base: number | string,
  ...numbers: (number | string)[]
): string {
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
export function multiply(...numbers: (number | string)[]): string {
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
export function divide(
  dividend: number | string,
  ...divisors: (number | string)[]
): string {
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
export function percentage(
  number: number | string,
  percent: number | string,
): string {
  return new Decimal(number)
    .times(new Decimal(percent))
    .dividedBy(100)
    .toString();
}

/**
 * Rounds a number to specified decimal places
 */
export function round(
  number: number | string,
  decimalPlaces: number = 8,
): string {
  return new Decimal(number).toDecimalPlaces(decimalPlaces).toString();
}

/**
 * Compares two numbers
 * Returns:
 * -1 if a < b
 *  0 if a = b
 *  1 if a > b
 */
export function compare(a: number | string, b: number | string): number {
  return new Decimal(a).comparedTo(new Decimal(b));
}

/**
 * Returns the absolute value
 */
export function abs(number: number | string): string {
  return new Decimal(number).abs().toString();
}

/**
 * Checks if a number is zero
 */
export function isZero(number: number | string): boolean {
  return new Decimal(number).isZero();
}

/**
 * Checks if a number is positive
 */
export function isPositive(number: number | string): boolean {
  return new Decimal(number).isPositive();
}

/**
 * Checks if a number is negative
 */
export function isNegative(number: number | string): boolean {
  return new Decimal(number).isNegative();
}

/**
 * Converts a number to a precise string representation
 */
export function toString(number: number | string): string {
  return new Decimal(number).toString();
}

/**
 * Returns the minimum of two numbers
 */
export function min(a: number | string, b: number | string): string {
  const decimalA = new Decimal(a);
  const decimalB = new Decimal(b);
  return decimalA.lessThan(decimalB)
    ? decimalA.toString()
    : decimalB.toString();
}

/**
 * Returns the maximum of two numbers
 */
export function max(a: number | string, b: number | string): string {
  const decimalA = new Decimal(a);
  const decimalB = new Decimal(b);
  return decimalA.greaterThan(decimalB)
    ? decimalA.toString()
    : decimalB.toString();
}

/**
 * Checks if two numbers are equal
 */
export function eq(a: string, b: string): boolean {
  return new Decimal(a).equals(new Decimal(b));
}

/**
 * Checks if a is less than b
 */
export function lt(a: string, b: string): boolean {
  return new Decimal(a).lessThan(new Decimal(b));
}
