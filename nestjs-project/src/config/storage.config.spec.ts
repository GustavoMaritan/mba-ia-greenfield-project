import storageConfig from './storage.config';

const STORAGE_KEYS = [
  'STORAGE_ENDPOINT',
  'STORAGE_PUBLIC_ENDPOINT',
  'STORAGE_REGION',
  'STORAGE_ACCESS_KEY',
  'STORAGE_SECRET_KEY',
  'STORAGE_VIDEOS_BUCKET',
  'STORAGE_THUMBNAILS_BUCKET',
];

describe('storageConfig', () => {
  const original = { ...process.env };

  beforeEach(() => {
    STORAGE_KEYS.forEach((key) => delete process.env[key]);
  });

  afterAll(() => {
    process.env = original;
  });

  it('should apply defaults when env vars are missing', () => {
    expect(storageConfig()).toEqual({
      endpoint: 'http://minio:9000',
      publicEndpoint: 'http://localhost:9000',
      region: 'us-east-1',
      accessKey: '',
      secretKey: '',
      videosBucket: 'videos',
      thumbnailsBucket: 'thumbnails',
    });
  });

  it('should read every value from env', () => {
    process.env.STORAGE_ENDPOINT = 'http://storage:9000';
    process.env.STORAGE_PUBLIC_ENDPOINT = 'http://localhost:9100';
    process.env.STORAGE_REGION = 'sa-east-1';
    process.env.STORAGE_ACCESS_KEY = 'key';
    process.env.STORAGE_SECRET_KEY = 'secret';
    process.env.STORAGE_VIDEOS_BUCKET = 'v';
    process.env.STORAGE_THUMBNAILS_BUCKET = 't';

    expect(storageConfig()).toEqual({
      endpoint: 'http://storage:9000',
      publicEndpoint: 'http://localhost:9100',
      region: 'sa-east-1',
      accessKey: 'key',
      secretKey: 'secret',
      videosBucket: 'v',
      thumbnailsBucket: 't',
    });
  });
});
