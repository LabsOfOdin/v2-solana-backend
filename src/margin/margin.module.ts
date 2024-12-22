import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarginService } from './margin.service';
import { MarginController } from './margin.controller';
import { WithdrawalRequest } from '../entities/withdrawal-request.entity';
import { MarginLock } from '../entities/margin-lock.entity';
import { UserModule } from '../user/user.module';
import { MathService } from '../utils/math.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([WithdrawalRequest, MarginLock]),
    UserModule,
  ],
  providers: [MarginService, MathService],
  controllers: [MarginController],
  exports: [MarginService],
})
export class MarginModule {}
