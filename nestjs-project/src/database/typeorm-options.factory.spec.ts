import { typeOrmOptionsFactory } from './typeorm-options.factory';

describe('typeOrmOptionsFactory', () => {
  it('should map the database config to postgres options without synchronize', () => {
    expect(
      typeOrmOptionsFactory({
        host: 'db',
        port: 5432,
        username: 'u',
        password: 'p',
        name: 'streamtube',
      }),
    ).toEqual({
      type: 'postgres',
      host: 'db',
      port: 5432,
      username: 'u',
      password: 'p',
      database: 'streamtube',
      autoLoadEntities: true,
      synchronize: false,
    });
  });
});
