import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';
import { VocabulariesController } from '@/vocabularies/vocabularies.controller';
import { VocabulariesService } from '@/vocabularies/vocabularies.service';

@Module({
  imports: [TypeOrmModule.forFeature([Vocabulary])],
  controllers: [VocabulariesController],
  providers: [VocabulariesService],
  exports: [VocabulariesService],
})
export class VocabulariesModule {}
