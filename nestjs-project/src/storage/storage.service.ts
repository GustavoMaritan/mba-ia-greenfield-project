import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import storageConfig from '../config/storage.config';
import {
  PRESIGNED_URL_TTL_SECONDS,
  S3_INTERNAL_CLIENT,
  S3_PUBLIC_CLIENT,
  StorageBucket,
} from './storage.constants';

export interface StoredPart {
  partNumber: number;
  etag: string;
  size: number;
}

export interface PresignGetOptions {
  downloadFilename?: string;
}

@Injectable()
export class StorageService implements OnModuleInit {
  constructor(
    @Inject(S3_INTERNAL_CLIENT) private readonly internalClient: S3Client,
    @Inject(S3_PUBLIC_CLIENT) private readonly publicClient: S3Client,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureBucket(this.config.videosBucket);
    await this.ensureBucket(this.config.thumbnailsBucket);
  }

  bucketName(bucket: StorageBucket): string {
    return bucket === StorageBucket.Videos
      ? this.config.videosBucket
      : this.config.thumbnailsBucket;
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const result = await this.internalClient.send(
      new CreateMultipartUploadCommand({
        Bucket: this.config.videosBucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!result.UploadId) {
      throw new Error(`Storage did not return an UploadId for ${key}`);
    }
    return result.UploadId;
  }

  async presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new UploadPartCommand({
        Bucket: this.config.videosBucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: PRESIGNED_URL_TTL_SECONDS },
    );
  }

  async listParts(key: string, uploadId: string): Promise<StoredPart[]> {
    const parts: StoredPart[] = [];
    let marker: string | undefined;

    for (;;) {
      const page = await this.internalClient.send(
        new ListPartsCommand({
          Bucket: this.config.videosBucket,
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );
      for (const part of page.Parts ?? []) {
        parts.push({
          partNumber: part.PartNumber ?? 0,
          etag: part.ETag ?? '',
          size: part.Size ?? 0,
        });
      }
      if (!page.IsTruncated) break;
      marker = page.NextPartNumberMarker;
    }

    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: Pick<StoredPart, 'partNumber' | 'etag'>[],
  ): Promise<void> {
    await this.internalClient.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.config.videosBucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
  }

  async putObject(
    bucket: StorageBucket,
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.internalClient.send(
      new PutObjectCommand({
        Bucket: this.bucketName(bucket),
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  // URL para o worker (ffprobe/ffmpeg) ler o original pela rede do compose
  async presignInternalGet(
    bucket: StorageBucket,
    key: string,
  ): Promise<string> {
    return getSignedUrl(
      this.internalClient,
      new GetObjectCommand({ Bucket: this.bucketName(bucket), Key: key }),
      { expiresIn: PRESIGNED_URL_TTL_SECONDS },
    );
  }

  async presignPublicGet(
    bucket: StorageBucket,
    key: string,
    options: PresignGetOptions = {},
  ): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: this.bucketName(bucket),
        Key: key,
        ResponseContentDisposition: options.downloadFilename
          ? attachmentDisposition(options.downloadFilename)
          : undefined,
      }),
      { expiresIn: PRESIGNED_URL_TTL_SECONDS },
    );
  }

  private async ensureBucket(name: string): Promise<void> {
    try {
      await this.internalClient.send(new HeadBucketCommand({ Bucket: name }));
      return;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }

    try {
      await this.internalClient.send(new CreateBucketCommand({ Bucket: name }));
    } catch (err) {
      // api e worker sobem juntos; o outro pode ter criado no meio do caminho
      if (
        err instanceof S3ServiceException &&
        (err.name === 'BucketAlreadyOwnedByYou' ||
          err.name === 'BucketAlreadyExists')
      ) {
        return;
      }
      throw err;
    }
  }
}

function isNotFound(err: unknown): boolean {
  return (
    err instanceof S3ServiceException &&
    (err.name === 'NotFound' ||
      err.name === 'NoSuchBucket' ||
      err.$metadata?.httpStatusCode === 404)
  );
}

// RFC 6266: filename ASCII de fallback + filename* em UTF-8
export function attachmentDisposition(filename: string): string {
  const fallback = filename
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback || 'video'}"; filename*=UTF-8''${encoded}`;
}
