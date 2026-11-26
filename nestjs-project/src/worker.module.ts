import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { bullRootOptionsFactory } from './config/bull-root.options';
import { configModuleOptions } from './config/config-module.options';
import databaseConfig from './config/database.config';
import queueConfig from './config/queue.config';
import { typeOrmOptionsFactory } from './database/typeorm-options.factory';
import { UsersModule } from './users/users.module';
import { VideoProcessingModule } from './video-processing/video-processing.module';

// contexto do container video-worker: sem HTTP, sem auth, só consome a fila
@Module({
  imports: [
    ConfigModule.forRoot(configModuleOptions),
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: typeOrmOptionsFactory,
    }),
    BullModule.forRootAsync({
      inject: [queueConfig.KEY],
      useFactory: bullRootOptionsFactory,
    }),
    // registra a entidade User: Video -> Channel -> User precisa estar no metadata
    UsersModule,
    VideoProcessingModule,
  ],
})
export class WorkerModule {}
