import { Module } from '@nestjs/common';
import { MarginService } from './margin.service';
import { MarginController } from './margin.controller';
import { UserModule } from '../users/user.module';
import { SolanaModule } from '../solana/solana.module';
import { DatabaseModule } from 'src/database/database.module';
import { EventsModule } from 'src/events/events.module';

@Module({
  imports: [DatabaseModule, UserModule, SolanaModule, EventsModule],
  controllers: [MarginController],
  providers: [MarginService],
  exports: [MarginService],
})
export class MarginModule {}
