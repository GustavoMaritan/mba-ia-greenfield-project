import { Test, TestingModule } from '@nestjs/testing';
import { ModulesContainer } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AuthModule } from './auth/auth.module';
import { VideoProcessingProcessor } from './video-processing/video-processing.processor';
import { WorkerModule } from './worker.module';

describe('WorkerModule', () => {
  let module: TestingModule;

  beforeAll(async () => {
    // compile() sem init(): não sobe o Worker do BullMQ
    module = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
  });

  afterAll(async () => {
    await module.close();
  });

  it('should build the entity metadata (Video -> Channel -> User)', () => {
    const dataSource = module.get(DataSource);

    expect(dataSource.isInitialized).toBe(true);
    expect(dataSource.hasMetadata('Video')).toBe(true);
    expect(dataSource.hasMetadata('User')).toBe(true);
  });

  it('should resolve the video processor', () => {
    expect(
      module.get(VideoProcessingProcessor, { strict: false }),
    ).toBeInstanceOf(VideoProcessingProcessor);
  });

  it('should not declare controllers nor load the auth stack', () => {
    const controllers = Reflect.getMetadata('controllers', WorkerModule) as
      | unknown[]
      | undefined;
    const loaded = [...module.get(ModulesContainer).values()].map(
      (m) => m.metatype,
    );

    expect(controllers ?? []).toHaveLength(0);
    expect(loaded).not.toContain(AuthModule);
  });
});
