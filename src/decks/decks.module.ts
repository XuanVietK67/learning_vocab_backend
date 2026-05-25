import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Deck } from '@/decks/entities/deck.entity';
import { DeckVocabulary } from '@/decks/entities/deck-vocabulary.entity';
import { DecksController, MeDecksController } from '@/decks/decks.controller';
import { DecksService } from '@/decks/decks.service';
import { User } from '@/users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Deck, DeckVocabulary, User])],
  controllers: [DecksController, MeDecksController],
  providers: [DecksService],
  exports: [DecksService],
})
export class DecksModule {}
