import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../entities/video.entity';

export class UploadCompletionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'aZ3kP9qL0xB' })
  public_id: string;

  @ApiProperty({ enum: VideoStatus, example: VideoStatus.Processing })
  status: VideoStatus;
}
