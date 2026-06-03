import { Logger } from '@nestjs/common';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import type { AssessedWord } from '../entities/pronunciation-attempt.entity';
import {
  TARGET_BITS_PER_SAMPLE,
  TARGET_CHANNELS,
  TARGET_SAMPLE_RATE,
} from './audio-transcoder';
import { NoSpeechDetectedError, SpeechServiceError } from './errors';

const logger = new Logger('AzureSpeechClient');

export interface AzureConfig {
  key: string;
  region: string;
}

export interface AssessmentResult {
  recognizedText: string;
  overallScore: number;
  accuracyScore: number | null;
  fluencyScore: number | null;
  completenessScore: number | null;
  prosodyScore: number | null;
  words: AssessedWord[];
}

// Shape of the per-word/phoneme JSON Azure returns under NBest[0]. Typed loosely
// because the wire payload uses PascalCase and fields are conditionally present.
interface JsonPhoneme {
  Phoneme: string;
  PronunciationAssessment?: { AccuracyScore?: number };
}
interface JsonWord {
  Word: string;
  PronunciationAssessment?: { AccuracyScore?: number };
  Phonemes?: JsonPhoneme[];
}

function toScore(value: number | undefined): number | null {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null;
}

function parseWords(result: sdk.SpeechRecognitionResult): AssessedWord[] {
  const raw = result.properties.getProperty(
    sdk.PropertyId.SpeechServiceResponse_JsonResult,
  );
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as { NBest?: { Words?: JsonWord[] }[] };
    const words = parsed.NBest?.[0]?.Words ?? [];
    return words.map((w) => ({
      word: w.Word,
      accuracyScore: toScore(w.PronunciationAssessment?.AccuracyScore),
      phonemes: (w.Phonemes ?? []).map((p) => ({
        phoneme: p.Phoneme,
        accuracyScore: toScore(p.PronunciationAssessment?.AccuracyScore),
      })),
    }));
  } catch {
    return [];
  }
}

/**
 * Run Azure Pronunciation Assessment over a raw-PCM buffer against
 * `referenceText` in `locale`. Resolves with normalized scores + per-phoneme
 * detail.
 *
 * @throws NoSpeechDetectedError when Azure recognizes no speech.
 * @throws SpeechServiceError    on cancellation/transport/config failure.
 */
export function assessPronunciation(
  pcm: Buffer,
  referenceText: string,
  locale: string,
  config: AzureConfig,
): Promise<AssessmentResult> {
  if (!config.key || !config.region) {
    return Promise.reject(
      new SpeechServiceError('Azure Speech is not configured'),
    );
  }

  return new Promise<AssessmentResult>((resolve, reject) => {
    const speechConfig = sdk.SpeechConfig.fromSubscription(
      config.key,
      config.region,
    );
    speechConfig.speechRecognitionLanguage = locale;

    const format = sdk.AudioStreamFormat.getWaveFormatPCM(
      TARGET_SAMPLE_RATE,
      TARGET_BITS_PER_SAMPLE,
      TARGET_CHANNELS,
    );
    const pushStream = sdk.AudioInputStream.createPushStream(format);
    // Copy the PCM into a standalone ArrayBuffer (the SDK's write() requires a
    // plain ArrayBuffer; a Buffer's .buffer may be shared/pooled), then EOF.
    const arrayBuffer = new ArrayBuffer(pcm.byteLength);
    new Uint8Array(arrayBuffer).set(pcm);
    pushStream.write(arrayBuffer);
    pushStream.close();

    const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
    const pronConfig = new sdk.PronunciationAssessmentConfig(
      referenceText,
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Phoneme,
      true, // enableMiscue
    );
    pronConfig.enableProsodyAssessment = true;

    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    pronConfig.applyTo(recognizer);

    const cleanup = () => recognizer.close();

    recognizer.recognizeOnceAsync(
      (result) => {
        try {
          if (result.reason === sdk.ResultReason.RecognizedSpeech) {
            const pa = sdk.PronunciationAssessmentResult.fromResult(result);
            resolve({
              recognizedText: result.text,
              overallScore: pa.pronunciationScore,
              accuracyScore: toScore(pa.accuracyScore),
              fluencyScore: toScore(pa.fluencyScore),
              completenessScore: toScore(pa.completenessScore),
              prosodyScore: toScore(pa.prosodyScore),
              words: parseWords(result),
            });
          } else if (result.reason === sdk.ResultReason.NoMatch) {
            reject(new NoSpeechDetectedError());
          } else if (result.reason === sdk.ResultReason.Canceled) {
            const details = sdk.CancellationDetails.fromResult(result);
            logger.warn(
              `assessment canceled: ${details.reason} ${details.errorDetails}`,
            );
            reject(new SpeechServiceError());
          } else {
            reject(new SpeechServiceError());
          }
        } finally {
          cleanup();
        }
      },
      (err) => {
        cleanup();
        logger.warn(`recognizeOnce failed: ${err}`);
        reject(new SpeechServiceError());
      },
    );
  });
}
