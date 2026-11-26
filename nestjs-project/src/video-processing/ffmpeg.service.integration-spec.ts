import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UnrecoverableError } from 'bullmq';
import { FfmpegService } from './ffmpeg.service';

// fixture gerada com:
// ffmpeg -f lavfi -i testsrc=duration=3:size=320x240:rate=25 \
//   -f lavfi -i sine=frequency=440:duration=3 -c:v libx264 -pix_fmt yuv420p \
//   -c:a aac -shortest -movflags +faststart test/fixtures/sample.mp4
const SAMPLE = join(__dirname, '..', '..', 'test', 'fixtures', 'sample.mp4');

describe('FfmpegService (integration)', () => {
  const service = new FfmpegService();
  let workDir: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'ffmpeg-spec-'));
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  describe('probe', () => {
    it('should extract duration and metadata from the fixture', async () => {
      const { durationSeconds, metadata } = await service.probe(SAMPLE);

      expect(durationSeconds).toBeGreaterThanOrEqual(2.9);
      expect(durationSeconds).toBeLessThanOrEqual(3.1);
      expect(metadata).toMatchObject({
        width: 320,
        height: 240,
        videoCodec: 'h264',
        audioCodec: 'aac',
        frameRate: 25,
      });
      expect(metadata.formatName).toContain('mp4');
      expect(metadata.sizeBytes).toBeGreaterThan(0);
    });

    it('should return audioCodec null for a video without audio', async () => {
      const silent = join(workDir, 'silent.mp4');
      execFileSync('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-i',
        SAMPLE,
        '-an',
        '-c:v',
        'copy',
        silent,
      ]);

      const { metadata } = await service.probe(silent);

      expect(metadata.audioCodec).toBeNull();
    });

    it('should throw UnrecoverableError for a text file', async () => {
      const text = join(workDir, 'notes.txt');
      writeFileSync(text, 'isto não é um vídeo\n'.repeat(50));

      await expect(service.probe(text)).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
    });

    it('should handle file names with spaces and quotes (no shell)', async () => {
      const odd = join(workDir, `aula "1" & teste.mp4`);
      copyFileSync(SAMPLE, odd);

      const { metadata } = await service.probe(odd);

      expect(metadata.width).toBe(320);
    });
  });

  describe('extractThumbnail', () => {
    it('should return a JPEG and leave no temp file behind', async () => {
      const before = readdirSync(tmpdir()).filter((f) =>
        f.startsWith('thumb-'),
      );

      const jpeg = await service.extractThumbnail(SAMPLE, 1);

      expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      const after = readdirSync(tmpdir()).filter((f) => f.startsWith('thumb-'));
      expect(after).toEqual(before);
    });
  });
});
