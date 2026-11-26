export const MAX_VIDEO_SIZE_BYTES = 10 * 1024 ** 3; // 10 GiB
export const UPLOAD_PART_SIZE_BYTES = 64 * 1024 ** 2; // 64 MiB -> 160 partes para 10 GiB
export const MAX_PARTS_PER_SIGN_REQUEST = 100;
export const MAX_PART_NUMBER = 10000; // limite do S3

export const VIDEO_PROCESSING_QUEUE = 'video-processing';
export const VIDEO_PROCESSING_JOB = 'process';
export const VIDEO_PROCESSING_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
} as const;

export const PUBLIC_ID_LENGTH = 11;
export const PUBLIC_ID_PATTERN = /^[A-Za-z0-9]{11}$/;
export const PUBLIC_ID_MAX_ATTEMPTS = 5;

export const VIDEO_TITLE_MAX_LENGTH = 100;
export const FAILURE_REASON_MAX_LENGTH = 500;

export const VIDEO_KEYS = {
  original: (videoId: string) => `${videoId}/original`,
  thumbnail: (videoId: string) => `${videoId}/thumbnail.jpg`,
} as const;
