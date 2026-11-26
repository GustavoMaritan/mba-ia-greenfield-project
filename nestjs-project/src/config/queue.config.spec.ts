import queueConfig from './queue.config';

describe('queueConfig', () => {
  const original = { ...process.env };

  beforeEach(() => {
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
  });

  afterAll(() => {
    process.env = original;
  });

  it('should default to the compose redis service', () => {
    expect(queueConfig()).toEqual({ host: 'redis', port: 6379 });
  });

  it('should read host and port from env', () => {
    process.env.REDIS_HOST = 'queue';
    process.env.REDIS_PORT = '6380';

    expect(queueConfig()).toEqual({ host: 'queue', port: 6380 });
  });
});
