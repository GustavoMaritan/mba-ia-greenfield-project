import type { QueueOptions } from 'bullmq';
import type { ConfigType } from '@nestjs/config';
import queueConfig from './queue.config';

export function bullRootOptionsFactory(
  cfg: ConfigType<typeof queueConfig>,
): QueueOptions {
  return { connection: { host: cfg.host, port: cfg.port } };
}
