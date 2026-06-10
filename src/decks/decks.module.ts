import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Deck } from '@/decks/entities/deck.entity';
import { DeckVocabulary } from '@/decks/entities/deck-vocabulary.entity';
import { DeckMembershipService } from '@/decks/deck-membership.service';
import { DecksController, MeDecksController } from '@/decks/decks.controller';
import { DecksService } from '@/decks/decks.service';
import { User } from '@/users/entities/user.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';
import { VocabulariesModule } from '@/vocabularies/vocabularies.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Deck, DeckVocabulary, User, Vocabulary]),
    VocabulariesModule,
  ],
  controllers: [DecksController, MeDecksController],
  providers: [DecksService, DeckMembershipService],
  exports: [DecksService, DeckMembershipService],
})
export class DecksModule {}
