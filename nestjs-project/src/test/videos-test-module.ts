import { randomBytes } from 'node:crypto';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { createTestDataSource } from './create-test-data-source';

export const ALL_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
];

type ModuleImport = Type<any> | DynamicModule | ForwardReference;

/**
 * Módulo de teste com DB, MinIO e Redis reais do compose.
 * Os testes rodam dentro do container, então as URLs "públicas" são assinadas
 * com o endpoint interno para o fetch alcançar o minio.
 */
export async function createVideosTestingModule(
  imports: ModuleImport[],
): Promise<TestingModule> {
  process.env.STORAGE_PUBLIC_ENDPOINT = process.env.STORAGE_ENDPOINT;

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [storageConfig, queueConfig],
      }),
      TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
      BullModule.forRootAsync({
        inject: [queueConfig.KEY],
        useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
          connection: { host: cfg.host, port: cfg.port },
        }),
      }),
      ...imports,
    ],
  }).compile();

  await module.init();
  return module;
}

export async function createUserWithChannel(
  dataSource: DataSource,
): Promise<{ user: User; channel: Channel }> {
  const tag = randomBytes(4).toString('hex');
  const user = await dataSource.getRepository(User).save({
    email: `video_${tag}@example.com`,
    password: 'hashed',
    is_confirmed: true,
  });
  const channel = await dataSource.getRepository(Channel).save({
    name: `canal_${tag}`,
    nickname: `canal_${tag}`,
    user_id: user.id,
  });
  return { user, channel };
}
