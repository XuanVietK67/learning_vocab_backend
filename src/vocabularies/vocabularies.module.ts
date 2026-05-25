import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Deck } from '@/decks/entities/deck.entity';
import { DeckVocabulary } from '@/decks/entities/deck-vocabulary.entity';
import { Topic } from '@/topics/entities/topic.entity';
import { VocabularyTopic } from '@/topics/entities/vocabulary-topic.entity';
import { VocabularyExample } from '@/vocabularies/entities/vocabulary-example.entity';
import { VocabularyTranslation } from '@/vocabularies/entities/vocabulary-translation.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';
import { VocabulariesController } from '@/vocabularies/vocabularies.controller';
import { VocabulariesService } from '@/vocabularies/vocabularies.service';

// Related entities are registered here (not in their own modules) so TypeORM
// can resolve the cross-entity relations under `autoLoadEntities: true`.
// They will move to dedicated Topics / Decks modules when those modules
// gain their own controllers.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Vocabulary,
      VocabularyTranslation,
      VocabularyExample,
      Topic,
      VocabularyTopic,
      Deck,
      DeckVocabulary,
    ]),
  ],
  controllers: [VocabulariesController],
  providers: [VocabulariesService],
  exports: [VocabulariesService],
})
export class VocabulariesModule {}
