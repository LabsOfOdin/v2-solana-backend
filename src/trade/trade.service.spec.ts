import { Test, TestingModule } from '@nestjs/testing';
import { TradeService } from './trade.service';
import { PriceService } from '../price/price.service';
import { CacheService } from '../utils/cache.service';
import { MarginService } from '../margin/margin.service';
import { EventsService } from '../events/events.service';
import { MarketService } from '../market/market.service';
import { DatabaseService } from '../database/database.service';
import { StatsService } from '../stats/stats.service';
import { OrderRequest, OrderSide, Trade } from '../types/trade.types';
import { Position, PositionStatus } from '../entities/position.entity';
import { Market } from '../entities/market.entity';
import { TokenType } from '../types/token.types';
import { MarginBalance } from '../entities/margin-balance.entity';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

// Main test suite for TradeService
describe('TradeService', () => {
  let service: TradeService;
  let priceService: jest.Mocked<PriceService>;
  let cacheService: jest.Mocked<CacheService>;
  let marginService: jest.Mocked<MarginService>;
  let eventsService: jest.Mocked<EventsService>;
  let marketService: jest.Mocked<MarketService>;
  let databaseService: jest.Mocked<DatabaseService>;
  let statsService: jest.Mocked<StatsService>;

  const mockMarket: Market = {
    id: 'market-1',
    symbol: 'BTC-USD',
    maxLeverage: '10',
    longOpenInterest: '1000',
    shortOpenInterest: '800',
    availableLiquidity: '10000',
  } as Market;

  const mockPosition: Position = {
    id: 'position-1',
    userId: 'user-1',
    marketId: 'market-1',
    symbol: 'BTC-USD',
    side: OrderSide.LONG,
    size: '1000',
    entryPrice: '50000',
    leverage: '5',
    margin: '200',
    token: TokenType.USDC,
    lockedMarginSOL: '0',
    lockedMarginUSDC: '200',
    status: PositionStatus.OPEN,
  } as Position;

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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeService,
        {
          provide: PriceService,
          useValue: {
            getCurrentPrice: jest.fn(),
            previewPrice: jest.fn(),
            getSolPrice: jest.fn(),
          },
        },
        {
          provide: CacheService,
          useValue: {
            wrap: jest.fn(),
            delMultiple: jest.fn(),
          },
        },
        {
          provide: MarginService,
          useValue: {
            getBalance: jest.fn(),
            lockMargin: jest.fn(),
            releaseMargin: jest.fn(),
            deductMargin: jest.fn(),
          },
        },
        {
          provide: EventsService,
          useValue: {
            emitPositionsUpdate: jest.fn(),
          },
        },
        {
          provide: MarketService,
          useValue: {
            getMarketById: jest.fn(),
            updateVirtualReserves: jest.fn(),
            updateMarket: jest.fn(),
            addTradingFees: jest.fn(),
          },
        },
        {
          provide: DatabaseService,
          useValue: {
            select: jest.fn(),
            insert: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: StatsService,
          useValue: {
            addVolume: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TradeService>(TradeService);
    priceService = module.get(PriceService);
    cacheService = module.get(CacheService);
    marginService = module.get(MarginService);
    eventsService = module.get(EventsService);
    marketService = module.get(MarketService);
    databaseService = module.get(DatabaseService);
    statsService = module.get(StatsService);

    databaseService.select.mockImplementation((table, query) => {
      if (query?.and?.some((q) => q.stopLossPrice || q.takeProfitPrice)) {
        return Promise.resolve([]);
      }
      return Promise.resolve([mockPosition]);
    });

    cacheService.delMultiple.mockResolvedValue();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('openPosition', () => {
    const mockOrderRequest: OrderRequest = {
      id: 'order-1',
      marketId: 'market-1',
      userId: 'user-1',
      side: OrderSide.LONG,
      size: '1000',
      leverage: '5',
      token: TokenType.USDC,
      maxSlippage: '0.01',
    };

    beforeEach(() => {
      marketService.getMarketById.mockResolvedValue(mockMarket);
      priceService.previewPrice.mockResolvedValue({
        executionPrice: '50000',
        priceImpact: '0',
      });
      marginService.getBalance.mockResolvedValue(mockMarginBalance);
      databaseService.insert.mockResolvedValue([mockPosition]);
      priceService.getSolPrice.mockResolvedValue(100);
    });

    it('should successfully open a position', async () => {
      const result = await service.openPosition(mockOrderRequest);
      expect(result).toBe(true);
      expect(marketService.getMarketById).toHaveBeenCalledWith(
        mockOrderRequest.marketId,
      );
      expect(marginService.lockMargin).toHaveBeenCalled();
      expect(databaseService.insert).toHaveBeenCalled();
    });

    it('should throw BadRequestException for invalid leverage', async () => {
      const invalidRequest = { ...mockOrderRequest, leverage: '11' };
      await expect(service.openPosition(invalidRequest)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for insufficient liquidity', async () => {
      const largeRequest = { ...mockOrderRequest, size: '100000' };
      await expect(service.openPosition(largeRequest)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('closePosition', () => {
    beforeEach(() => {
      databaseService.select.mockResolvedValue([mockPosition]);
      marketService.getMarketById.mockResolvedValue(mockMarket);
      priceService.getCurrentPrice.mockResolvedValue('55000');
      priceService.getSolPrice.mockResolvedValue(100);
      cacheService.wrap.mockImplementation(async (key, fn) => {
        if (key.includes('position')) {
          return mockPosition;
        }
        return fn();
      });
      databaseService.update.mockResolvedValue([
        { ...mockPosition, status: PositionStatus.CLOSED },
      ]);
      marginService.releaseMargin.mockResolvedValue();
    });

    it('should successfully close a position', async () => {
      const result = await service.closePosition(
        'position-1',
        'user-1',
        '1000',
      );
      expect(result).toBeDefined();
      expect(marginService.releaseMargin).toHaveBeenCalled();
      expect(databaseService.update).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for unauthorized user', async () => {
      await expect(
        service.closePosition('position-1', 'wrong-user', '1000'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw BadRequestException for invalid size', async () => {
      await expect(
        service.closePosition('position-1', 'user-1', '2000'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('editStopLoss', () => {
    beforeEach(() => {
      cacheService.wrap.mockImplementation(async (key, fn) => {
        if (key.includes('position')) {
          return mockPosition;
        }
        return fn();
      });
      databaseService.update.mockResolvedValue([
        { ...mockPosition, stopLossPrice: '45000' },
      ]);
    });

    it('should successfully edit stop loss', async () => {
      const result = await service.editStopLoss(
        'position-1',
        'user-1',
        '45000',
      );
      expect(result).toBeDefined();
      expect(result.stopLossPrice).toBe('45000');
    });

    it('should throw UnauthorizedException for unauthorized user', async () => {
      await expect(
        service.editStopLoss('position-1', 'wrong-user', '45000'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should allow removing stop loss by passing null', async () => {
      await service.editStopLoss('position-1', 'user-1', null);
      expect(databaseService.update).toHaveBeenCalled();
    });
  });

  describe('editTakeProfit', () => {
    beforeEach(() => {
      databaseService.select.mockResolvedValue([mockPosition]);
      cacheService.wrap.mockImplementation(async (key, fn) => {
        if (key.includes('position')) {
          return mockPosition;
        }
        return fn();
      });
      databaseService.update.mockResolvedValue([
        { ...mockPosition, takeProfitPrice: '55000' },
      ]);
    });

    it('should successfully edit take profit', async () => {
      const result = await service.editTakeProfit(
        'position-1',
        'user-1',
        '55000',
      );
      expect(result).toBeDefined();
      expect(result.takeProfitPrice).toBe('55000');
    });

    it('should throw UnauthorizedException for unauthorized user', async () => {
      await expect(
        service.editTakeProfit('position-1', 'wrong-user', '55000'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should allow removing take profit by passing null', async () => {
      await service.editTakeProfit('position-1', 'user-1', null);
      expect(databaseService.update).toHaveBeenCalled();
    });
  });

  describe('editMargin', () => {
    beforeEach(() => {
      databaseService.select.mockResolvedValue([mockPosition]);
      marketService.getMarketById.mockResolvedValue(mockMarket);
      marginService.getBalance.mockResolvedValue(mockMarginBalance);
      priceService.getSolPrice.mockResolvedValue(100);

      marginService.lockMargin.mockResolvedValue();
      marginService.releaseMargin.mockResolvedValue();

      databaseService.update.mockResolvedValue([
        {
          ...mockPosition,
          margin: '300',
        },
      ]);

      cacheService.wrap.mockImplementation(async (key, fn) => {
        if (key.includes('position')) {
          return mockPosition;
        }
        return fn();
      });
    });

    it('should successfully add margin', async () => {
      const result = await service.editMargin('position-1', 'user-1', '100');
      expect(result).toBeDefined();
      expect(marginService.lockMargin).toHaveBeenCalled();
    });

    it('should successfully remove margin', async () => {
      const result = await service.editMargin('position-1', 'user-1', '-50');
      expect(result).toBeDefined();
      expect(marginService.releaseMargin).toHaveBeenCalled();
    });

    it('should throw BadRequestException for excessive margin withdrawal', async () => {
      await expect(
        service.editMargin('position-1', 'user-1', '-190'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getPosition', () => {
    it('should return cached position if available', async () => {
      cacheService.wrap.mockResolvedValue(mockPosition);
      const result = await service.getPosition('position-1');
      expect(result).toEqual(mockPosition);
      expect(cacheService.wrap).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent position', async () => {
      databaseService.select.mockResolvedValue([]);
      cacheService.wrap.mockRejectedValue(new NotFoundException());
      await expect(service.getPosition('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getUserPositions', () => {
    it('should return user positions', async () => {
      const mockPositions = [mockPosition];
      cacheService.wrap.mockResolvedValue(mockPositions);
      const result = await service.getUserPositions('user-1');
      expect(result).toEqual(mockPositions);
      expect(cacheService.wrap).toHaveBeenCalled();
    });

    it('should throw BadRequestException for missing userId', async () => {
      await expect(service.getUserPositions('')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getPositionTrades', () => {
    const mockTrade: Trade = {
      id: 'trade-1',
      positionId: 'position-1',
      userId: 'user-1',
      marketId: 'market-1',
      side: OrderSide.LONG,
      size: '1000',
      price: '50000',
      leverage: '5',
      realizedPnl: '100',
      fee: '1',
      createdAt: new Date(),
    };

    it('should return position trades', async () => {
      cacheService.wrap.mockResolvedValue([mockTrade]);
      const result = await service.getPositionTrades('position-1');
      expect(result).toEqual([mockTrade]);
      expect(cacheService.wrap).toHaveBeenCalled();
    });

    it('should throw BadRequestException for missing positionId', async () => {
      await expect(service.getPositionTrades('')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getUserTrades', () => {
    const mockTrades = [
      {
        id: 'trade-1',
        userId: 'user-1',
        positionId: 'position-1',
        marketId: 'market-1',
        side: OrderSide.LONG,
        size: '1000',
        price: '50000',
        leverage: '5',
        realizedPnl: '100',
        fee: '1',
        createdAt: new Date(),
      },
    ];

    it('should return user trades', async () => {
      cacheService.wrap.mockResolvedValue(mockTrades);
      const result = await service.getUserTrades('user-1');
      expect(result).toEqual(mockTrades);
      expect(cacheService.wrap).toHaveBeenCalled();
    });

    it('should throw BadRequestException for missing userId', async () => {
      await expect(service.getUserTrades('')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
