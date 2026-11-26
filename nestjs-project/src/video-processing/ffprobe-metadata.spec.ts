import { UnrecoverableError } from 'bullmq';
import { parseFfprobeOutput, parseFrameRate } from './ffprobe-metadata';

describe('parseFrameRate', () => {
  it.each([
    ['30000/1001', 29.97],
    ['25/1', 25],
    ['0/0', 0],
    [undefined, 0],
  ])('should parse %s as %d', (input, expected) => {
    expect(parseFrameRate(input)).toBe(expected);
  });
});

describe('parseFfprobeOutput', () => {
  const output = {
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        width: 1920,
        height: 1080,
        avg_frame_rate: '30000/1001',
      },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
    format: {
      duration: '12.345000',
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      bit_rate: '5000000',
      size: '7715625',
    },
  };

  it('should map format and streams to the persisted metadata', () => {
    expect(parseFfprobeOutput(JSON.stringify(output))).toEqual({
      durationSeconds: 12.345,
      metadata: {
        width: 1920,
        height: 1080,
        videoCodec: 'h264',
        audioCodec: 'aac',
        formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
        bitRate: 5000000,
        frameRate: 29.97,
        sizeBytes: 7715625,
      },
    });
  });

  it('should set audioCodec to null when there is no audio stream', () => {
    const noAudio = { ...output, streams: [output.streams[0]] };

    expect(
      parseFfprobeOutput(JSON.stringify(noAudio)).metadata.audioCodec,
    ).toBeNull();
  });

  it('should throw UnrecoverableError without a video stream', () => {
    const audioOnly = { ...output, streams: [output.streams[1]] };

    expect(() => parseFfprobeOutput(JSON.stringify(audioOnly))).toThrow(
      UnrecoverableError,
    );
  });

  it('should throw UnrecoverableError on invalid JSON', () => {
    expect(() => parseFfprobeOutput('not json')).toThrow(UnrecoverableError);
  });
});
