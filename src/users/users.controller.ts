import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '@/auth/strategies/jwt.strategy';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

@Controller({ path: 'users', version: '1' })
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  async findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() current: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    this.assertSelf(current, id);
    const user = await this.usersService.findById(id);
    return this.usersService.toResponse(user);
  }

  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateUserProfileDto,
    @CurrentUser() current: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    this.assertSelf(current, id);
    const user = await this.usersService.updateProfile(id, dto);
    return this.usersService.toResponse(user);
  }

  private assertSelf(current: AuthenticatedUser, targetId: string): void {
    if (current.id !== targetId) {
      throw new ForbiddenException('cannot modify another user');
    }
  }
}
