import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from './entities/video.entity';
import { generatePublicId } from './public-id.util';
import {
  MAX_PARTS_PER_SIGN_REQUEST,
  PUBLIC_ID_MAX_ATTEMPTS,
  UPLOAD_PART_SIZE_BYTES,
  VIDEO_KEYS,
  VIDEO_TITLE_MAX_LENGTH,
} from './videos.constants';
import { VideoNotFoundException } from './videos.exceptions';

export interface InitiateUploadInput {
  filename: string;
  content_type: string;
  size_bytes: number;
  title?: string;
}

export interface UploadPlan {
  part_size_bytes: number;
  part_count: number;
  max_parts_per_request: number;
}

export interface InitiatedUpload {
  video: Video;
  upload: UploadPlan;
}

const PG_UNIQUE_VIOLATION = '23505';

function isPublicIdCollision(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const driverError = err.driverError as { code?: string; detail?: string };
  return (
    driverError?.code === PG_UNIQUE_VIOLATION &&
    typeof driverError.detail === 'string' &&
    driverError.detail.includes('public_id')
  );
}

export function partCountFor(sizeBytes: number): number {
  return Math.ceil(sizeBytes / UPLOAD_PART_SIZE_BYTES);
}

export function defaultTitle(filename: string): string {
  const base = filename.slice(0, filename.length - extname(filename).length);
  return (base || filename).slice(0, VIDEO_TITLE_MAX_LENGTH);
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
  ) {}

  async initiateUpload(
    userId: string,
    input: InitiateUploadInput,
  ): Promise<InitiatedUpload> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) throw new VideoNotFoundException();

    // id gerado antes do insert para montar a chave do objeto
    const id = randomUUID();
    const videoKey = VIDEO_KEYS.original(id);
    const uploadId = await this.storageService.createMultipartUpload(
      videoKey,
      input.content_type,
    );

    const video = await this.insertWithUniquePublicId({
      id,
      channel_id: channel.id,
      title: input.title ?? defaultTitle(input.filename),
      original_filename: input.filename,
      content_type: input.content_type,
      size_bytes: input.size_bytes,
      status: VideoStatus.Draft,
      upload_id: uploadId,
      video_key: videoKey,
    });

    return {
      video,
      upload: {
        part_size_bytes: UPLOAD_PART_SIZE_BYTES,
        part_count: partCountFor(input.size_bytes),
        max_parts_per_request: MAX_PARTS_PER_SIGN_REQUEST,
      },
    };
  }

  async findOwnedVideo(userId: string, id: string): Promise<Video> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) throw new VideoNotFoundException();

    const video = await this.videoRepository.findOne({
      where: { id, channel_id: channel.id },
    });
    // vídeo de outro canal responde igual a inexistente
    if (!video) throw new VideoNotFoundException();
    return video;
  }

  private async insertWithUniquePublicId(data: Partial<Video>): Promise<Video> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.videoRepository.save(
          this.videoRepository.create({
            ...data,
            public_id: generatePublicId(),
          }),
        );
      } catch (err) {
        if (!isPublicIdCollision(err) || attempt >= PUBLIC_ID_MAX_ATTEMPTS) {
          throw err;
        }
      }
    }
  }
}
