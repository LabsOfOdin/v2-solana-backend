import { Controller, Post, Body } from '@nestjs/common';
import { UserService } from './user.service';
import { User } from '../entities/user.entity';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  async createUser(@Body('publicKey') publicKey: string): Promise<User> {
    // First try to find if user exists
    try {
      const existingUser = await this.userService.getUserByPublicKey(publicKey);
      return existingUser;
    } catch (error) {
      // If user doesn't exist, create a new one
      return this.userService.createUser(publicKey);
    }
  }
}
