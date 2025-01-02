import { BN, Program } from '@coral-xyz/anchor';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import { VirtualXyk } from './idl/virtual_xyk.types';

// MARK: - Query methods
type CurveProgram = Program<VirtualXyk>;
export type Curve = Awaited<
  ReturnType<CurveProgram['account']['curve']['fetch']>
>;

/**
 * 1% fee on all transactions
 */
export const parse_fee = (amount: BN): [BN, BN] => {
  const fee_amount = amount.mul(new BN(100)).div(new BN(10_000));
  return [amount.sub(fee_amount), fee_amount];
};

const FEE_NUMERATOR = new BN(995);
const FEE_DENOMINATOR = new BN(1000);

export const token_out = (
  curve: Curve,
  funding_in: BN,
  lp_init: boolean = false,
): BN => {
  const numerator = curve.tokenAmount.mul(funding_in);
  const denominator = curve.virtualFundingAmount
    .add(curve.fundingAmount)
    .add(funding_in);

  return lp_init
    ? numerator.mul(FEE_NUMERATOR).div(denominator.mul(FEE_DENOMINATOR))
    : numerator.div(denominator);
};

export const funding_out = (
  curve: Curve,
  token_in: BN,
  lp_init: boolean = false,
): BN => {
  const numerator = curve.virtualFundingAmount
    .add(curve.fundingAmount)
    .mul(token_in);
  const denominator = curve.tokenAmount.add(token_in);

  return lp_init
    ? numerator.mul(FEE_NUMERATOR).div(denominator.mul(FEE_DENOMINATOR))
    : numerator.div(denominator);
};

export const funding_required_for_lp = (curve: Curve, token_in: BN): BN => {
  const total_funding = curve.virtualFundingAmount.add(curve.fundingAmount);
  const res = token_in.mul(total_funding).div(curve.tokenAmount);

  return res.gt(new BN(0)) ? res : new BN(1);
};

/**
 * Inverse helper query for LP UI max staking.
 * Should approximate opposite of funding_required_for_lp.
 */
export const dao_required_for_lp = (curve: Curve, funding_in: BN): BN => {
  const total_dao = curve.tokenAmount;
  const total_funding = curve.virtualFundingAmount.add(curve.fundingAmount);
  const res = funding_in.mul(total_dao).div(total_funding);

  return res.gt(new BN(0)) ? res : new BN(1);
};

/**
 * Calculate token and funding to remove from curve given LP
 * amount input and total supply.
 * [token_out, funding_out]
 */
export const remove_liquidity_out = (
  curve: Curve,
  lp_amount: BN,
  total_lp_supply: BN,
): [BN, BN] => {
  const token_out = curve.tokenAmount.mul(lp_amount).div(total_lp_supply);

  const total_funding = curve.fundingAmount.add(curve.virtualFundingAmount);
  const funding_out = total_funding.mul(lp_amount).div(total_lp_supply);

  return [token_out, funding_out];
};

type CurveHelper = {
  token_amount: BN;
  funding_amount: BN;
  token_out: (funding_in: BN, lp_enabled: boolean) => BN;
  funding_out: (token_in: BN, lp_enabled: boolean) => BN;
  funding_required_for_lp: (token_in: BN) => BN;
  dao_required_for_lp: (funding_in: BN) => BN;
  lp_to_mint: (dao_amount: BN, funding_required: BN, total_supply: BN) => BN;
  parse_remove_liquidity: (lp_amount: BN, total_supply: BN) => [BN, BN];
  // value of token per sol not consider price impact
  token_value_sol: (token_amount: BN) => BN;
};

export const CurveUtil = (curve: Curve): CurveHelper => {
  return {
    token_amount: curve.tokenAmount,
    funding_amount: curve.fundingAmount,
    token_out: (funding_in: BN, lp_enabled: boolean = false) =>
      token_out(curve, funding_in, lp_enabled),
    funding_out: (token_in: BN, lp_enabled: boolean = false) =>
      funding_out(curve, token_in, lp_enabled),
    funding_required_for_lp: (token_in: BN) =>
      funding_required_for_lp(curve, token_in),
    dao_required_for_lp: (funding_in: BN) =>
      dao_required_for_lp(curve, funding_in),
    lp_to_mint: (dao_amount: BN, funding_required: BN, total_supply: BN) => {
      const lp0 = dao_amount.mul(total_supply).div(curve.tokenAmount);
      const lp1 = funding_required.mul(total_supply).div(curve.fundingAmount);

      return lp0.lt(lp1) ? lp0 : lp1;
    },
    parse_remove_liquidity: (lp_amount: BN, total_supply: BN) =>
      remove_liquidity_out(curve, lp_amount, total_supply),
    token_value_sol: (token_amount: BN) => {
      const dao_out_per_sol = token_out(curve, new BN(LAMPORTS_PER_SOL));
      return token_amount.mul(new BN(LAMPORTS_PER_SOL)).div(dao_out_per_sol);
    },
  };
};

/**
 * calculates min amount from desired slippage (subtract slippage from amount)
 * ASSUME: 2 digit precision max
 * @param amount
 * @param slippage_ratio - 0.01 for 1%
 */
export const min_amount = (amount: BN, slippage_ratio: number): BN => {
  const slippage = new BN(Math.floor(slippage_ratio * 10000)); // Convert to basis points
  const slippage_amount = amount.mul(slippage).div(new BN(10000));
  return amount.sub(slippage_amount);
};

export const max_slippage = (amount: BN, ratio: number): BN => {
  const slippage = new BN(Math.floor(ratio * 10000));
  const slippage_amount = amount.mul(slippage).div(new BN(10000));
  return amount.add(slippage_amount);
};
