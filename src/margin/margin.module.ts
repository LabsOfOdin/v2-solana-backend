import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarginService } from './margin.service';
import { MarginController } from './margin.controller';
import { WithdrawalRequest } from '../entities/withdrawal-request.entity';
import { MarginLock } from '../entities/margin-lock.entity';
import { UserModule } from '../user/user.module';
import { MathModule } from 'src/utils/math.module';
import { SolanaModule } from '../solana/solana.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WithdrawalRequest, MarginLock]),
    UserModule,
    MathModule,
    SolanaModule,
  ],
  controllers: [MarginController],
  providers: [MarginService],
  exports: [MarginService],
})
export class MarginModule {}
