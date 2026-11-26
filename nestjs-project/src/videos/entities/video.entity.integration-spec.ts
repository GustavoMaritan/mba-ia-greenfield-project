import { randomUUID } from 'node:crypto';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let counter = 0;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  async function createChannel(): Promise<Channel> {
    const n = ++counter;
    const user = await userRepository.save(
      userRepository.create({
        email: `video_owner_${n}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `owner${n}`,
        nickname: `owner${n}`,
        user_id: user.id,
      }),
    );
  }

  function buildVideo(channelId: string, overrides: Partial<Video> = {}) {
    const id = randomUUID();
    return videoRepository.create({
      id,
      channel_id: channelId,
      public_id: `pub${String(++counter).padStart(8, '0')}`,
      title: 'aula',
      original_filename: 'aula.mp4',
      content_type: 'video/mp4',
      size_bytes: 1024,
      video_key: `${id}/original`,
      upload_id: 'upload-id',
      ...overrides,
    });
  }

  it('should default status to draft and keep processing fields null', async () => {
    const channel = await createChannel();

    const saved = await videoRepository.save(buildVideo(channel.id));
    const found = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(found.status).toBe(VideoStatus.Draft);
    expect(found.thumbnail_key).toBeNull();
    expect(found.duration_seconds).toBeNull();
    expect(found.metadata).toBeNull();
    expect(found.failure_reason).toBeNull();
    expect(found.processed_at).toBeNull();
  });

  it('should accept a null upload_id', async () => {
    const channel = await createChannel();

    const saved = await videoRepository.save(
      buildVideo(channel.id, { upload_id: null }),
    );

    expect(
      (await videoRepository.findOneByOrFail({ id: saved.id })).upload_id,
    ).toBeNull();
  });

  it('should reject a duplicated public_id', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      buildVideo(channel.id, { public_id: 'AAAAAAAAAAA' }),
    );

    await expect(
      videoRepository.save(
        buildVideo(channel.id, { public_id: 'AAAAAAAAAAA' }),
      ),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
  });

  it('should reject a status outside the enum', async () => {
    const channel = await createChannel();
    const video = buildVideo(channel.id);

    await expect(
      dataSource.query(
        `INSERT INTO "videos" ("id", "channel_id", "public_id", "title", "original_filename", "content_type", "size_bytes", "video_key", "status")
         VALUES ($1, $2, 'BBBBBBBBBBB', 't', 'f.mp4', 'video/mp4', 1, 'k', 'published')`,
        [video.id, channel.id],
      ),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('should read size_bytes above 2^32 back as a number', async () => {
    const channel = await createChannel();
    const tenGiB = 10 * 1024 ** 3;

    const saved = await videoRepository.save(
      buildVideo(channel.id, { size_bytes: tenGiB }),
    );
    const found = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(found.size_bytes).toBe(10737418240);
    expect(typeof found.size_bytes).toBe('number');
  });

  it('should persist duration and metadata', async () => {
    const channel = await createChannel();
    const metadata = {
      width: 320,
      height: 240,
      videoCodec: 'h264',
      audioCodec: null,
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      bitRate: 123456,
      frameRate: 25,
      sizeBytes: 1024,
    };

    const saved = await videoRepository.save(
      buildVideo(channel.id, { duration_seconds: 3.021, metadata }),
    );
    const found = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(found.duration_seconds).toBe(3.021);
    expect(found.metadata).toEqual(metadata);
  });

  it('should delete videos when the channel is deleted', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(buildVideo(channel.id));

    await channelRepository.delete({ id: channel.id });

    expect(await videoRepository.findOneBy({ id: saved.id })).toBeNull();
  });
});
