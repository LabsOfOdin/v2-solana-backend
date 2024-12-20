import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import bs58 from 'bs58';
import * as nacl from 'tweetnacl';
import { User } from '../entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async validateNonce(publicKey: string): Promise<string> {
    // Generate a random nonce for the user to sign
    const nonce = Math.random().toString(36).substring(2, 15);
    // In production, store this nonce in Redis/cache with expiration
    return nonce;
  }

  async verifySignature(
    message: string,
    signature: string,
    publicKey: string,
  ): Promise<boolean> {
    try {
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = bs58.decode(signature);
      const publicKeyBytes = bs58.decode(publicKey);

      return nacl.sign.detached.verify(
        messageBytes,
        signatureBytes,
        publicKeyBytes,
      );
    } catch (error) {
      throw new UnauthorizedException('Invalid signature');
    }
  }

  async login(
    publicKey: string,
    signature: string,
    nonce: string,
  ): Promise<{ access_token: string; user: User }> {
    // Verify the signature
    const isValid = await this.verifySignature(nonce, signature, publicKey);
    if (!isValid) {
      throw new UnauthorizedException('Invalid signature');
    }

    // Get or create user
    let user = await this.userService.getUserByPublicKey(publicKey);
    if (!user) {
      user = await this.userService.createUser(publicKey);
    }

    // Generate JWT token
    const payload = { sub: user.id, publicKey: user.publicKey };
    const access_token = this.jwtService.sign(payload);

    return {
      access_token,
      user,
    };
  }

  async validateUser(payload: any): Promise<User> {
    const user = await this.userService.getUserByPublicKey(payload.publicKey);
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
