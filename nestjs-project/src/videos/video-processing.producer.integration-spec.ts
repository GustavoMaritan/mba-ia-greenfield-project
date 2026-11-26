import { randomUUID } from 'node:crypto';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import { VideoProcessingProducer } from './video-processing.producer';
import { VIDEO_PROCESSING_QUEUE } from './videos.constants';

describe('VideoProcessingProducer (integration)', () => {
  let module: TestingModule;
  let producer: VideoProcessingProducer;
  let queue: Queue;
  const created: string[] = [];

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        BullModule.forRootAsync({
          inject: [queueConfig.KEY],
          useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
            connection: { host: cfg.host, port: cfg.port },
          }),
        }),
        BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
      ],
      providers: [VideoProcessingProducer],
    }).compile();
    await module.init();

    producer = module.get(VideoProcessingProducer);
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  afterAll(async () => {
    for (const id of created) {
      const job = await queue.getJob(id);
      // job pode estar ativo se o video-worker estiver rodando; nesse caso só ignora
      await job?.remove().catch(() => undefined);
    }
    await module.close();
  });

  it('should add a "process" job keyed by the video id with retry options', async () => {
    const videoId = randomUUID();
    created.push(videoId);

    await producer.enqueue(videoId);

    const job = await queue.getJob(videoId);
    expect(job).toBeDefined();
    expect(job!.name).toBe('process');
    expect(job!.data).toEqual({ videoId });
    expect(job!.opts.attempts).toBe(3);
    expect(job!.opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
  });

  it('should not create a second job for the same video', async () => {
    const videoId = randomUUID();
    created.push(videoId);

    await producer.enqueue(videoId);
    const first = await queue.getJob(videoId);
    await producer.enqueue(videoId);
    const second = await queue.getJob(videoId);

    expect(second!.timestamp).toBe(first!.timestamp);
    const counts = await queue.getJobs();
    expect(counts.filter((j) => j?.data?.videoId === videoId)).toHaveLength(1);
  });
});
