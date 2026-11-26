import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './app.module';
import { VideoProcessingProcessor } from './video-processing/video-processing.processor';
import { VideoProcessingProducer } from './videos/video-processing.producer';

describe('AppModule', () => {
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  });

  afterAll(async () => {
    await module.close();
  });

  it('should publish jobs but never consume them', () => {
    expect(
      module.get(VideoProcessingProducer, { strict: false }),
    ).toBeInstanceOf(VideoProcessingProducer);
    expect(() =>
      module.get(VideoProcessingProcessor, { strict: false }),
    ).toThrow();
  });
});
