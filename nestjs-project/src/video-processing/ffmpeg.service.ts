import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { parseFfprobeOutput, type ProbeResult } from './ffprobe-metadata';

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 60_000;
const THUMBNAIL_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Chama ffprobe/ffmpeg com execFile (sem shell). A entrada pode ser um caminho
 * ou uma URL pré-assinada: os binários fazem range requests e não baixam o
 * arquivo inteiro.
 */
@Injectable()
export class FfmpegService {
  async probe(input: string): Promise<ProbeResult> {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(
        'ffprobe',
        [
          '-v',
          'error',
          '-print_format',
          'json',
          '-show_format',
          '-show_streams',
          input,
        ],
        { timeout: PROBE_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      ));
    } catch (err) {
      // ffprobe sai com erro quando o conteúdo não é mídia reconhecível
      if (isInvalidDataError(err)) {
        throw new UnrecoverableError('Input is not a readable video');
      }
      throw err;
    }
    return parseFfprobeOutput(stdout);
  }

  async extractThumbnail(input: string, atSeconds: number): Promise<Buffer> {
    const output = join(tmpdir(), `thumb-${randomUUID()}.jpg`);
    try {
      await execFileAsync(
        'ffmpeg',
        [
          '-v',
          'error',
          '-ss',
          atSeconds.toFixed(3),
          '-i',
          input,
          '-frames:v',
          '1',
          '-q:v',
          '2',
          '-f',
          'image2',
          '-y',
          output,
        ],
        { timeout: THUMBNAIL_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      );
      return await readFile(output);
    } finally {
      await rm(output, { force: true });
    }
  }
}

function isInvalidDataError(err: unknown): boolean {
  const e = err as { stderr?: string; killed?: boolean };
  return (
    !e.killed &&
    typeof e.stderr === 'string' &&
    /Invalid data found|could not find codec parameters|moov atom not found/i.test(
      e.stderr,
    )
  );
}
