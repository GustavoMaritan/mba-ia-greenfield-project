import { ApiProperty } from '@nestjs/swagger';
import { VideoOwnerResponseDto } from './video-owner-response.dto';

export class UploadPlanDto {
  @ApiProperty({ example: 67108864 })
  part_size_bytes: number;

  @ApiProperty({ example: 160 })
  part_count: number;

  @ApiProperty({ example: 100 })
  max_parts_per_request: number;
}

export class InitiateVideoUploadResponseDto extends VideoOwnerResponseDto {
  @ApiProperty({ type: UploadPlanDto })
  upload: UploadPlanDto;
}
