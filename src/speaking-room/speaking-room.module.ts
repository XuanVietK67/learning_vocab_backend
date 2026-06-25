import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminScenariosController } from '@/speaking-room/admin-scenarios.controller';
import { Scenario } from '@/speaking-room/entities/scenario.entity';
import { SpeakingSession } from '@/speaking-room/entities/speaking-session.entity';
import { SpeakingTurn } from '@/speaking-room/entities/speaking-turn.entity';
import { ScenarioDraftService } from '@/speaking-room/scenario-draft.service';
import { ScenariosService } from '@/speaking-room/scenarios.service';
import { SpeakingSessionController } from '@/speaking-room/speaking-session.controller';
import { SpeakingSessionService } from '@/speaking-room/speaking-session.service';
import { User } from '@/users/entities/user.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Scenario,
      SpeakingSession,
      SpeakingTurn,
      Vocabulary,
      User,
    ]),
  ],
  controllers: [AdminScenariosController, SpeakingSessionController],
  providers: [ScenariosService, ScenarioDraftService, SpeakingSessionService],
  exports: [ScenariosService],
})
export class SpeakingRoomModule {}
