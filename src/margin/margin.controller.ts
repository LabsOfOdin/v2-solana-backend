import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { MarginService } from './margin.service';
import { TokenType } from 'src/types/token.types';
import { MarginBalance } from 'src/entities/margin-balance.entity';
import { UserService } from '../users/user.service';

@Controller('margin')
export class MarginController {
  constructor(
    private readonly marginService: MarginService,
    private readonly userService: UserService,
  ) {}

  @Post('deposit')
  async depositMargin(
    @Body()
    body: {
      publicKey: string;
      amount: string;
      token: TokenType;
      txHash: string;
    },
  ) {
    const user = await this.userService.getUserByPublicKey(body.publicKey);

    if (!user) {
      throw new BadRequestException(
        `User with public key ${body.publicKey} not found`,
      );
    }

    return this.marginService.depositMargin(
      user,
      body.amount,
      body.token,
      body.txHash,
    );
  }

  @Post('withdraw')
  async requestWithdrawal(
    @Body()
    body: {
      publicKey: string;
      amount: string;
      token: TokenType;
    },
  ) {
    const user = await this.userService.getUserByPublicKey(body.publicKey);
    if (!user) {
      throw new BadRequestException(
        `User with public key ${body.publicKey} not found`,
      );
    }

    return this.marginService.requestWithdrawal(
      user,
      body.amount,
      body.token,
      body.publicKey,
    );
  }

  @Get('balance/:token')
  async getBalance(
    @Param('token') token: TokenType,
    @Query('publicKey') publicKey: string,
  ): Promise<MarginBalance> {
    const user = await this.userService.getUserByPublicKey(publicKey);
    if (!user) {
      throw new BadRequestException(
        `User with public key ${publicKey} not found`,
      );
    }
    return this.marginService.getBalance(publicKey, token);
  }
}
