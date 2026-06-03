import { PronunciationAttempt } from '@/pronunciation/entities/pronunciation-attempt.entity';

export class AssessedPhonemeDto {
  phoneme!: string;
  accuracyScore!: number | null;
}

export class AssessedWordDto {
  word!: string;
  accuracyScore!: number | null;
  phonemes!: AssessedPhonemeDto[];
}

export class PronunciationResultDto {
  id!: string;
  referenceText!: string;
  recognizedText!: string | null;
  locale!: string;
  overallScore!: number;
  accuracyScore!: number | null;
  fluencyScore!: number | null;
  completenessScore!: number | null;
  prosodyScore!: number | null;
  passed!: boolean;
  words!: AssessedWordDto[];
  createdAt!: Date;

  static fromEntity(entity: PronunciationAttempt): PronunciationResultDto {
    return {
      id: entity.id,
      referenceText: entity.referenceText,
      recognizedText: entity.recognizedText,
      locale: entity.locale,
      overallScore: entity.overallScore,
      accuracyScore: entity.accuracyScore,
      fluencyScore: entity.fluencyScore,
      completenessScore: entity.completenessScore,
      prosodyScore: entity.prosodyScore,
      passed: entity.passed,
      words: entity.phonemes ?? [],
      createdAt: entity.createdAt,
    };
  }
}
