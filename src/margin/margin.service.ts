import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  WithdrawalRequest,
  WithdrawalStatus,
} from '../entities/withdrawal-request.entity';
import { MarginLock } from '../entities/margin-lock.entity';
import { User } from '../entities/user.entity';
import { TokenType } from './types/token.types';
import { InvalidTokenError, InsufficientMarginError } from '../common/errors';
import { MathService } from '../utils/math.service';
import { UserService } from '../user/user.service';
import { MarginBalance } from './entities/margin-balance.entity';
import { SolanaService } from '../solana/solana.service';

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
    @InjectRepository(WithdrawalRequest)
    private readonly withdrawalRequestRepository: Repository<WithdrawalRequest>,
    @InjectRepository(MarginLock)
    private readonly marginLockRepository: Repository<MarginLock>,
    private readonly userService: UserService,
    private readonly mathService: MathService,
    private readonly solanaService: SolanaService,
  ) {}

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
    const newAvailableBalance = this.mathService.add(
      marginBalance.availableBalance,
      amount,
    );

    // Save updated balance
    await this.userService.updateMarginBalance(
      user.publicKey,
      token,
      newAvailableBalance,
      marginBalance.lockedBalance,
      marginBalance.unrealizedPnl,
    );

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

    if (this.mathService.compare(marginBalance.availableBalance, amount) < 0) {
      throw new InsufficientMarginError('Insufficient balance for withdrawal');
    }

    // Reduce available balance
    const newAvailableBalance = this.mathService.subtract(
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
    const withdrawalRequest = this.withdrawalRequestRepository.create({
      userId: user.publicKey,
      amount,
      token,
      destinationAddress,
      status: WithdrawalStatus.PENDING,
    });

    return this.withdrawalRequestRepository.save(withdrawalRequest);
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

    if (this.mathService.compare(marginBalance.availableBalance, amount) < 0) {
      throw new InsufficientMarginError('Insufficient available margin');
    }

    // Create margin lock
    const marginLock = this.marginLockRepository.create({
      userId,
      tradeId,
      token,
      amount,
    });
    await this.marginLockRepository.save(marginLock);

    // Update balances
    const newAvailableBalance = this.mathService.subtract(
      marginBalance.availableBalance,
      amount,
    );
    const newLockedBalance = this.mathService.add(
      marginBalance.lockedBalance,
      amount,
    );

    await this.userService.updateMarginBalance(
      userId,
      token,
      newAvailableBalance,
      newLockedBalance,
      marginBalance.unrealizedPnl,
    );
  }

  async releaseMargin(
    userId: string,
    token: TokenType,
    tradeId: string,
    pnl: string = '0',
  ): Promise<void> {
    const [marginLock, marginBalance] = await Promise.all([
      this.marginLockRepository.findOne({
        where: { userId, tradeId, token },
      }),
      this.userService.getMarginBalance(userId, token),
    ]);

    if (!marginLock) {
      throw new Error('Margin lock not found');
    }

    // Calculate final amount to return (original margin + PnL)
    const returnAmount = this.mathService.add(marginLock.amount, pnl);

    // Update balances
    const newLockedBalance = this.mathService.subtract(
      marginBalance.lockedBalance,
      marginLock.amount,
    );
    const newAvailableBalance = this.mathService.add(
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
    await this.marginLockRepository.remove(marginLock);
  }

  async updateUnrealizedPnl(
    userId: string,
    token: TokenType,
    pnl: string,
  ): Promise<void> {
    const marginBalance = await this.userService.getMarginBalance(
      userId,
      token,
    );
    await this.userService.updateMarginBalance(
      userId,
      token,
      marginBalance.availableBalance,
      marginBalance.lockedBalance,
      pnl,
    );
  }

  async getBalance(userId: string, token: TokenType): Promise<MarginBalance> {
    return this.userService.getMarginBalance(userId, token);
  }

  // Admin methods for processing withdrawals
  async processWithdrawal(
    withdrawalId: string,
    txHash: string,
  ): Promise<WithdrawalRequest> {
    const withdrawal = await this.withdrawalRequestRepository.findOne({
      where: { id: withdrawalId },
    });

    if (!withdrawal || withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new Error('Invalid withdrawal request');
    }

    // Update withdrawal status
    withdrawal.status = WithdrawalStatus.COMPLETED;
    withdrawal.txHash = txHash;
    return this.withdrawalRequestRepository.save(withdrawal);
  }

  async rejectWithdrawal(
    withdrawalId: string,
    reason: string,
  ): Promise<WithdrawalRequest> {
    const withdrawal = await this.withdrawalRequestRepository.findOne({
      where: { id: withdrawalId },
    });

    if (!withdrawal || withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new Error('Invalid withdrawal request');
    }

    // Return the margin back to the user's available balance
    const marginBalance = await this.userService.getMarginBalance(
      withdrawal.userId,
      withdrawal.token,
    );

    const newAvailableBalance = this.mathService.add(
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
    withdrawal.status = WithdrawalStatus.REJECTED;
    withdrawal.processingNotes = reason;
    return this.withdrawalRequestRepository.save(withdrawal);
  }
}
