import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserService } from './user.service';
import { User } from '../entities/user.entity';
import { MarginLock } from '../entities/margin-lock.entity';
import { MathService } from '../utils/math.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, MarginLock])],
  providers: [UserService, MathService],
  exports: [UserService],
})
export class UserModule {}
