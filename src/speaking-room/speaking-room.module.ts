import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminScenariosController } from '@/speaking-room/admin-scenarios.controller';
import { Scenario } from '@/speaking-room/entities/scenario.entity';
import { ScenarioDraftService } from '@/speaking-room/scenario-draft.service';
import { ScenariosService } from '@/speaking-room/scenarios.service';

@Module({
  imports: [TypeOrmModule.forFeature([Scenario])],
  controllers: [AdminScenariosController],
  providers: [ScenariosService, ScenarioDraftService],
  exports: [ScenariosService],
})
export class SpeakingRoomModule {}
