import { Controller, Post, Body, ConflictException } from '@nestjs/common';
import { UserService } from './user.service';
import { User } from '../entities/user.entity';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  async createUser(@Body('publicKey') publicKey: string): Promise<User> {
    try {
      // First try to find if user exists
      const existingUser = await this.userService.getUserByPublicKey(publicKey);
      return existingUser;
    } catch (error) {
      try {
        // If user doesn't exist, create a new one
        return await this.userService.createUser(publicKey);
      } catch (error) {
        // Handle database unique constraint violation
        if (error.code === '23505') {
          // PostgreSQL unique violation code
          // If we hit a duplicate key error, it means another concurrent request
          // created the user. Try to fetch it again.
          return await this.userService.getUserByPublicKey(publicKey);
        }
        throw error;
      }
    }
  }
}
