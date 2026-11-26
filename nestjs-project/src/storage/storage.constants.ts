export enum StorageBucket {
  Videos = 'videos',
  Thumbnails = 'thumbnails',
}

export const S3_INTERNAL_CLIENT = Symbol('S3_INTERNAL_CLIENT');
export const S3_PUBLIC_CLIENT = Symbol('S3_PUBLIC_CLIENT');

// o presigner usa 900s por padrão; aqui sempre passamos 1h explicitamente
export const PRESIGNED_URL_TTL_SECONDS = 3600;
