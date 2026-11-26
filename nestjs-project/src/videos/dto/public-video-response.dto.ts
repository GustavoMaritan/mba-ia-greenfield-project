import { ApiProperty } from '@nestjs/swagger';
import type { Video } from '../entities/video.entity';
import { VideoMetadataDto } from './video-owner-response.dto';

export class PublicVideoChannelDto {
  @ApiProperty({ example: 'maria' })
  nickname: string;

  @ApiProperty({ example: 'maria' })
  name: string;
}

export class PublicVideoResponseDto {
  @ApiProperty({ example: 'aZ3kP9qL0xB' })
  public_id: string;

  @ApiProperty({ example: 'aula-1' })
  title: string;

  @ApiProperty({ example: 3.021 })
  duration_seconds: number;

  @ApiProperty({ type: VideoMetadataDto })
  metadata: VideoMetadataDto;

  @ApiProperty({ type: PublicVideoChannelDto })
  channel: PublicVideoChannelDto;

  @ApiProperty({ example: '/videos/aZ3kP9qL0xB/stream' })
  stream_url: string;

  @ApiProperty({ example: '/videos/aZ3kP9qL0xB/download' })
  download_url: string;

  @ApiProperty({ example: '/videos/aZ3kP9qL0xB/thumbnail' })
  thumbnail_url: string;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  processed_at: string;
}

// só é chamado para vídeos prontos (duração, metadados e processed_at preenchidos)
export function toPublicVideoResponse(video: Video): PublicVideoResponseDto {
  const base = `/videos/${video.public_id}`;
  return {
    public_id: video.public_id,
    title: video.title,
    duration_seconds: video.duration_seconds ?? 0,
    metadata: video.metadata!,
    channel: { nickname: video.channel.nickname, name: video.channel.name },
    stream_url: `${base}/stream`,
    download_url: `${base}/download`,
    thumbnail_url: `${base}/thumbnail`,
    created_at: video.created_at.toISOString(),
    processed_at: (video.processed_at ?? video.updated_at).toISOString(),
  };
}
