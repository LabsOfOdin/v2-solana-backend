import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('nonce/:publicKey')
  async getNonce(
    @Param('publicKey') publicKey: string,
  ): Promise<{ nonce: string }> {
    const nonce = await this.authService.validateNonce(publicKey);
    return { nonce };
  }

  @Post('login')
  async login(
    @Body()
    body: {
      publicKey: string;
      signature: string;
      nonce: string;
    },
  ) {
    return this.authService.login(body.publicKey, body.signature, body.nonce);
  }
}
