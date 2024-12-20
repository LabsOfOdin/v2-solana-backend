import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketService } from './market.service';
import { MarketController } from './market.controller';
import { Market } from '../entities/market.entity';
import { PriceModule } from '../price/price.module';
import { MathService } from '../utils/math.service';

@Module({
  imports: [TypeOrmModule.forFeature([Market]), PriceModule],
  providers: [MarketService, MathService],
  controllers: [MarketController],
  exports: [MarketService],
})
export class MarketModule {}
