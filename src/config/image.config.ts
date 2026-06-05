import { registerAs } from '@nestjs/config';

// Image generation for vocabulary senses: search Pexels by the lemma, mirror the
// top photo to Cloudinary. Reuses the same Cloudinary account as audio (one set
// of credentials) but a separate folder so assets stay organised.
export default registerAs('image', () => ({
  pexelsApiKey: process.env.PEXELS_API_KEY ?? '',
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
    folder: process.env.CLOUDINARY_IMAGE_FOLDER ?? 'vocab-images',
  },
  // Jobs processed in parallel by the image worker.
  workerConcurrency: parseInt(process.env.IMAGE_WORKER_CONCURRENCY ?? '3', 10),
}));
