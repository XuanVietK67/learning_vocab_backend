import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import type { AuthenticatedUser } from '@/auth/strategies/jwt.strategy';
import { AttachIntroVideoDto } from '@/speaking-room/dto/attach-intro-video.dto';
import { CreateScenarioDto } from '@/speaking-room/dto/create-scenario.dto';
import {
  PaginatedScenariosResponseDto,
  ScenarioResponseDto,
} from '@/speaking-room/dto/scenario-response.dto';
import { ScenarioQueryDto } from '@/speaking-room/dto/scenario-query.dto';
import { UpdateScenarioDto } from '@/speaking-room/dto/update-scenario.dto';
import { ScenariosService } from '@/speaking-room/scenarios.service';
import { UserRole } from '@/users/entities/user.entity';

// Admin-only authoring surface for speaking-room scenarios (Phase 1). Learner-
// facing browse/recommend reads belong to Phase 2.
@Controller({ path: 'admin/scenarios', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminScenariosController {
  constructor(private readonly scenariosService: ScenariosService) {}

  @Get()
  findAll(
    @Query() query: ScenarioQueryDto,
  ): Promise<PaginatedScenariosResponseDto> {
    return this.scenariosService.findAll(query);
  }

  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ScenarioResponseDto> {
    return this.scenariosService.findOne(id);
  }

  @Post()
  create(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: CreateScenarioDto,
  ): Promise<ScenarioResponseDto> {
    return this.scenariosService.create(dto, current.id);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateScenarioDto,
  ): Promise<ScenarioResponseDto> {
    return this.scenariosService.update(id, dto);
  }

  // Attach the finished HyperFrames MP4 URL. Phase 1 does not run the render.
  @Post(':id/intro-video')
  @HttpCode(HttpStatus.OK)
  attachIntroVideo(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AttachIntroVideoDto,
  ): Promise<ScenarioResponseDto> {
    return this.scenariosService.attachIntroVideo(id, dto);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ScenarioResponseDto> {
    return this.scenariosService.publish(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<void> {
    return this.scenariosService.retire(id);
  }
}
