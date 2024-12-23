import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PinAuthGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const pin = request.headers['x-admin-pin'];

    if (!pin) {
      throw new UnauthorizedException('Admin PIN is required');
    }

    const configuredPin = this.configService.get<string>('ADMIN_PIN');
    if (!configuredPin) {
      throw new UnauthorizedException('Admin PIN is not configured');
    }

    if (pin !== configuredPin) {
      throw new UnauthorizedException('Invalid admin PIN');
    }

    return true;
  }
}
