import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeckVocabulary } from '@/decks/entities/deck-vocabulary.entity';
import { AnswerGraderService } from '@/learn/answer-grader.service';
import { DistractorService } from '@/learn/distractor.service';
import { HmacSignerService } from '@/learn/hmac-signer.service';
import { LearnController } from '@/learn/learn.controller';
import { LearnService } from '@/learn/learn.service';
import { QuestionBuilderService } from '@/learn/question-builder.service';
import { VocabPickerService } from '@/learn/vocab-picker.service';
import { UserWordProgress } from '@/progress/entities/user-word-progress.entity';
import { ProgressModule } from '@/progress/progress.module';
import { Topic } from '@/topics/entities/topic.entity';
import { User } from '@/users/entities/user.entity';
import { VocabularyTranslation } from '@/vocabularies/entities/vocabulary-translation.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserWordProgress,
      Vocabulary,
      VocabularyTranslation,
      DeckVocabulary,
      Topic,
      User,
    ]),
    ProgressModule,
  ],
  controllers: [LearnController],
  providers: [
    LearnService,
    QuestionBuilderService,
    DistractorService,
    AnswerGraderService,
    HmacSignerService,
    VocabPickerService,
  ],
  // Exported so the practice module can reuse the SRS picker to suggest words.
  exports: [VocabPickerService],
})
export class LearnModule {}
