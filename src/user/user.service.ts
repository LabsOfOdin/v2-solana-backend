import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { MarginLock } from '../entities/margin-lock.entity';
import { MathService } from '../utils/math.service';

/**
 * Use this to update and store all data to do with users.
 * E.g open trades, limit orders, etc.
 */

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(MarginLock)
    private readonly marginLockRepository: Repository<MarginLock>,
    private readonly mathService: MathService,
  ) {}

  async getBalance(userId: string): Promise<string> {
    const user = await this.getUserById(userId);
    return user.availableBalance;
  }

  async lockMargin(userId: string, amount: string): Promise<void> {
    const user = await this.getUserById(userId);

    if (this.mathService.compare(user.availableBalance, amount) < 0) {
      throw new Error('Insufficient available balance');
    }

    await this.userRepository.update(userId, {
      availableBalance: this.mathService.subtract(
        user.availableBalance,
        amount,
      ),
      lockedMargin: this.mathService.add(user.lockedMargin, amount),
    });
  }

  async releaseMargin(userId: string, positionId: string): Promise<void> {
    const [user, marginLock] = await Promise.all([
      this.getUserById(userId),
      this.getMarginLock(positionId),
    ]);

    await this.userRepository.update(userId, {
      availableBalance: this.mathService.add(
        user.availableBalance,
        marginLock.amount,
      ),
      lockedMargin: this.mathService.subtract(
        user.lockedMargin,
        marginLock.amount,
      ),
    });

    await this.marginLockRepository.delete({ positionId });
  }

  async updateUnrealizedPnl(userId: string, pnl: string): Promise<void> {
    const user = await this.getUserById(userId);

    await this.userRepository.update(userId, {
      unrealizedPnl: pnl,
      totalBalance: this.mathService.add(
        user.availableBalance,
        user.lockedMargin,
        pnl,
      ),
    });
  }

  async createUser(publicKey: string): Promise<User> {
    const user = this.userRepository.create({
      publicKey,
      availableBalance: '0',
      totalBalance: '0',
      lockedMargin: '0',
      unrealizedPnl: '0',
    });

    return this.userRepository.save(user);
  }

  async getUserByPublicKey(publicKey: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { publicKey },
    });

    if (!user) {
      throw new NotFoundException(
        `User with public key ${publicKey} not found`,
      );
    }

    return user;
  }

  async createMarginLock(
    userId: string,
    positionId: string,
    amount: string,
  ): Promise<MarginLock> {
    const marginLock = this.marginLockRepository.create({
      userId,
      positionId,
      amount,
    });

    return this.marginLockRepository.save(marginLock);
  }

  private async getUserById(userId: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return user;
  }

  private async getMarginLock(positionId: string): Promise<MarginLock> {
    const marginLock = await this.marginLockRepository.findOne({
      where: { positionId },
    });

    if (!marginLock) {
      throw new NotFoundException(
        `Margin lock for position ${positionId} not found`,
      );
    }

    return marginLock;
  }
}
