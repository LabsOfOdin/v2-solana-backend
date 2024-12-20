import { Module } from '@nestjs/common';
import { PriceService } from './price.service';

@Module({
  providers: [PriceService]
})
export class PriceModule {}
