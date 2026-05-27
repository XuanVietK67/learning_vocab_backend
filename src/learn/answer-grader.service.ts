import { Injectable } from '@nestjs/common';
import {
  buildCloze,
  levenshtein,
  normalizeAnswer,
  tokenizeSentence,
} from '@/learn/cloze.util';
import { QuestionType } from '@/learn/enums/question-type.enum';
import { ReviewQuality } from '@/progress/srs';
import { VocabularyExample } from '@/vocabularies/entities/vocabulary-example.entity';
import { VocabularySense } from '@/vocabularies/entities/vocabulary-sense.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

const FAST_THRESHOLD_MS = 8_000;

export interface GradeInput {
  type: QuestionType;
  vocab: Vocabulary;
  example: VocabularyExample;
  sense: VocabularySense;
  translationLang: string | null;
  userAnswer: string;
  latencyMs: number;
}

export interface GradeOutput {
  correct: boolean;
  correctAnswer: string;
  quality: ReviewQuality;
}

@Injectable()
export class AnswerGraderService {
  grade(input: GradeInput): GradeOutput {
    switch (input.type) {
      case QuestionType.CLOZE_MCQ:
      case QuestionType.LISTENING_CLOZE:
        return this.gradeClozeMcq(input);
      case QuestionType.CLOZE_TYPING:
        return this.gradeClozeTyping(input);
      case QuestionType.MEANING_IN_CONTEXT:
        return this.gradeMeaningInContext(input);
      case QuestionType.SENTENCE_BUILD:
        return this.gradeSentenceBuild(input);
      case QuestionType.SENSE_DISAMBIGUATION:
        return this.gradeSenseDisambiguation(input);
    }
  }

  // For MCQ-style cloze, the userAnswer is the chosen option string.
  // The correct answer is the actual inflected form that was blanked.
  private gradeClozeMcq(input: GradeInput): GradeOutput {
    const cloze = buildCloze(
      input.example.sentence,
      input.vocab.lemma,
      input.vocab.partOfSpeech,
    );
    const correctAnswer = cloze?.blankedForm ?? input.vocab.lemma;
    const correct =
      normalizeAnswer(input.userAnswer) === normalizeAnswer(correctAnswer);
    return {
      correct,
      correctAnswer,
      quality: mcqQuality(correct, input.latencyMs),
    };
  }

  private gradeClozeTyping(input: GradeInput): GradeOutput {
    const cloze = buildCloze(
      input.example.sentence,
      input.vocab.lemma,
      input.vocab.partOfSpeech,
    );
    const correctAnswer = cloze?.blankedForm ?? input.vocab.lemma;
    const user = normalizeAnswer(input.userAnswer);
    const target = normalizeAnswer(correctAnswer);
    if (user === target) {
      return {
        correct: true,
        correctAnswer,
        quality: input.latencyMs <= FAST_THRESHOLD_MS ? 5 : 4,
      };
    }
    const dist = levenshtein(user, target, 2);
    if (dist === 1) {
      return { correct: false, correctAnswer, quality: 3 };
    }
    return { correct: false, correctAnswer, quality: 2 };
  }

  // Correct answer = the first translation of `input.sense` in translationLang.
  private gradeMeaningInContext(input: GradeInput): GradeOutput {
    const correctAnswer =
      (input.translationLang
        ? input.sense.translations?.find(
            (t) => t.language === input.translationLang,
          )?.translation
        : null) ?? '';
    const correct =
      normalizeAnswer(input.userAnswer) === normalizeAnswer(correctAnswer);
    return {
      correct,
      correctAnswer,
      quality: mcqQuality(correct, input.latencyMs),
    };
  }

  // userAnswer = the joined sequence the user produced (space-separated tokens).
  // We compare against the original example.sentence (whitespace-normalized).
  private gradeSentenceBuild(input: GradeInput): GradeOutput {
    const correctAnswer = input.example.sentence;
    const user = normalizeAnswer(input.userAnswer);
    const target = normalizeAnswer(correctAnswer);
    if (user === target) {
      return {
        correct: true,
        correctAnswer,
        quality: input.latencyMs <= FAST_THRESHOLD_MS ? 5 : 4,
      };
    }
    // Check "one swap" tolerance: same multiset of tokens, ≤1 adjacent swap
    const userTokens = tokenizeSentence(user);
    const targetTokens = tokenizeSentence(target);
    if (
      userTokens.length === targetTokens.length &&
      sameMultiset(userTokens, targetTokens)
    ) {
      let diffs = 0;
      for (let i = 0; i < userTokens.length; i++) {
        if (userTokens[i] !== targetTokens[i]) diffs++;
      }
      if (diffs === 2) {
        return { correct: false, correctAnswer, quality: 3 };
      }
    }
    return { correct: false, correctAnswer, quality: 2 };
  }

  // The frontend submits the translation it picked for the FIRST sentence of
  // the disambiguation pair. The correct answer is the translation of that
  // example's parent sense.
  private gradeSenseDisambiguation(input: GradeInput): GradeOutput {
    const correctAnswer =
      (input.translationLang
        ? input.sense.translations?.find(
            (t) => t.language === input.translationLang,
          )?.translation
        : null) ?? '';
    const correct =
      normalizeAnswer(input.userAnswer) === normalizeAnswer(correctAnswer);
    return {
      correct,
      correctAnswer,
      quality: mcqQuality(correct, input.latencyMs),
    };
  }
}

function mcqQuality(correct: boolean, latencyMs: number): ReviewQuality {
  if (correct) return latencyMs <= FAST_THRESHOLD_MS ? 5 : 4;
  return 2;
}

function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const t of a) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const t of b) {
    const c = counts.get(t);
    if (!c) return false;
    counts.set(t, c - 1);
  }
  return true;
}
