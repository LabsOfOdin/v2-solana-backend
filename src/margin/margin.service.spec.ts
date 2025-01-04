import { Test, TestingModule } from '@nestjs/testing';
import { MarginService } from './margin.service';
import { DatabaseService } from '../database/database.service';
import { UserService } from '../users/user.service';
import { SolanaService } from '../solana/solana.service';
import { EventsService } from '../events/events.service';
import { TokenType } from '../types/token.types';
import { MarginBalance } from '../entities/margin-balance.entity';
import {
  WithdrawalRequest,
  WithdrawalStatus,
} from '../entities/withdrawal-request.entity';
import { MarginLock } from '../entities/margin-lock.entity';
import { User } from '../entities/user.entity';
import { InvalidTokenError, InsufficientMarginError } from '../common/errors';

describe('MarginService', () => {
  let service: MarginService;
  let databaseService: jest.Mocked<DatabaseService>;
  let userService: jest.Mocked<UserService>;
  let solanaService: jest.Mocked<SolanaService>;
  let eventsService: jest.Mocked<EventsService>;

  const mockUser: User = {
    publicKey: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockMarginBalance: MarginBalance = {
    id: 'balance-1',
    userId: 'user-1',
    token: TokenType.USDC,
    availableBalance: '1000',
    lockedBalance: '0',
    unrealizedPnl: '0',
    user: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockWithdrawalRequest: WithdrawalRequest = {
    id: 'withdrawal-1',
    userId: 'user-1',
    amount: '100',
    token: TokenType.USDC,
    destinationAddress: 'destination-address',
    status: WithdrawalStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarginService,
        {
          provide: DatabaseService,
          useValue: {
            select: jest.fn(),
            insert: jest.fn(),
            update: jest.fn().mockResolvedValue([mockWithdrawalRequest]),
            delete: jest.fn(),
          },
        },
        {
          provide: UserService,
          useValue: {
            getMarginBalance: jest.fn(),
            updateMarginBalance: jest.fn(),
          },
        },
        {
          provide: SolanaService,
          useValue: {
            verifyDeposit: jest.fn(),
          },
        },
        {
          provide: EventsService,
          useValue: {
            emitBalancesUpdate: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MarginService>(MarginService);
    databaseService = module.get(DatabaseService);
    userService = module.get(UserService);
    solanaService = module.get(SolanaService);
    eventsService = module.get(EventsService);

    // Default mock implementations
    userService.getMarginBalance.mockResolvedValue(mockMarginBalance);
    databaseService.insert.mockResolvedValue([mockWithdrawalRequest]);
    solanaService.verifyDeposit.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('depositMargin', () => {
    it('should successfully deposit margin', async () => {
      const amount = '100';
      const token = TokenType.USDC;
      const txHash = 'tx-hash';

      const result = await service.depositMargin(
        mockUser,
        amount,
        token,
        txHash,
      );

      expect(solanaService.verifyDeposit).toHaveBeenCalledWith(
        mockUser.publicKey,
        txHash,
        amount,
        token,
      );
      expect(userService.updateMarginBalance).toHaveBeenCalled();
      expect(eventsService.emitBalancesUpdate).toHaveBeenCalledWith(
        mockUser.publicKey,
      );
      expect(result).toEqual(mockMarginBalance);
    });

    it('should throw error for unsupported token', async () => {
      await expect(
        service.depositMargin(
          mockUser,
          '100',
          'INVALID' as TokenType,
          'tx-hash',
        ),
      ).rejects.toThrow(InvalidTokenError);
    });
  });

  describe('requestWithdrawal', () => {
    it('should successfully create withdrawal request', async () => {
      const result = await service.requestWithdrawal(
        mockUser,
        '100',
        TokenType.USDC,
        'destination-address',
      );

      expect(userService.updateMarginBalance).toHaveBeenCalled();
      expect(databaseService.insert).toHaveBeenCalled();
      expect(result).toEqual(mockWithdrawalRequest);
    });

    it('should throw error for insufficient balance', async () => {
      userService.getMarginBalance.mockResolvedValueOnce({
        ...mockMarginBalance,
        availableBalance: '50',
      });

      await expect(
        service.requestWithdrawal(
          mockUser,
          '100',
          TokenType.USDC,
          'destination-address',
        ),
      ).rejects.toThrow(InsufficientMarginError);
    });
  });

  describe('lockMargin', () => {
    const mockMarginLock: MarginLock = {
      id: 'lock-1',
      userId: 'user-1',
      tradeId: 'trade-1',
      token: TokenType.USDC,
      amount: '100',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should successfully lock margin', async () => {
      databaseService.insert.mockResolvedValueOnce([mockMarginLock]);

      await service.lockMargin('user-1', TokenType.USDC, '100', 'trade-1');

      expect(databaseService.insert).toHaveBeenCalledWith('margin_locks', {
        userId: 'user-1',
        tradeId: 'trade-1',
        token: TokenType.USDC,
        amount: '100',
      });
      expect(userService.updateMarginBalance).toHaveBeenCalled();
      expect(eventsService.emitBalancesUpdate).toHaveBeenCalledWith('user-1');
    });

    it('should throw error for insufficient available margin', async () => {
      userService.getMarginBalance.mockResolvedValueOnce({
        ...mockMarginBalance,
        availableBalance: '50',
      });

      await expect(
        service.lockMargin('user-1', TokenType.USDC, '100', 'trade-1'),
      ).rejects.toThrow(InsufficientMarginError);
    });
  });

  describe('releaseMargin', () => {
    const mockMarginLock: MarginLock = {
      id: 'lock-1',
      userId: 'user-1',
      tradeId: 'trade-1',
      token: TokenType.USDC,
      amount: '100',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(() => {
      databaseService.select.mockResolvedValue([mockMarginLock]);
    });

    it('should successfully release margin', async () => {
      await service.releaseMargin('user-1', TokenType.USDC, 'trade-1', '10');

      expect(userService.updateMarginBalance).toHaveBeenCalled();
      expect(databaseService.delete).toHaveBeenCalledWith('margin_locks', {
        userId: 'user-1',
        tradeId: 'trade-1',
        token: TokenType.USDC,
      });
      expect(eventsService.emitBalancesUpdate).toHaveBeenCalledWith('user-1');
    });

    it('should throw error when margin lock not found', async () => {
      databaseService.select.mockResolvedValueOnce([]);

      await expect(
        service.releaseMargin('user-1', TokenType.USDC, 'trade-1'),
      ).rejects.toThrow('Margin lock not found');
    });
  });

  describe('processWithdrawal', () => {
    beforeEach(() => {
      databaseService.select.mockResolvedValue([mockWithdrawalRequest]);
      databaseService.update.mockResolvedValue([
        {
          ...mockWithdrawalRequest,
          status: WithdrawalStatus.COMPLETED,
          txHash: 'tx-hash',
        },
      ]);
    });

    it('should successfully process withdrawal', async () => {
      const txHash = 'tx-hash';
      await service.processWithdrawal('withdrawal-1', txHash);

      expect(databaseService.update).toHaveBeenCalledWith(
        'withdrawal_requests',
        {
          status: WithdrawalStatus.COMPLETED,
          txHash,
        },
        { id: 'withdrawal-1' },
      );
      expect(eventsService.emitBalancesUpdate).toHaveBeenCalledWith('user-1');
    });

    it('should throw error for invalid withdrawal', async () => {
      databaseService.select.mockResolvedValueOnce([]);

      await expect(
        service.processWithdrawal('invalid-id', 'tx-hash'),
      ).rejects.toThrow('Invalid withdrawal request');
    });
  });

  describe('rejectWithdrawal', () => {
    beforeEach(() => {
      databaseService.select.mockResolvedValue([mockWithdrawalRequest]);
      databaseService.update.mockResolvedValue([
        {
          ...mockWithdrawalRequest,
          status: WithdrawalStatus.REJECTED,
          processingNotes: 'Invalid destination address',
        },
      ]);
    });

    it('should successfully reject withdrawal', async () => {
      const reason = 'Invalid destination address';
      await service.rejectWithdrawal('withdrawal-1', reason);

      expect(userService.updateMarginBalance).toHaveBeenCalled();
      expect(databaseService.update).toHaveBeenCalledWith(
        'withdrawal_requests',
        {
          status: WithdrawalStatus.REJECTED,
          processingNotes: reason,
        },
        { id: 'withdrawal-1' },
      );
      expect(eventsService.emitBalancesUpdate).toHaveBeenCalledWith('user-1');
    });

    it('should throw error for invalid withdrawal', async () => {
      databaseService.select.mockResolvedValueOnce([]);

      await expect(
        service.rejectWithdrawal('invalid-id', 'reason'),
      ).rejects.toThrow('Invalid withdrawal request');
    });
  });

  describe('deductMargin', () => {
    it('should successfully deduct margin', async () => {
      await service.deductMargin('user-1', TokenType.USDC, '100');

      expect(userService.updateMarginBalance).toHaveBeenCalled();
      expect(eventsService.emitBalancesUpdate).toHaveBeenCalledWith('user-1');
    });

    it('should throw error for insufficient available margin', async () => {
      userService.getMarginBalance.mockResolvedValueOnce({
        ...mockMarginBalance,
        availableBalance: '50',
      });

      await expect(
        service.deductMargin('user-1', TokenType.USDC, '100'),
      ).rejects.toThrow(InsufficientMarginError);
    });
  });

  describe('reduceLockedMargin', () => {
    beforeEach(() => {
      userService.getMarginBalance.mockResolvedValue({
        ...mockMarginBalance,
        lockedBalance: '200',
      });
    });

    it('should successfully reduce locked margin', async () => {
      await service.reduceLockedMargin('user-1', TokenType.USDC, '100');

      expect(userService.updateMarginBalance).toHaveBeenCalled();
      expect(eventsService.emitBalancesUpdate).toHaveBeenCalledWith('user-1');
    });

    it('should throw error for insufficient locked margin', async () => {
      userService.getMarginBalance.mockResolvedValueOnce({
        ...mockMarginBalance,
        lockedBalance: '50',
      });

      await expect(
        service.reduceLockedMargin('user-1', TokenType.USDC, '100'),
      ).rejects.toThrow(InsufficientMarginError);
    });
  });

  describe('addToLockedMargin', () => {
    it('should successfully add to locked margin', async () => {
      await service.addToLockedMargin('user-1', TokenType.USDC, '100');

      expect(userService.updateMarginBalance).toHaveBeenCalled();
      expect(eventsService.emitBalancesUpdate).toHaveBeenCalledWith('user-1');
    });

    it('should throw error for unsupported token', async () => {
      await expect(
        service.addToLockedMargin('user-1', 'INVALID' as TokenType, '100'),
      ).rejects.toThrow(InvalidTokenError);
    });
  });
});
