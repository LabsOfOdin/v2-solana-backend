import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  WithdrawalRequest,
  WithdrawalStatus,
} from '../entities/withdrawal-request.entity';
import { MarginLock } from '../entities/margin-lock.entity';
import { User } from '../entities/user.entity';
import { TokenType } from 'src/types/token.types';
import { InvalidTokenError, InsufficientMarginError } from '../common/errors';
import { UserService } from '../users/user.service';
import { MarginBalance } from 'src/entities/margin-balance.entity';
import { SolanaService } from '../solana/solana.service';
import { add, compare, subtract } from 'src/lib/math';
import { EventsService } from 'src/events/events.service';

/**
 * @security checks:
 * - Only a user should be able to deposit / withdraw / get balance for their own account
 * - Only an admin should be able to process / reject a withdrawal
 *  --> rejections should return the margin back to the user's available balance
 *  --> successful withdrawals should send the respective token to the user's destination address
 * - Users should only be able to withdraw unlocked margin
 */

@Injectable()
export class MarginService {
  private readonly SUPPORTED_TOKENS = new Set([TokenType.SOL, TokenType.USDC]);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly userService: UserService,
    private readonly solanaService: SolanaService,
    private readonly eventsService: EventsService,
  ) {}

  /**
   * @audit We can probably make this automatically detect margin deposits.
   * But will need some security features --> reduce by transfers out etc.
   */
  async depositMargin(
    user: User,
    amount: string,
    token: TokenType,
    txHash: string,
  ): Promise<MarginBalance> {
    if (!this.SUPPORTED_TOKENS.has(token)) {
      throw new InvalidTokenError(
        `Token ${token} is not supported for margin deposits`,
      );
    }

    // Verify the transaction on Solana
    await this.solanaService.verifyDeposit(
      user.publicKey,
      txHash,
      amount,
      token,
    );

    // Get current margin balance
    const marginBalance = await this.userService.getMarginBalance(
      user.publicKey,
      token,
    );

    // Update available balance
    const newAvailableBalance = add(marginBalance.availableBalance, amount);

    // Save updated balance
    await this.userService.updateMarginBalance(
      user.publicKey,
      token,
      newAvailableBalance,
      marginBalance.lockedBalance,
      marginBalance.unrealizedPnl,
    );

    this.eventsService.emitBalancesUpdate(user.publicKey);

    return this.userService.getMarginBalance(user.publicKey, token);
  }

  async requestWithdrawal(
    user: User,
    amount: string,
    token: TokenType,
    destinationAddress: string,
  ): Promise<WithdrawalRequest> {
    if (!this.SUPPORTED_TOKENS.has(token)) {
      throw new InvalidTokenError(
        `Token ${token} is not supported for withdrawals`,
      );
    }

    const marginBalance = await this.userService.getMarginBalance(
      user.publicKey,
      token,
    );

    if (compare(marginBalance.availableBalance, amount) < 0) {
      throw new InsufficientMarginError('Insufficient balance for withdrawal');
    }

    // Reduce available balance
    const newAvailableBalance = subtract(
      marginBalance.availableBalance,
      amount,
    );

    // Update balance
    await this.userService.updateMarginBalance(
      user.publicKey,
      token,
      newAvailableBalance,
      marginBalance.lockedBalance,
      marginBalance.unrealizedPnl,
    );

    // Create withdrawal request
    const [withdrawalRequest] =
      await this.databaseService.insert<WithdrawalRequest>(
        'withdrawal_requests',
        {
          userId: user.publicKey,
          amount,
          token,
          destinationAddress,
          status: WithdrawalStatus.PENDING,
        },
      );

    return withdrawalRequest;
  }

  async lockMargin(
    userId: string,
    token: TokenType,
    amount: string,
    tradeId: string,
  ): Promise<void> {
    const marginBalance = await this.userService.getMarginBalance(
      userId,
      token,
    );

    if (compare(marginBalance.availableBalance, amount) < 0) {
      throw new InsufficientMarginError('Insufficient available margin');
    }

    // Create margin lock
    await this.databaseService.insert<MarginLock>('margin_locks', {
      userId,
      tradeId,
      token,
      amount,
    });

    // Update balances
    const newAvailableBalance = subtract(
      marginBalance.availableBalance,
      amount,
    );
    const newLockedBalance = add(marginBalance.lockedBalance, amount);

    await this.userService.updateMarginBalance(
      userId,
      token,
      newAvailableBalance,
      newLockedBalance,
      marginBalance.unrealizedPnl,
    );

    this.eventsService.emitBalancesUpdate(userId);
  }

  async releaseMargin(
    userId: string,
    token: TokenType,
    tradeId: string,
    pnl: string = '0',
  ): Promise<void> {
    const [marginLocks, marginBalance] = await Promise.all([
      this.databaseService.select<MarginLock>('margin_locks', {
        eq: { userId, tradeId, token },
        limit: 1,
      }),
      this.userService.getMarginBalance(userId, token),
    ]);

    const marginLock = marginLocks[0];

    if (!marginLock) {
      throw new Error('Margin lock not found');
    }

    // Calculate final amount to return (original margin + PnL)
    const returnAmount = add(marginLock.amount, pnl);

    // Update balances
    const newLockedBalance = subtract(
      marginBalance.lockedBalance,
      marginLock.amount,
    );
    const newAvailableBalance = add(
      marginBalance.availableBalance,
      returnAmount,
    );

    await this.userService.updateMarginBalance(
      userId,
      token,
      newAvailableBalance,
      newLockedBalance,
      marginBalance.unrealizedPnl,
    );

    // Remove margin lock
    await this.databaseService.delete('margin_locks', {
      userId,
      tradeId,
      token,
    });

    this.eventsService.emitBalancesUpdate(userId);
  }

  async getBalance(userId: string, token: TokenType): Promise<MarginBalance> {
    return this.userService.getMarginBalance(userId, token);
  }

  // Admin methods for processing withdrawals
  async processWithdrawal(
    withdrawalId: string,
    txHash: string,
  ): Promise<WithdrawalRequest> {
    const [withdrawal] = await this.databaseService.select<WithdrawalRequest>(
      'withdrawal_requests',
      {
        eq: { id: withdrawalId },
        limit: 1,
      },
    );

    if (!withdrawal || withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new Error('Invalid withdrawal request');
    }

    // Update withdrawal status
    const [updatedWithdrawal] =
      await this.databaseService.update<WithdrawalRequest>(
        'withdrawal_requests',
        {
          status: WithdrawalStatus.COMPLETED,
          txHash,
        },
        { id: withdrawalId },
      );

    this.eventsService.emitBalancesUpdate(withdrawal.userId);

    return updatedWithdrawal;
  }

  async rejectWithdrawal(
    withdrawalId: string,
    reason: string,
  ): Promise<WithdrawalRequest> {
    const [withdrawal] = await this.databaseService.select<WithdrawalRequest>(
      'withdrawal_requests',
      {
        eq: { id: withdrawalId },
        limit: 1,
      },
    );

    if (!withdrawal || withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new Error('Invalid withdrawal request');
    }

    // Return the margin back to the user's available balance
    const marginBalance = await this.userService.getMarginBalance(
      withdrawal.userId,
      withdrawal.token,
    );

    const newAvailableBalance = add(
      marginBalance.availableBalance,
      withdrawal.amount,
    );

    await this.userService.updateMarginBalance(
      withdrawal.userId,
      withdrawal.token,
      newAvailableBalance,
      marginBalance.lockedBalance,
      marginBalance.unrealizedPnl,
    );

    // Update withdrawal status
    const [updatedWithdrawal] =
      await this.databaseService.update<WithdrawalRequest>(
        'withdrawal_requests',
        {
          status: WithdrawalStatus.REJECTED,
          processingNotes: reason,
        },
        { id: withdrawalId },
      );

    this.eventsService.emitBalancesUpdate(withdrawal.userId);

    return updatedWithdrawal;
  }

  /**
   * @dev Reduces the user's availableBalance
   */
  async deductMargin(
    userId: string,
    token: TokenType,
    amount: string,
  ): Promise<void> {
    if (!this.SUPPORTED_TOKENS.has(token)) {
      throw new InvalidTokenError(
        `Token ${token} is not supported for margin deductions`,
      );
    }

    // Get current margin balance
    const marginBalance = await this.userService.getMarginBalance(
      userId,
      token,
    );

    // Check if user has enough available margin
    if (compare(marginBalance.availableBalance, amount) < 0) {
      throw new InsufficientMarginError('Insufficient available margin');
    }

    // Calculate new available balance
    const newAvailableBalance = subtract(
      marginBalance.availableBalance,
      amount,
    );

    // Update balance in database
    await this.userService.updateMarginBalance(
      userId,
      token,
      newAvailableBalance,
      marginBalance.lockedBalance,
      marginBalance.unrealizedPnl,
    );

    // Emit balance update event
    this.eventsService.emitBalancesUpdate(userId);
  }

  /**
   * @dev Reduces the user's locked margin.
   * Useful for charging borrowing fees.
   */
  async reduceLockedMargin(
    userId: string,
    token: TokenType,
    amount: string,
  ): Promise<void> {
    if (!this.SUPPORTED_TOKENS.has(token)) {
      throw new InvalidTokenError(
        `Token ${token} is not supported for margin reductions`,
      );
    }

    // Get current margin balance
    const marginBalance = await this.userService.getMarginBalance(
      userId,
      token,
    );

    // Check if user has enough locked margin
    if (compare(marginBalance.lockedBalance, amount) < 0) {
      throw new InsufficientMarginError('Insufficient locked margin');
    }

    // Calculate new locked balance
    const newLockedBalance = subtract(marginBalance.lockedBalance, amount);

    // Update balance in database
    await this.userService.updateMarginBalance(
      userId,
      token,
      marginBalance.availableBalance,
      newLockedBalance,
      marginBalance.unrealizedPnl,
    );

    // Emit balance update event
    this.eventsService.emitBalancesUpdate(userId);
  }

  async addToLockedMargin(
    userId: string,
    token: TokenType,
    amount: string,
  ): Promise<void> {
    if (!this.SUPPORTED_TOKENS.has(token)) {
      throw new InvalidTokenError(
        `Token ${token} is not supported for margin additions`,
      );
    }

    // Get current margin balance
    const marginBalance = await this.userService.getMarginBalance(
      userId,
      token,
    );

    // Calculate new locked balance
    const newLockedBalance = add(marginBalance.lockedBalance, amount);

    // Update balance in database
    await this.userService.updateMarginBalance(
      userId,
      token,
      marginBalance.availableBalance,
      newLockedBalance,
      marginBalance.unrealizedPnl,
    );

    // Emit balance update event
    this.eventsService.emitBalancesUpdate(userId);
  }
}
