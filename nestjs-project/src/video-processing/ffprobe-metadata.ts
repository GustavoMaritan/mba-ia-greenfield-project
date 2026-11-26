import { UnrecoverableError } from 'bullmq';
import type { VideoMetadata } from '../videos/entities/video.entity';

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
}

interface FfprobeFormat {
  duration?: string;
  format_name?: string;
  bit_rate?: string;
  size?: string;
}

export interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

export interface ProbeResult {
  durationSeconds: number;
  metadata: VideoMetadata;
}

// "30000/1001" -> 29.97; "0/0" -> 0
export function parseFrameRate(value: string | undefined): number {
  if (!value) return 0;
  const [num, den] = value.split('/').map(Number);
  if (!den || !Number.isFinite(num) || !Number.isFinite(den)) return 0;
  return Math.round((num / den) * 100) / 100;
}

function toNumber(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function parseFfprobeOutput(raw: string): ProbeResult {
  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(raw) as FfprobeOutput;
  } catch {
    throw new UnrecoverableError('ffprobe returned invalid JSON');
  }

  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  if (!video) {
    // arquivo sem trilha de vídeo: tentar de novo não resolve
    throw new UnrecoverableError('Input has no video stream');
  }
  const audio = streams.find((s) => s.codec_type === 'audio');
  const format = parsed.format ?? {};

  return {
    durationSeconds: toNumber(format.duration),
    metadata: {
      width: video.width ?? 0,
      height: video.height ?? 0,
      videoCodec: video.codec_name ?? 'unknown',
      audioCodec: audio?.codec_name ?? null,
      formatName: format.format_name ?? 'unknown',
      bitRate: toNumber(format.bit_rate),
      frameRate: parseFrameRate(video.avg_frame_rate),
      sizeBytes: toNumber(format.size),
    },
  };
}
