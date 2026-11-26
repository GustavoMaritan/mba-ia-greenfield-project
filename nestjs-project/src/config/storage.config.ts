import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  // endpoint interno (rede do compose) para chamadas servidor -> storage
  endpoint: process.env.STORAGE_ENDPOINT || 'http://minio:9000',
  // endpoint visto pelo navegador; usado só para assinar URLs
  publicEndpoint:
    process.env.STORAGE_PUBLIC_ENDPOINT || 'http://localhost:9000',
  region: process.env.STORAGE_REGION || 'us-east-1',
  accessKey: process.env.STORAGE_ACCESS_KEY ?? '',
  secretKey: process.env.STORAGE_SECRET_KEY ?? '',
  videosBucket: process.env.STORAGE_VIDEOS_BUCKET || 'videos',
  thumbnailsBucket: process.env.STORAGE_THUMBNAILS_BUCKET || 'thumbnails',
}));
