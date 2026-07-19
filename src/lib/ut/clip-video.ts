// AI UT 인사이트 클립 (card 626) — server-side segment cutting with the static
// ffmpeg binary bundled via `@ffmpeg-installer/ffmpeg` (same binary the AI 동시
// 통역 m4a transcode uses, `lib/translate-audio.ts`). We re-encode short clips
// rather than stream-copy so the cut lands on the requested [start,end] instead
// of the nearest keyframe (spec §3 — "정확 컷 위해 짧은 클립은 re-encode 허용").
//
// Input is a temp file (the session recording downloaded once), so `-ss` before
// `-i` gives a fast, accurate seek per clip. Output goes through a real file so
// `+faststart` can move the moov atom to the front → the mp4 plays inline in the
// gallery <video> without a full download.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const FFMPEG_PATH = ffmpegInstaller.path;

/**
 * Cut [startMs, endMs) out of `inputPath` and return an mp4 (H.264/AAC) byte
 * array. Throws on a non-zero exit code or unreadable output.
 */
export async function clipSegment(
  inputPath: string,
  startMs: number,
  endMs: number,
): Promise<Uint8Array> {
  const startSec = Math.max(0, startMs / 1000);
  const durSec = Math.max(0.5, (endMs - startMs) / 1000);
  const dir = await mkdtemp(join(tmpdir(), 'ut-clip-'));
  const outPath = join(dir, 'clip.mp4');
  try {
    await new Promise<void>((resolve, reject) => {
      const args = [
        '-hide_banner',
        '-loglevel', 'error',
        // Seek BEFORE -i for a fast seek; re-encoding below makes the cut
        // frame-accurate regardless of keyframe placement.
        '-ss', startSec.toFixed(3),
        '-i', inputPath,
        '-t', durSec.toFixed(3),
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',      // broad player compatibility
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-f', 'mp4',
        '-y',
        outPath,
      ];
      const proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      const stderrChunks: Buffer[] = [];
      proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
      proc.on('error', (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)));
      proc.on('close', (code) => {
        if (code !== 0) {
          const stderr = Buffer.concat(stderrChunks).toString('utf8').slice(0, 2000);
          reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
          return;
        }
        resolve();
      });
    });

    const buf = await readFile(outPath);
    if (buf.length === 0) throw new Error('ffmpeg produced empty clip');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
