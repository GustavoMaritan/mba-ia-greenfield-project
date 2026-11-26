import { bullRootOptionsFactory } from './bull-root.options';

describe('bullRootOptionsFactory', () => {
  it('should build the redis connection from the queue config', () => {
    expect(bullRootOptionsFactory({ host: 'redis', port: 6379 })).toEqual({
      connection: { host: 'redis', port: 6379 },
    });
  });
});
