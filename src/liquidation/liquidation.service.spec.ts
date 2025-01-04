import { Test, TestingModule } from '@nestjs/testing';
import { LiquidationService } from './liquidation.service';
import { DatabaseService } from '../database/database.service';
import { PriceService } from '../price/price.service';
import { MarginService } from '../margin/margin.service';
import { MarketService } from '../market/market.service';
import { EventsService } from '../events/events.service';
import { Position, PositionStatus } from '../entities/position.entity';
import { OrderSide } from '../types/trade.types';
import { TokenType } from '../types/token.types';
import { Market } from '../entities/market.entity';
import { MarketStatus } from '../types/market.types';
import { SECONDS_IN_DAY } from '../common/config';

describe('LiquidationService', () => {
  let service: LiquidationService;
  let databaseService: jest.Mocked<DatabaseService>;
  let priceService: jest.Mocked<PriceService>;
  let marginService: jest.Mocked<MarginService>;
  let marketService: jest.Mocked<MarketService>;
  let eventsService: jest.Mocked<EventsService>;

  const mockPosition: Position = {
    id: '1',
    userId: 'user1',
    marketId: 'market1',
    symbol: 'BTC-USD',
    side: OrderSide.LONG,
    size: '1000',
    leverage: '10',
    margin: '1000',
    entryPrice: '20000',
    token: TokenType.USDC,
    status: PositionStatus.OPEN,
    lockedMarginSOL: '0',
    lockedMarginUSDC: '1000',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    accumulatedFunding: '0',
    accumulatedBorrowingFee: '0',
    lastFundingUpdate: new Date('2024-01-01T00:00:00Z'),
    lastBorrowingFeeUpdate: null,
  };

  const mockMarket: Market = {
    id: 'market1',
    symbol: 'BTC-USD',
    tokenAddress: 'token-address',
    poolAddress: 'pool-address',
    maxLeverage: '10',
    maintainanceMargin: '0.05',
    borrowingRate: '0.001',
    fundingRate: '0',
    fundingRateVelocity: '0',
    lastUpdatedTimestamp: Date.now(),
    longOpenInterest: '0',
    shortOpenInterest: '0',
    virtualBaseReserve: '1000000',
    virtualQuoteReserve: '1000000',
    virtualK: '1000000000',
    cumulativeFeesSol: '0',
    cumulativeFeesUsdc: '0',
    unclaimedFeesSol: '0',
    unclaimedFeesUsdc: '0',
    maxFundingRate: '0.0003',
    maxFundingVelocity: '0.01',
    status: MarketStatus.ACTIVE,
    positions: [],
    openLimitOrders: [],
    availableLiquidity: '1000000',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiquidationService,
        {
          provide: DatabaseService,
          useValue: {
            select: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: PriceService,
          useValue: {
            getCurrentPrice: jest.fn(),
            getSolPrice: jest.fn(),
            getUsdcPrice: jest.fn(),
          },
        },
        {
          provide: MarginService,
          useValue: {
            reduceLockedMargin: jest.fn(),
            addToLockedMargin: jest.fn(),
          },
        },
        {
          provide: MarketService,
          useValue: {
            getMarketById: jest.fn(),
            getFundingRate: jest.fn(),
            addTradingFees: jest.fn(),
          },
        },
        {
          provide: EventsService,
          useValue: {
            emitPositionsUpdate: jest.fn(),
            emitFundingFeeCharged: jest.fn(),
            emitBorrowingFeeCharged: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<LiquidationService>(LiquidationService);
    databaseService = module.get(DatabaseService);
    priceService = module.get(PriceService);
    marginService = module.get(MarginService);
    marketService = module.get(MarketService);
    eventsService = module.get(EventsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getLiquidationPrice', () => {
    it('should calculate liquidation price for long position', async () => {
      const position = {
        ...mockPosition,
        entryPrice: '20000',
        size: '10000',
        leverage: '10',
        margin: '1000',
        lockedMarginUSDC: '1000',
        lockedMarginSOL: '0',
        side: OrderSide.LONG,
        accumulatedFunding: '0',
        accumulatedBorrowingFee: '0',
      };

      databaseService.select.mockResolvedValueOnce([position]);
      priceService.getSolPrice.mockResolvedValueOnce(20);

      const liquidationPrice = await service.getLiquidationPrice('1');
      expect(liquidationPrice).toBeDefined();
      expect(typeof liquidationPrice).toBe('string');
      expect(parseFloat(liquidationPrice)).toBeLessThan(
        parseFloat(position.entryPrice),
      );
      expect(databaseService.select).toHaveBeenCalledWith('positions', {
        eq: { id: '1' },
        limit: 1,
      });
    });

    it('should calculate liquidation price for short position', async () => {
      const position = {
        ...mockPosition,
        entryPrice: '20000',
        size: '10000',
        leverage: '10',
        margin: '1000',
        lockedMarginUSDC: '1000',
        lockedMarginSOL: '0',
        side: OrderSide.SHORT,
        accumulatedFunding: '0',
        accumulatedBorrowingFee: '0',
      };

      databaseService.select.mockResolvedValueOnce([position]);
      priceService.getSolPrice.mockResolvedValueOnce(20);

      const liquidationPrice = await service.getLiquidationPrice('1');
      expect(liquidationPrice).toBeDefined();
      expect(typeof liquidationPrice).toBe('string');
      expect(parseFloat(liquidationPrice)).toBeGreaterThan(
        parseFloat(position.entryPrice),
      );
      expect(databaseService.select).toHaveBeenCalledWith('positions', {
        eq: { id: '1' },
        limit: 1,
      });
    });

    it('should throw error if position not found', async () => {
      databaseService.select.mockResolvedValueOnce([]);

      await expect(service.getLiquidationPrice('1')).rejects.toThrow(
        'Position not found',
      );
    });
  });

  describe('updatePositionFees', () => {
    beforeEach(() => {
      // Reset all mocks
      jest.clearAllMocks();

      // Setup common mocks
      databaseService.select.mockImplementation(async (table, query) => {
        if (table === 'positions') {
          return [mockPosition];
        }
        if (table === 'markets') {
          return [mockMarket];
        }
        return [];
      });

      marketService.getMarketById.mockResolvedValue(mockMarket);
      marketService.getFundingRate.mockResolvedValue('0.001');
      priceService.getUsdcPrice.mockResolvedValue(1);
      priceService.getSolPrice.mockResolvedValue(20);
      databaseService.update.mockResolvedValue(undefined);
      marginService.reduceLockedMargin.mockResolvedValue(undefined);
      marginService.addToLockedMargin.mockResolvedValue(undefined);
      marketService.addTradingFees.mockResolvedValue(undefined);
    });

    it('should update funding fees correctly', async () => {
      const oldDate = new Date();
      oldDate.setSeconds(oldDate.getSeconds() - 3600); // 1 hour ago
      const position = {
        ...mockPosition,
        lastFundingUpdate: oldDate,
        accumulatedFunding: '0',
        size: '1000',
        token: TokenType.USDC,
      };

      databaseService.select.mockImplementationOnce(async () => [position]);

      const now = new Date();
      // Trigger fee update through private method
      await (service as any).updateFundingFee(position, now);

      // Verify the update was called with the correct parameters
      expect(databaseService.update).toHaveBeenCalledWith(
        'positions',
        {
          accumulatedFunding: expect.any(String),
          lastFundingUpdate: now,
        },
        { id: position.id },
      );

      expect(marketService.getFundingRate).toHaveBeenCalled();
      expect(eventsService.emitFundingFeeCharged).toHaveBeenCalledWith({
        userId: position.userId,
        positionId: position.id,
        marketId: position.marketId,
        feeUsd: expect.any(String),
        feeToken: expect.any(String),
        token: position.token,
      });
    });

    it('should update borrowing fees correctly', async () => {
      const position = {
        ...mockPosition,
        lastBorrowingFeeUpdate: null,
        accumulatedBorrowingFee: '0',
        size: '1000',
        token: TokenType.USDC,
      };
      const now = new Date('2024-01-02T00:00:00Z'); // 1 day after position creation

      // Mock database calls
      databaseService.select.mockImplementation(async (table, query) => {
        if (table === 'markets') {
          return [
            {
              ...mockMarket,
              borrowingRate: '0.001', // 0.1% daily rate
            },
          ];
        }
        return [position];
      });

      // Trigger fee update through private method
      await (service as any).updateBorrowingFee(position, now);

      // Verify the update was called with the correct parameters
      expect(databaseService.update).toHaveBeenCalledWith(
        'positions',
        {
          accumulatedBorrowingFee: '1',
          lastBorrowingFeeUpdate: now,
        },
        { id: position.id },
      );

      expect(marginService.reduceLockedMargin).toHaveBeenCalledWith(
        position.userId,
        position.token,
        '1', // 1 USDC fee
      );

      expect(marketService.addTradingFees).toHaveBeenCalledWith(
        position.marketId,
        '1', // 1 USDC fee
        position.token,
      );

      expect(eventsService.emitBorrowingFeeCharged).toHaveBeenCalledWith({
        userId: position.userId,
        positionId: position.id,
        marketId: position.marketId,
        feeUsd: '1',
        feeToken: '1',
        token: position.token,
      });
    });
  });

  describe('liquidation checks', () => {
    beforeEach(() => {
      // Reset all mocks
      jest.clearAllMocks();

      // Setup common mocks
      databaseService.select.mockImplementation(async (table, query) => {
        if (table === 'positions') {
          return [mockPosition];
        }
        if (table === 'markets') {
          return [mockMarket];
        }
        return [];
      });

      marketService.getMarketById.mockResolvedValue(mockMarket);
      priceService.getCurrentPrice.mockResolvedValue('19000');
      priceService.getSolPrice.mockResolvedValue(20);
      priceService.getUsdcPrice.mockResolvedValue(1);
      databaseService.update.mockResolvedValue(undefined);
      marginService.reduceLockedMargin.mockResolvedValue(undefined);
      marginService.addToLockedMargin.mockResolvedValue(undefined);
      marketService.addTradingFees.mockResolvedValue(undefined);
    });

    it('should liquidate position when conditions are met', async () => {
      const position = {
        ...mockPosition,
        entryPrice: '20000',
        size: '10000',
        leverage: '10',
        margin: '1000',
        lockedMarginUSDC: '1000',
        lockedMarginSOL: '0',
        side: OrderSide.LONG,
        accumulatedFunding: '0',
        accumulatedBorrowingFee: '0',
      };

      // Set current price to trigger liquidation
      // For a 10x long position with 5% maintenance margin,
      // price needs to drop by ~9.5% to trigger liquidation
      const currentPrice = '18000'; // ~9.5% drop from 20000

      databaseService.select.mockImplementation(async (table, query) => {
        if (table === 'positions' && query.eq?.status === PositionStatus.OPEN) {
          return [position];
        }
        return [];
      });

      priceService.getCurrentPrice.mockResolvedValue(currentPrice);
      priceService.getSolPrice.mockResolvedValue(20);

      // Trigger liquidation check through private method
      await (service as any).checkPositionsForLiquidation();

      expect(databaseService.update).toHaveBeenCalledWith(
        'positions',
        expect.objectContaining({
          status: PositionStatus.LIQUIDATED,
          closingPrice: currentPrice,
          closedAt: expect.any(Date),
          realizedPnl: '0',
        }),
        { id: position.id },
      );
      expect(eventsService.emitPositionsUpdate).toHaveBeenCalledWith(
        position.userId,
      );
    });

    it('should not liquidate position when conditions are not met', async () => {
      const position = {
        ...mockPosition,
        entryPrice: '20000',
        size: '10000',
        leverage: '10',
        margin: '1000',
        lockedMarginUSDC: '1000',
        lockedMarginSOL: '0',
        side: OrderSide.LONG,
      };

      const currentPrice = '19900';

      databaseService.select.mockImplementationOnce(async () => [position]);
      priceService.getCurrentPrice.mockResolvedValueOnce(currentPrice);

      await (service as any).checkPositionsForLiquidation();

      expect(databaseService.update).not.toHaveBeenCalled();
      expect(eventsService.emitPositionsUpdate).not.toHaveBeenCalled();
    });
  });
});
