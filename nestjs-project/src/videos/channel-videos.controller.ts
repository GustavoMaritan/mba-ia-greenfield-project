import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { SignUploadPartsDto } from './dto/sign-upload-parts.dto';
import { SignedUploadPartsResponseDto } from './dto/signed-upload-parts-response.dto';
import { UploadCompletionResponseDto } from './dto/upload-completion-response.dto';
import { UploadedPartsResponseDto } from './dto/uploaded-parts-response.dto';
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

  @Post(':id/upload-parts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign upload parts',
    description:
      'Returns presigned URLs (valid for 1 hour) for the requested part numbers. The client PUTs each 64 MiB chunk straight to storage; no video bytes go through the API.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: SignUploadPartsDto })
  @ApiResponse({ status: 200, type: SignedUploadPartsResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or part number above the video part count',
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
  @ApiResponse({
    status: 409,
    description: 'Video is not a draft accepting uploads',
    schema: errorSchema,
  })
  async signUploadParts(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignUploadPartsDto,
  ): Promise<SignedUploadPartsResponseDto> {
    const signed = await this.videosService.signUploadParts(
      user.sub,
      id,
      dto.part_numbers,
    );
    return { parts: signed.parts, expires_at: signed.expires_at.toISOString() };
  }

  @Get(':id/upload-parts')
  @ApiOperation({
    summary: 'List uploaded parts',
    description:
      'Lists the parts already stored for the upload in progress, so an interrupted upload can resume from the missing parts.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: UploadedPartsResponseDto })
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
  @ApiResponse({
    status: 409,
    description: 'Video is not a draft accepting uploads',
    schema: errorSchema,
  })
  async listUploadedParts(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UploadedPartsResponseDto> {
    return { parts: await this.videosService.listUploadedParts(user.sub, id) };
  }

  @Post(':id/upload-completion')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Complete the upload',
    description:
      'Completes the multipart upload in storage, moves the video to processing and enqueues the processing job (metadata + thumbnail). Repeating the call while processing is harmless.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 202,
    description: 'Upload completed; processing enqueued',
    type: UploadCompletionResponseDto,
  })
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
  @ApiResponse({
    status: 409,
    description:
      'UPLOAD_INCOMPLETE (missing parts or size mismatch) or VIDEO_NOT_UPLOADABLE (already ready/failed)',
    schema: errorSchema,
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UploadCompletionResponseDto> {
    const video = await this.videosService.completeUpload(user.sub, id);
    return { id: video.id, public_id: video.public_id, status: video.status };
  }
}
