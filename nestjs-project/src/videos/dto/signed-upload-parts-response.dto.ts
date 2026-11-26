import { ApiProperty } from '@nestjs/swagger';

export class SignedUploadPartDto {
  @ApiProperty({ example: 1 })
  part_number: number;

  @ApiProperty({
    description:
      'Presigned UploadPart URL on the public storage endpoint; PUT the part body to it',
    example:
      'http://localhost:9000/videos/0b1c.../original?partNumber=1&uploadId=...&X-Amz-Expires=3600',
  })
  url: string;
}

export class SignedUploadPartsResponseDto {
  @ApiProperty({ type: [SignedUploadPartDto] })
  parts: SignedUploadPartDto[];

  @ApiProperty({ format: 'date-time' })
  expires_at: string;
}
