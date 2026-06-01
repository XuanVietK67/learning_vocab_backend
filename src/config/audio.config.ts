import { registerAs } from '@nestjs/config';

export default registerAs('audio', () => ({
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
    folder: process.env.CLOUDINARY_AUDIO_FOLDER ?? 'vocab-audio',
  },
  // Any Edge neural voice ShortName, e.g. en-US-AriaNeural.
  ttsVoice: process.env.TTS_VOICE ?? 'en-US-AriaNeural',
  // Jobs processed in parallel by the audio worker.
  workerConcurrency: parseInt(process.env.AUDIO_WORKER_CONCURRENCY ?? '5', 10),
}));
