import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VocabularyExample } from '@/vocabularies/entities/vocabulary-example.entity';
import { VocabularyTranslation } from '@/vocabularies/entities/vocabulary-translation.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';
import { AdminVocabulariesController } from '@/vocabularies/admin-vocabularies.controller';
import { MeVocabulariesController } from '@/vocabularies/me-vocabularies.controller';
import { VocabulariesController } from '@/vocabularies/vocabularies.controller';
import { VocabulariesService } from '@/vocabularies/vocabularies.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Vocabulary,
      VocabularyTranslation,
      VocabularyExample,
    ]),
  ],
  controllers: [
    VocabulariesController,
    MeVocabulariesController,
    AdminVocabulariesController,
  ],
  providers: [VocabulariesService],
  exports: [VocabulariesService],
})
export class VocabulariesModule {}
