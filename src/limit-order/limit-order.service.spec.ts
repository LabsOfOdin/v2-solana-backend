import { Test, TestingModule } from '@nestjs/testing';
import { LimitOrderService } from './limit-order.service';
import { PriceService } from '../price/price.service';
import { TradeService } from '../trade/trade.service';
import { MarginService } from '../margin/margin.service';
import { EventsService } from '../events/events.service';
import { DatabaseService } from '../database/database.service';
import { LimitOrder } from '../entities/limit-order.entity';
import { Market } from '../entities/market.entity';
import {
  LimitOrderRequest,
  OrderSide,
  OrderStatus,
  OrderType,
} from '../types/trade.types';
import { TokenType } from '../types/token.types';
import { MarginBalance } from '../entities/margin-balance.entity';

describe('LimitOrderService', () => {
  let service: LimitOrderService;
  let priceService: jest.Mocked<PriceService>;
  let tradeService: jest.Mocked<TradeService>;
  let marginService: jest.Mocked<MarginService>;
  let eventsService: jest.Mocked<EventsService>;
  let databaseService: jest.Mocked<DatabaseService>;

  const mockMarket: Market = {
    id: 'market-1',
    symbol: 'BTC-USD',
    maxLeverage: '10',
    longOpenInterest: '1000',
    shortOpenInterest: '800',
    availableLiquidity: '10000',
  } as Market;

  const mockLimitOrder: LimitOrder = {
    id: 'order-1',
    userId: 'user-1',
    marketId: 'market-1',
    symbol: 'BTC-USD',
    side: OrderSide.LONG,
    size: '1000',
    price: '50000',
    leverage: '5',
    token: TokenType.USDC,
    requiredMargin: '200',
    status: OrderStatus.OPEN,
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LimitOrderService,
        {
          provide: PriceService,
          useValue: {
            getCurrentPrice: jest.fn(),
            getSolPrice: jest.fn(),
          },
        },
        {
          provide: TradeService,
          useValue: {
            openPosition: jest.fn(),
          },
        },
        {
          provide: MarginService,
          useValue: {
            getBalance: jest.fn(),
          },
        },
        {
          provide: EventsService,
          useValue: {
            emitPositionsUpdate: jest.fn(),
          },
        },
        {
          provide: DatabaseService,
          useValue: {
            select: jest.fn().mockImplementation((table, query) => {
              if (table === 'markets') {
                return Promise.resolve([mockMarket]);
              }
              if (table === 'limit_orders') {
                return Promise.resolve([mockLimitOrder]);
              }
              return Promise.resolve([]);
            }),
            insert: jest.fn(),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<LimitOrderService>(LimitOrderService);
    priceService = module.get(PriceService);
    tradeService = module.get(TradeService);
    marginService = module.get(MarginService);
    eventsService = module.get(EventsService);
    databaseService = module.get(DatabaseService);

    // Default mock implementations
    databaseService.insert.mockResolvedValue([mockLimitOrder]);
    marginService.getBalance.mockResolvedValue(mockMarginBalance);
    priceService.getSolPrice.mockResolvedValue(100);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createLimitOrder', () => {
    const mockOrderRequest: LimitOrderRequest = {
      id: 'order-1',
      userId: 'user-1',
      marketId: 'market-1',
      side: OrderSide.LONG,
      size: '1000',
      price: '50000',
      leverage: '5',
      token: TokenType.USDC,
      type: OrderType.LIMIT,
    };

    beforeEach(() => {
      // Reset the mock implementation for each test
      databaseService.select.mockImplementation((table) => {
        if (table === 'markets') {
          return Promise.resolve([mockMarket]);
        }
        if (table === 'limit_orders') {
          return Promise.resolve([mockLimitOrder]);
        }
        return Promise.resolve([]);
      });
    });

    it('should successfully create a limit order', async () => {
      const result = await service.createLimitOrder(mockOrderRequest);
      expect(result).toEqual(mockLimitOrder);
      expect(databaseService.insert).toHaveBeenCalled();
      expect(eventsService.emitPositionsUpdate).toHaveBeenCalledWith('user-1');
    });

    it('should throw error when market not found', async () => {
      // Override the mock for this specific test
      databaseService.select.mockImplementationOnce(() => Promise.resolve([]));
      await expect(service.createLimitOrder(mockOrderRequest)).rejects.toThrow(
        'Market not found',
      );
    });

    it('should throw error for invalid parameters', async () => {
      const invalidRequest = { ...mockOrderRequest, leverage: '0' };
      await expect(service.createLimitOrder(invalidRequest)).rejects.toThrow(
        'Invalid Parameters',
      );
    });

    it('should throw error for insufficient balance', async () => {
      marginService.getBalance.mockResolvedValueOnce({
        ...mockMarginBalance,
        availableBalance: '10',
      });
      await expect(service.createLimitOrder(mockOrderRequest)).rejects.toThrow(
        'Insufficient balance for limit order',
      );
    });
  });

  describe('cancelLimitOrder', () => {
    it('should successfully cancel a limit order', async () => {
      await service.cancelLimitOrder('order-1', 'user-1');
      expect(databaseService.update).toHaveBeenCalledWith(
        'limit_orders',
        { status: OrderStatus.CANCELLED },
        { id: 'order-1' },
      );
      expect(eventsService.emitPositionsUpdate).toHaveBeenCalledWith('user-1');
    });

    it('should throw error when order not found', async () => {
      databaseService.select.mockResolvedValueOnce([]);
      await expect(
        service.cancelLimitOrder('non-existent', 'user-1'),
      ).rejects.toThrow('Limit order not found');
    });

    it('should throw error when order is not in OPEN status', async () => {
      databaseService.select.mockResolvedValueOnce([
        { ...mockLimitOrder, status: OrderStatus.FILLED },
      ]);
      await expect(
        service.cancelLimitOrder('order-1', 'user-1'),
      ).rejects.toThrow('Order cannot be cancelled');
    });
  });

  describe('getUserLimitOrders', () => {
    it('should return user limit orders', async () => {
      const result = await service.getUserLimitOrders('user-1');
      expect(result).toEqual([mockLimitOrder]);
      expect(databaseService.select).toHaveBeenCalledWith('limit_orders', {
        eq: { userId: 'user-1' },
        order: { column: 'createdAt', ascending: false },
      });
    });
  });

  describe('getMarketLimitOrders', () => {
    it('should return market limit orders', async () => {
      const result = await service.getMarketLimitOrders('market-1');
      expect(result).toEqual([mockLimitOrder]);
      expect(databaseService.select).toHaveBeenCalledWith('limit_orders', {
        eq: { marketId: 'market-1', status: OrderStatus.OPEN },
        order: { column: 'price', ascending: true },
      });
    });
  });

  // Testing private methods through their public interfaces
  describe('limit order execution', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      priceService.getCurrentPrice.mockResolvedValue('50000');
      // Mock the private checkAndExecuteLimitOrders method
      jest.spyOn(service as any, 'checkAndExecuteLimitOrders');
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should execute limit order when conditions are met', async () => {
      // Set up mocks
      databaseService.select.mockResolvedValueOnce([mockLimitOrder]); // For fetching open orders
      priceService.getCurrentPrice.mockResolvedValueOnce('50000'); // Price matches limit price

      // Manually trigger the check function
      await (service as any).checkAndExecuteLimitOrders();

      // Wait for all promises to resolve
      await Promise.resolve();

      expect(tradeService.openPosition).toHaveBeenCalled();
      expect(databaseService.update).toHaveBeenCalledWith(
        'limit_orders',
        { status: OrderStatus.FILLED },
        { id: mockLimitOrder.id },
      );
    });

    it('should cancel order when insufficient margin during execution', async () => {
      // Set up mocks
      databaseService.select.mockResolvedValueOnce([mockLimitOrder]); // For fetching open orders
      marginService.getBalance.mockResolvedValueOnce({
        ...mockMarginBalance,
        availableBalance: '10',
      });
      priceService.getCurrentPrice.mockResolvedValueOnce('50000'); // Price matches limit price

      // Manually trigger the check function
      await (service as any).checkAndExecuteLimitOrders();

      // Wait for all promises to resolve
      await Promise.resolve();

      expect(databaseService.update).toHaveBeenCalledWith(
        'limit_orders',
        { status: OrderStatus.CANCELLED },
        { id: mockLimitOrder.id },
      );
    });
  });
});
