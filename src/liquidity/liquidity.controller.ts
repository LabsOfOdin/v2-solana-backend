import { Controller, Get } from '@nestjs/common';
import { LiquidityService } from './liquidity.service';

@Controller('liquidity')
export class LiquidityController {
  constructor(private readonly liquidityService: LiquidityService) {}

  @Get()
  async getAvailableLiquidity() {
    return this.liquidityService.getAvailableLiquidity();
  }
}
