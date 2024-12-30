import { Injectable, NotFoundException } from '@nestjs/common';
import { User } from '../entities/user.entity';
import { MarginBalance } from 'src/entities/margin-balance.entity';
import { MarginLock } from '../entities/margin-lock.entity';
import { TokenType } from 'src/types/token.types';
import { InsufficientMarginError } from '../common/errors';
import { compare } from 'src/lib/math';
import { add, subtract } from 'src/lib/math';
import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class UserService {
  constructor(private readonly databaseService: DatabaseService) {}

  async createUser(publicKey: string): Promise<User> {
    const date: Date = new Date();

    console.log('Creating user: ', publicKey);

    const defaultUser = {
      publicKey,
      createdAt: date,
      updatedAt: date,
    };

    const [user] = await this.databaseService.insert('users', defaultUser);

    return user;
  }

  async getUserByPublicKey(publicKey: string): Promise<User> {
    const [user] = await this.databaseService.select<User>('users', {
      eq: { publicKey },
      limit: 1,
    });

    if (!user) {
      throw new NotFoundException(
        `User with public key ${publicKey} not found`,
      );
    }

    return user;
  }

  async getMarginBalance(
    publicKey: string,
    token: TokenType,
  ): Promise<MarginBalance> {
    const [marginBalance] = await this.databaseService.select<MarginBalance>(
      'margin_balances',
      {
        eq: { userId: publicKey, token },
        limit: 1,
      },
    );

    if (!marginBalance) {
      /**
       * @dev Returned as any to ignore warning about return type.
       */
      return (await this.databaseService.insert('margin_balances', {
        userId: publicKey,
        token,
        availableBalance: '0',
        lockedBalance: '0',
        unrealizedPnl: '0',
      })) as any;
    }

    return marginBalance;
  }

  async updateMarginBalance(
    publicKey: string,
    token: TokenType,
    availableBalance: string,
    lockedBalance: string,
    unrealizedPnl: string,
  ): Promise<void> {
    let [marginBalance] = await this.databaseService.select<MarginBalance>(
      'margin_balances',
      {
        eq: { userId: publicKey, token },
        limit: 1,
      },
    );

    if (!marginBalance) {
      [marginBalance] = (await this.databaseService.insert('margin_balances', {
        userId: publicKey,
        token,
        availableBalance: '0',
        lockedBalance: '0',
        unrealizedPnl: '0',
      })) as any;
    }

    marginBalance.availableBalance = availableBalance;
    marginBalance.lockedBalance = lockedBalance;
    marginBalance.unrealizedPnl = unrealizedPnl;

    await this.databaseService.update('margin_balances', marginBalance, {
      id: marginBalance.id,
    });
  }

  async createMarginLock(
    publicKey: string,
    tradeId: string,
    token: TokenType,
    amount: string,
  ): Promise<MarginLock> {
    const [marginLock] = (await this.databaseService.insert('margin_locks', {
      userId: publicKey,
      tradeId,
      token,
      amount,
    })) as any;

    return marginLock;
  }

  async getMarginLock(tradeId: string): Promise<MarginLock> {
    const [marginLock] = await this.databaseService.select<MarginLock>(
      'margin_locks',
      {
        eq: { tradeId },
        limit: 1,
      },
    );

    if (!marginLock) {
      throw new NotFoundException(`Margin lock for trade ${tradeId} not found`);
    }

    return marginLock;
  }

  async lockMargin(
    publicKey: string,
    token: TokenType,
    amount: string,
    tradeId: string,
  ): Promise<void> {
    const marginBalance = await this.getMarginBalance(publicKey, token);

    if (compare(marginBalance.availableBalance, amount) < 0) {
      throw new InsufficientMarginError('Insufficient available balance');
    }

    // Create margin lock
    await this.createMarginLock(publicKey, tradeId, token, amount);

    // Update balances
    await this.updateMarginBalance(
      publicKey,
      token,
      subtract(marginBalance.availableBalance, amount),
      add(marginBalance.lockedBalance, amount),
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
      this.getMarginLock(tradeId),
      this.getMarginBalance(userId, token),
    ]);

    // Calculate final amount to return (original margin + PnL)
    const returnAmount = add(marginLock.amount, pnl);

    // Update balances
    await this.updateMarginBalance(
      userId,
      token,
      add(marginBalance.availableBalance, returnAmount),
      subtract(marginBalance.lockedBalance, marginLock.amount),
      marginBalance.unrealizedPnl,
    );

    // Remove margin lock
    await this.databaseService.delete('margin_locks', { tradeId });
  }
}
