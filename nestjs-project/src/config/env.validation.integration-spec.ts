import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  STORAGE_ACCESS_KEY: 'storage-key',
  STORAGE_SECRET_KEY: 'storage-secret',
};

const validate = (env: Record<string, string>) =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const { error, value } = validate({}) as {
      error?: Error;
      value: Record<string, unknown>;
    };
    expect(error).toBeUndefined();
    expect(value.SWAGGER_ENABLED).toBe('false');
  });
});

describe('envValidationSchema — storage and queue', () => {
  it('should require STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY', () => {
    const { error } = envValidationSchema.validate(
      { ...requiredEnv, STORAGE_ACCESS_KEY: undefined, STORAGE_SECRET_KEY: '' },
      { allowUnknown: true, abortEarly: false },
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('STORAGE_ACCESS_KEY');
    expect(error!.message).toContain('STORAGE_SECRET_KEY');
  });

  it('should apply storage and queue defaults', () => {
    const { error, value } = validate({}) as {
      error?: Error;
      value: Record<string, unknown>;
    };
    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      STORAGE_ENDPOINT: 'http://minio:9000',
      STORAGE_PUBLIC_ENDPOINT: 'http://localhost:9000',
      STORAGE_REGION: 'us-east-1',
      STORAGE_VIDEOS_BUCKET: 'videos',
      STORAGE_THUMBNAILS_BUCKET: 'thumbnails',
      REDIS_HOST: 'redis',
      REDIS_PORT: 6379,
    });
  });

  it('should reject a STORAGE_PUBLIC_ENDPOINT that is not a URI', () => {
    const { error } = validate({ STORAGE_PUBLIC_ENDPOINT: 'not a uri' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('STORAGE_PUBLIC_ENDPOINT');
  });
});
