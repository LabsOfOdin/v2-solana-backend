import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Market } from '../entities/market.entity';
import {
  CreateMarketDto,
  UpdateMarketDto,
  MarketInfo,
} from '../types/market.types';
import { MathService } from '../utils/math.service';
import { PriceService } from '../price/price.service';

@Injectable()
export class MarketService {
  constructor(
    @InjectRepository(Market)
    private readonly marketRepository: Repository<Market>,
    private readonly mathService: MathService,
    private readonly priceService: PriceService,
  ) {}

  async createMarket(
    dto: CreateMarketDto,
    adminPublicKey: string,
  ): Promise<Market> {
    // In production, verify admin rights here
    if (adminPublicKey !== process.env.ADMIN_PUBLIC_KEY) {
      throw new UnauthorizedException('Only admin can create markets');
    }

    const existingMarket = await this.marketRepository.findOne({
      where: { symbol: dto.symbol },
    });

    if (existingMarket) {
      throw new ConflictException(`Market ${dto.symbol} already exists`);
    }

    const market = this.marketRepository.create({
      ...dto,
      fundingRate: '0',
    });

    return this.marketRepository.save(market);
  }

  async updateMarket(
    marketId: string,
    dto: UpdateMarketDto,
    adminPublicKey: string,
  ): Promise<Market> {
    if (adminPublicKey !== process.env.ADMIN_PUBLIC_KEY) {
      throw new UnauthorizedException('Only admin can update markets');
    }

    const market = await this.getMarketById(marketId);
    Object.assign(market, dto);

    return this.marketRepository.save(market);
  }

  async getMarketById(marketId: string): Promise<Market> {
    const market = await this.marketRepository.findOne({
      where: { id: marketId },
    });

    if (!market) {
      throw new NotFoundException(`Market ${marketId} not found`);
    }

    return market;
  }

  async getMarketBySymbol(symbol: string): Promise<Market> {
    const market = await this.marketRepository.findOne({
      where: { symbol },
    });

    if (!market) {
      throw new NotFoundException(`Market ${symbol} not found`);
    }

    return market;
  }

  async getAllMarkets(): Promise<Market[]> {
    return this.marketRepository.find({
      order: { symbol: 'ASC' },
    });
  }

  async getMarketInfo(marketId: string): Promise<MarketInfo> {
    const market = await this.getMarketById(marketId);
    const lastPrice = await this.priceService.getCurrentPrice(marketId);

    // In production, implement these calculations
    const volume24h = '0';
    const openInterest = '0';

    return {
      ...market,
      lastPrice,
      volume24h,
      openInterest,
    };
  }

  async updateFundingRate(marketId: string): Promise<void> {
    const market = await this.getMarketById(marketId);
    const newFundingRate = await this.calculateFundingRate(market);

    await this.marketRepository.update(marketId, {
      fundingRate: newFundingRate,
    });
  }

  private async calculateFundingRate(market: Market): Promise<string> {
    // Implement funding rate calculation based on market conditions
    // This is a placeholder implementation
    return '0.0001'; // 0.01% per funding interval
  }
}
