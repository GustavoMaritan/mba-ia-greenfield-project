import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { S3Client } from '@aws-sdk/client-s3';
import storageConfig from '../config/storage.config';
import { S3_INTERNAL_CLIENT, S3_PUBLIC_CLIENT } from './storage.constants';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

describe('StorageModule', () => {
  it('should compile with storageConfig and expose both S3 clients', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [storageConfig],
        }),
        StorageModule,
      ],
    }).compile();

    expect(module.get(StorageService)).toBeInstanceOf(StorageService);
    expect(module.get(S3_INTERNAL_CLIENT)).toBeInstanceOf(S3Client);
    expect(module.get(S3_PUBLIC_CLIENT)).toBeInstanceOf(S3Client);
    expect(module.get(S3_INTERNAL_CLIENT)).not.toBe(
      module.get(S3_PUBLIC_CLIENT),
    );
  });
});
