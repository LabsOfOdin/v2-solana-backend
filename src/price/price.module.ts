import { forwardRef, Module } from '@nestjs/common';
import { PriceService } from './price.service';
import { PriceController } from './price.controller';
import { MarketModule } from 'src/market/market.module';

@Module({
  imports: [forwardRef(() => MarketModule)],
  controllers: [PriceController],
  providers: [PriceService],
  exports: [PriceService],
})
export class PriceModule {}
