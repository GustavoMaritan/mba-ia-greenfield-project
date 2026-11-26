import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_VIDEO_SIZE_BYTES } from '../videos.constants';

export class InitiateVideoUploadDto {
  /** Original file name, used as default title and in the download name. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename: string;

  /** Video MIME type, e.g. `video/mp4`. */
  @Matches(/^video\/[a-z0-9.+-]+$/, {
    message: 'content_type must be a video MIME type',
  })
  content_type: string;

  /** File size in bytes (max 10 GiB). */
  @IsInt()
  @Min(1)
  @Max(MAX_VIDEO_SIZE_BYTES)
  size_bytes: number;

  /** Optional title; defaults to the file name without extension. */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  title?: string;
}
