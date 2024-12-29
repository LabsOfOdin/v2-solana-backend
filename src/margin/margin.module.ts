import { Module } from '@nestjs/common';
import { MarginService } from './margin.service';
import { MarginController } from './margin.controller';
import { UserModule } from '../user/user.module';
import { SolanaModule } from '../solana/solana.module';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [DatabaseModule, UserModule, SolanaModule],
  controllers: [MarginController],
  providers: [MarginService],
  exports: [MarginService],
})
export class MarginModule {}
