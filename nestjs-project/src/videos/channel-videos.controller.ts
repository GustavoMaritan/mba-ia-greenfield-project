import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { InitiateVideoUploadDto } from './dto/initiate-video-upload.dto';
import { InitiateVideoUploadResponseDto } from './dto/initiate-video-upload-response.dto';
import {
  VideoOwnerResponseDto,
  toVideoOwnerResponse,
} from './dto/video-owner-response.dto';
import { VideosService } from './videos.service';

const errorSchema = { $ref: getSchemaPath(ApiErrorEnvelope) };

@ApiTags('videos')
@ApiBearerAuth('access-token')
@SkipThrottle()
@Controller('channels/me/videos')
export class ChannelVideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @ApiOperation({
    summary: 'Start a video upload',
    description:
      'Pre-registers the video as a draft in the caller channel and opens a multipart upload in storage. The file itself is sent straight to storage through presigned part URLs.',
  })
  @ApiBody({ type: InitiateVideoUploadDto })
  @ApiResponse({
    status: 201,
    description: 'Draft created and upload opened',
    type: InitiateVideoUploadResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed (e.g. size above 10 GiB or non-video type)',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: errorSchema,
  })
  async initiate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateVideoUploadDto,
  ): Promise<InitiateVideoUploadResponseDto> {
    const { video, upload } = await this.videosService.initiateUpload(
      user.sub,
      dto,
    );
    return { ...toVideoOwnerResponse(video), upload };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one of my videos',
    description:
      'Returns a video of the caller channel in any status (draft, processing, ready or failed).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: VideoOwnerResponseDto })
  @ApiResponse({
    status: 400,
    description: 'id is not a valid UUID',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found in the caller channel',
    schema: errorSchema,
  })
  async findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VideoOwnerResponseDto> {
    return toVideoOwnerResponse(
      await this.videosService.findOwnedVideo(user.sub, id),
    );
  }
}
