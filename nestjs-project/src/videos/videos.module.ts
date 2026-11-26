import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsModule } from '../channels/channels.module';
import { StorageModule } from '../storage/storage.module';
import { ChannelVideosController } from './channel-videos.controller';
import { Video } from './entities/video.entity';
import { VideosService } from './videos.service';

@Module({
  imports: [TypeOrmModule.forFeature([Video]), ChannelsModule, StorageModule],
  controllers: [ChannelVideosController],
  providers: [VideosService],
})
export class VideosModule {}
