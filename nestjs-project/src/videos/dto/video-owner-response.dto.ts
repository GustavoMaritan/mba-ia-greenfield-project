import { ApiProperty } from '@nestjs/swagger';
import { Video, VideoStatus } from '../entities/video.entity';

export class VideoMetadataDto {
  @ApiProperty({ example: 1920 })
  width: number;

  @ApiProperty({ example: 1080 })
  height: number;

  @ApiProperty({ example: 'h264' })
  videoCodec: string;

  @ApiProperty({ example: 'aac', nullable: true, type: String })
  audioCodec: string | null;

  @ApiProperty({ example: 'mov,mp4,m4a,3gp,3g2,mj2' })
  formatName: string;

  @ApiProperty({ example: 5000000 })
  bitRate: number;

  @ApiProperty({ example: 29.97 })
  frameRate: number;

  @ApiProperty({ example: 1048576 })
  sizeBytes: number;
}

export class VideoOwnerResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'aZ3kP9qL0xB' })
  public_id: string;

  @ApiProperty({ example: 'aula-1' })
  title: string;

  @ApiProperty({ example: 'aula-1.mp4' })
  original_filename: string;

  @ApiProperty({ example: 'video/mp4' })
  content_type: string;

  @ApiProperty({ example: 1048576 })
  size_bytes: number;

  @ApiProperty({ enum: VideoStatus, example: VideoStatus.Draft })
  status: VideoStatus;

  @ApiProperty({ nullable: true, type: Number, example: null })
  duration_seconds: number | null;

  @ApiProperty({ nullable: true, type: VideoMetadataDto })
  metadata: VideoMetadataDto | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  failure_reason: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  processed_at: string | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;
}

export function toVideoOwnerResponse(video: Video): VideoOwnerResponseDto {
  return {
    id: video.id,
    public_id: video.public_id,
    title: video.title,
    original_filename: video.original_filename,
    content_type: video.content_type,
    size_bytes: video.size_bytes,
    status: video.status,
    duration_seconds: video.duration_seconds,
    metadata: video.metadata,
    failure_reason: video.failure_reason,
    processed_at: video.processed_at?.toISOString() ?? null,
    created_at: video.created_at.toISOString(),
    updated_at: video.updated_at.toISOString(),
  };
}
