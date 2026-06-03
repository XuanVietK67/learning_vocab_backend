import { Logger } from '@nestjs/common';
import { PassThrough } from 'node:stream';
import ffmpeg from 'fluent-ffmpeg';
import { AudioDecodeError, AudioTooLongError } from './errors';

const logger = new Logger('AudioTranscoder');

// Azure's push stream is fed raw 16-bit signed little-endian PCM, mono, 16 kHz —
// the format `getWaveFormatPCM(16000, 16, 1)` expects. ffmpeg reads the original
// container (m4a/webm/opus/wav) from a seekable temp file and emits headerless
// PCM, so there is no WAV header to parse on the Azure side.
export const TARGET_SAMPLE_RATE = 16000;
export const TARGET_BITS_PER_SAMPLE = 16;
export const TARGET_CHANNELS = 1;

/**
 * Probe the clip's duration. Rejects with {@link AudioDecodeError} when the file
 * is not decodable audio (ffprobe fails or reports no duration).
 */
function probeDurationSeconds(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, data) => {
      if (err) {
        reject(new AudioDecodeError());
        return;
      }
      const duration = data?.format?.duration;
      if (typeof duration !== 'number' || Number.isNaN(duration)) {
        reject(new AudioDecodeError());
        return;
      }
      resolve(duration);
    });
  });
}

/**
 * Transcode an uploaded audio file (any ffmpeg-supported container) to raw PCM
 * suitable for Azure's push stream. Enforces the duration cap before spending an
 * Azure call.
 *
 * @throws AudioTooLongError when the clip is longer than `maxSeconds`.
 * @throws AudioDecodeError  when the input cannot be decoded.
 */
export async function transcodeToPcm(
  inputPath: string,
  maxSeconds: number,
): Promise<Buffer> {
  const duration = await probeDurationSeconds(inputPath);
  if (duration > maxSeconds) {
    throw new AudioTooLongError(maxSeconds);
  }

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const sink = new PassThrough();
    sink.on('data', (chunk: Buffer) => chunks.push(chunk));

    ffmpeg(inputPath)
      .audioFrequency(TARGET_SAMPLE_RATE)
      .audioChannels(TARGET_CHANNELS)
      .audioCodec('pcm_s16le')
      .format('s16le')
      .on('error', (err: Error) => {
        logger.warn(`ffmpeg transcode failed: ${err.message}`);
        reject(new AudioDecodeError());
      })
      .on('end', () => resolve(Buffer.concat(chunks)))
      .pipe(sink, { end: true });
  });
}
