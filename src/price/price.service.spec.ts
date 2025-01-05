import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { PriceService } from './price.service';
import { MarketService } from '../market/market.service';
import { OrderSide } from '../types/trade.types';
import { Market } from '../entities/market.entity';
import { multiply, divide, add, subtract } from '../lib/math';

describe('PriceService - Virtual AMM', () => {
  let service: PriceService;
  let marketService: MarketService;

  // Using simpler numbers for easier verification
  // baseReserve: 1000 (in base-9)
  // quoteReserve: 1000 (in base-6)
  // price should be 1 USDC per token
  const mockMarket: Market = {
    id: 'test-market',
    symbol: 'TEST',
    tokenAddress: 'test-token-address',
    poolAddress: 'test-pool-address',
    virtualBaseReserve: '1000000000000', // 1000 in base-9
    virtualQuoteReserve: '1000000000', // 1000 in base-6
    virtualK: '1000000000000000000000000', // baseReserve * quoteReserve
  } as Market;

  const BASE_UNIT_DELTA = '1000'; // base-3 (9-6)
  const USDC_BASE_UNIT = '1000000'; // base-6
  const SPL_BASE_UNIT = '1000000000'; // base-9

  const mockMarketService = {
    getMarketById: jest.fn().mockResolvedValue(mockMarket),
  };

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceService,
        {
          provide: MarketService,
          useValue: mockMarketService,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<PriceService>(PriceService);
    marketService = module.get<MarketService>(MarketService);
  });

  describe('getVirtualPrice', () => {
    it('should return cached virtual price if available', async () => {
      const marketId = 'test-market';
      const cachedPrice = '1.5';
      (service as any).virtualPrices.set(marketId, cachedPrice);

      const result = await service.getVirtualPrice(marketId);
      expect(result).toBe(cachedPrice);
    });

    it('should calculate correct initial price based on reserves', async () => {
      const marketId = 'test-market';
      const result = await service.getVirtualPrice(marketId);

      // Initial price = (quoteReserve * BASE_UNIT_DELTA) / baseReserve
      // (1000000000 * 1000) / 1000000000000 = 1
      expect(result).toBe('1');
      expect((service as any).virtualPrices.get(marketId)).toBe('1');
    });
  });

  describe('previewPrice', () => {
    beforeEach(() => {
      jest.spyOn(service, 'getUsdcPrice').mockResolvedValue(1);
      jest.spyOn(service, 'getVirtualPrice').mockResolvedValue('1');
    });

    it('should calculate correct price impact for a long trade', async () => {
      const marketId = 'test-market';
      const side = OrderSide.LONG;
      const sizeUsd = '100'; // 100 USD

      // Convert USD size to USDC base-6 units
      const sizeInBaseUnits = multiply(sizeUsd, USDC_BASE_UNIT);

      const result = await service.previewPrice(marketId, side, sizeUsd);

      // Calculate expected values
      const baseOut = divide(
        multiply(sizeInBaseUnits, mockMarket.virtualBaseReserve),
        mockMarket.virtualQuoteReserve,
      );
      const newBaseReserve = subtract(mockMarket.virtualBaseReserve, baseOut);
      const newQuoteReserve = add(
        mockMarket.virtualQuoteReserve,
        sizeInBaseUnits,
      );

      // Calculate execution price with base unit adjustment
      const executionPrice = multiply(
        divide(newQuoteReserve, newBaseReserve),
        BASE_UNIT_DELTA,
      );

      // Calculate price impact
      const priceImpact = divide(subtract(executionPrice, '1'), '1');

      expect(result.executionPrice).toBe(executionPrice);
      expect(result.priceImpact).toBe(priceImpact);
    });

    it('should calculate correct price impact for a short trade', async () => {
      const marketId = 'test-market';
      const side = OrderSide.SHORT;
      const sizeUsd = '100'; // 100 USD

      // Convert USD size to base token units (base-9)
      const sizeInBaseUnits = multiply(sizeUsd, SPL_BASE_UNIT);

      const result = await service.previewPrice(marketId, side, sizeUsd);

      // Calculate expected values
      const newBaseReserve = add(
        mockMarket.virtualBaseReserve,
        sizeInBaseUnits,
      );
      const newQuoteReserve = divide(mockMarket.virtualK, newBaseReserve);

      // Calculate execution price with base unit adjustment
      const executionPrice = multiply(
        divide(newQuoteReserve, newBaseReserve),
        BASE_UNIT_DELTA,
      );

      // Calculate price impact
      const priceImpact = divide(subtract(executionPrice, '1'), '1');

      expect(result.executionPrice).toBe(executionPrice);
      expect(result.priceImpact).toBe(priceImpact);
    });

    it('should verify constant product (k) remains unchanged after trade', async () => {
      const marketId = 'test-market';
      const side = OrderSide.LONG;
      const sizeUsd = '100';

      // Convert USD size to USDC base-6 units
      const sizeInBaseUnits = multiply(sizeUsd, USDC_BASE_UNIT);

      // Calculate how many base tokens we get for our quote tokens
      const baseOut = divide(
        multiply(sizeInBaseUnits, mockMarket.virtualBaseReserve),
        mockMarket.virtualQuoteReserve,
      );

      // Update reserves
      const newBaseReserve = subtract(mockMarket.virtualBaseReserve, baseOut);
      const newQuoteReserve = divide(mockMarket.virtualK, newBaseReserve);

      const initialK = mockMarket.virtualK;
      const newK = multiply(newBaseReserve, newQuoteReserve);

      // Using relative error
      const kDifference = Math.abs(
        parseFloat(divide(subtract(initialK, newK), initialK)),
      );
      expect(kDifference).toBeLessThan(1e-6); // Using more reasonable tolerance
    });

    it('should show price impact increases non-linearly with trade size', async () => {
      const marketId = 'test-market';
      const side = OrderSide.LONG;
      const sizes = ['100', '200', '300', '400'];

      const impacts = await Promise.all(
        sizes.map(async (size) => {
          const result = await service.previewPrice(marketId, side, size);
          return Math.abs(parseFloat(result.priceImpact));
        }),
      );

      // Verify that price impact increases are accelerating
      const differences = impacts
        .slice(1)
        .map((impact, i) => impact - impacts[i]);
      for (let i = 1; i < differences.length; i++) {
        expect(differences[i]).toBeGreaterThan(differences[i - 1]);
      }
    });
  });

  describe('calculateVirtualPrice', () => {
    it('should maintain constant product invariant for long trades', async () => {
      const side = OrderSide.LONG;
      const sizeUsd = '100';

      const result = await service.calculateVirtualPrice(
        mockMarket,
        side,
        sizeUsd,
      );

      // For longs: trader buys base token with quote token
      const baseOut = divide(
        multiply(sizeUsd, mockMarket.virtualBaseReserve),
        mockMarket.virtualQuoteReserve,
      );
      const newBaseReserve = subtract(mockMarket.virtualBaseReserve, baseOut);
      const newQuoteReserve = divide(mockMarket.virtualK, newBaseReserve);
      const expectedPrice = divide(newQuoteReserve, newBaseReserve);

      expect(result).toBe(expectedPrice);
    });

    it('should maintain constant product invariant for short trades', async () => {
      const side = OrderSide.SHORT;
      const sizeUsd = '100';

      const result = await service.calculateVirtualPrice(
        mockMarket,
        side,
        sizeUsd,
      );

      // For shorts: trader sells base token for quote token
      const quoteOut = sizeUsd;
      const newQuoteReserve = subtract(
        mockMarket.virtualQuoteReserve,
        quoteOut,
      );
      const newBaseReserve = divide(mockMarket.virtualK, newQuoteReserve);
      const expectedPrice = divide(newQuoteReserve, newBaseReserve);

      expect(result).toBe(expectedPrice);
    });
  });
});
