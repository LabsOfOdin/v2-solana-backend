import { Test, TestingModule } from '@nestjs/testing';
import { MarketService } from './market.service';
import { DatabaseService } from '../database/database.service';
import { PriceService } from '../price/price.service';
import { StatsService } from '../stats/stats.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Market } from '../entities/market.entity';
import { CreateMarketDto, UpdateMarketDto } from '../types/market.types';
import { TokenType } from '../types/token.types';
import { OrderSide } from '../types/trade.types';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('MarketService', () => {
  let service: MarketService;
  let databaseService: jest.Mocked<DatabaseService>;
  let priceService: jest.Mocked<PriceService>;
  let statsService: jest.Mocked<StatsService>;
  let cacheManager: jest.Mocked<Cache>;

  const mockMarket: Market = {
    id: 'market-1',
    symbol: 'BTC-USD',
    tokenAddress: 'token-address',
    poolAddress: 'pool-address',
    maxLeverage: '10',
    maintainanceMargin: '0.05',
    borrowingRate: '0.0003',
    fundingRate: '0',
    fundingRateVelocity: '0',
    maxFundingRate: '0.0003',
    maxFundingVelocity: '0.01',
    lastUpdatedTimestamp: Date.now(),
    longOpenInterest: '1000',
    shortOpenInterest: '800',
    availableLiquidity: '10000',
    virtualBaseReserve: '1000000000',
    virtualQuoteReserve: '1000000000000',
    virtualK: '1000000000000000000000',
    cumulativeFeesSol: '0',
    cumulativeFeesUsdc: '0',
    unclaimedFeesSol: '0',
    unclaimedFeesUsdc: '0',
  } as Market;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketService,
        {
          provide: DatabaseService,
          useValue: {
            select: jest.fn(),
            insert: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: PriceService,
          useValue: {
            getCurrentPrice: jest.fn(),
            getVirtualPrice: jest.fn(),
            getUsdcPrice: jest.fn(),
            updateVirtualPrice: jest.fn(),
          },
        },
        {
          provide: StatsService,
          useValue: {
            addVolume: jest.fn(),
            getMarketStats: jest.fn(),
          },
        },
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MarketService>(MarketService);
    databaseService = module.get(DatabaseService);
    priceService = module.get(PriceService);
    statsService = module.get(StatsService);
    cacheManager = module.get(CACHE_MANAGER);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createMarket', () => {
    const createMarketDto: CreateMarketDto = {
      symbol: 'BTC-USD',
      tokenAddress: 'token-address',
      poolAddress: 'pool-address',
      maxLeverage: '10',
      maintainanceMargin: '0.05',
    };

    beforeEach(() => {
      databaseService.select.mockResolvedValue([]);
      priceService.getCurrentPrice.mockResolvedValue('50000');
      databaseService.insert.mockResolvedValue([mockMarket]);
      statsService.addVolume.mockResolvedValue();
    });

    it('should successfully create a market', async () => {
      const result = await service.createMarket(createMarketDto);
      expect(result).toEqual(mockMarket);
      expect(databaseService.insert).toHaveBeenCalled();
      expect(statsService.addVolume).toHaveBeenCalled();
    });

    it('should throw ConflictException if market already exists', async () => {
      databaseService.select.mockResolvedValue([mockMarket]);
      await expect(service.createMarket(createMarketDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('updateMarket', () => {
    const updateMarketDto: UpdateMarketDto = {
      longOpenInterest: '2000',
      shortOpenInterest: '1500',
      borrowingRate: '0.0004',
    };

    beforeEach(() => {
      databaseService.update.mockResolvedValue([
        { ...mockMarket, ...updateMarketDto },
      ]);
    });

    it('should successfully update a market', async () => {
      const result = await service.updateMarket('market-1', updateMarketDto);
      expect(result).toMatchObject(updateMarketDto);
      expect(databaseService.update).toHaveBeenCalled();
    });
  });

  describe('getMarketById', () => {
    beforeEach(() => {
      cacheManager.get.mockResolvedValue(null);
      databaseService.select.mockResolvedValue([mockMarket]);
    });

    it('should return market from cache if available', async () => {
      cacheManager.get.mockResolvedValue(mockMarket);
      const result = await service.getMarketById('market-1');
      expect(result).toEqual(mockMarket);
      expect(databaseService.select).not.toHaveBeenCalled();
    });

    it('should fetch market from database if not in cache', async () => {
      const result = await service.getMarketById('market-1');
      expect(result).toEqual(mockMarket);
      expect(databaseService.select).toHaveBeenCalled();
      expect(cacheManager.set).toHaveBeenCalled();
    });

    it('should throw NotFoundException if market not found', async () => {
      databaseService.select.mockResolvedValue([]);
      await expect(service.getMarketById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getAllMarkets', () => {
    beforeEach(() => {
      cacheManager.get.mockResolvedValue(null);
      databaseService.select.mockResolvedValue([mockMarket]);
      priceService.getCurrentPrice.mockResolvedValue('50000');
      statsService.getMarketStats.mockResolvedValue({
        id: 'stats-1',
        marketId: 'market-1',
        volume24h: '1000000',
        allTimeVolume: '5000000',
        lastUpdatedTimestamp: Date.now(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should return all markets with info', async () => {
      const result = await service.getAllMarkets();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: mockMarket.id,
        symbol: mockMarket.symbol,
        lastPrice: '50000',
        volume24h: '1000000',
      });
    });

    it('should handle missing market stats', async () => {
      statsService.getMarketStats.mockRejectedValue(new Error());
      const result = await service.getAllMarkets();
      expect(result[0].volume24h).toBe('0');
    });
  });

  describe('claimFees', () => {
    beforeEach(() => {
      databaseService.select.mockResolvedValue([mockMarket]);
    });

    it('should claim SOL fees', async () => {
      const market = { ...mockMarket, unclaimedFeesSol: '100' };
      databaseService.select.mockResolvedValue([market]);

      const result = await service.claimFees('market-1', TokenType.SOL);
      expect(result.claimedAmount).toBe('100');
      expect(databaseService.update).toHaveBeenCalledWith(
        'markets',
        { unclaimedFeesSol: '0' },
        { id: 'market-1' },
      );
    });

    it('should claim USDC fees', async () => {
      const market = { ...mockMarket, unclaimedFeesUsdc: '1000' };
      databaseService.select.mockResolvedValue([market]);

      const result = await service.claimFees('market-1', TokenType.USDC);
      expect(result.claimedAmount).toBe('1000');
      expect(databaseService.update).toHaveBeenCalledWith(
        'markets',
        { unclaimedFeesUsdc: '0' },
        { id: 'market-1' },
      );
    });
  });

  describe('updateVirtualReserves', () => {
    beforeEach(() => {
      databaseService.select.mockResolvedValue([mockMarket]);
      priceService.getCurrentPrice.mockResolvedValue('50000');
      priceService.getUsdcPrice.mockResolvedValue(1);
    });
  });

  describe('addTradingFees', () => {
    beforeEach(() => {
      databaseService.select.mockResolvedValue([mockMarket]);
    });

    it('should add SOL trading fees', async () => {
      await service.addTradingFees('market-1', '10', TokenType.SOL);
      expect(databaseService.update).toHaveBeenCalledWith(
        'markets',
        {
          cumulativeFeesSol: '10',
          unclaimedFeesSol: '10',
        },
        { id: 'market-1' },
      );
    });

    it('should add USDC trading fees', async () => {
      await service.addTradingFees('market-1', '100', TokenType.USDC);
      expect(databaseService.update).toHaveBeenCalledWith(
        'markets',
        {
          cumulativeFeesUsdc: '100',
          unclaimedFeesUsdc: '100',
        },
        { id: 'market-1' },
      );
    });
  });

  describe('getFundingRate', () => {
    beforeEach(() => {
      databaseService.select.mockResolvedValue([mockMarket]);
      priceService.getVirtualPrice.mockResolvedValue('50000');
      priceService.getCurrentPrice.mockResolvedValue('49000');
    });

    it('should calculate funding rate based on price difference', async () => {
      const result = await service.getFundingRate('market-1');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });

  describe('updateFundingRates', () => {
    beforeEach(() => {
      databaseService.select.mockResolvedValue([mockMarket]);
      priceService.getVirtualPrice.mockResolvedValue('50000');
      priceService.getCurrentPrice.mockResolvedValue('49000');
    });

    it('should update funding rates for all markets', async () => {
      await service.updateFundingRates();
      expect(databaseService.update).toHaveBeenCalledWith(
        'markets',
        expect.objectContaining({
          fundingRate: expect.any(String),
        }),
        { id: mockMarket.id },
      );
    });
  });
});
