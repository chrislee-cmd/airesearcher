// AI 동시통역 — server-side audio transcoding.
//
// `MediaRecorder` on Chrome desktop only produces `audio/webm;codecs=opus`
// (hard browser constraint). The user wants `.m4a` (AAC in MP4). We
// transcode webm → m4a on demand at download time using the static
// ffmpeg binary shipped via `@ffmpeg-installer/ffmpeg`.
//
// On-demand (instead of at PATCH finalize) was chosen so the ~35 MB
// ffmpeg binary only loads when a host actually requests the m4a — the
// vast majority of sessions probably stop at txt/docx, and the upload
// finalize path stays unchanged. The trade-off: the user waits a few
// seconds at download time. For typical sessions (<30 min, <20 MB
// webm) this is acceptable.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const FFMPEG_PATH = ffmpegInstaller.path;

/**
 * Transcode a webm/Opus blob to an m4a (AAC) blob.
 *
 * Output goes through a real file (not pipe:1) so ffmpeg can honor
 * `+faststart` — the prior pipe-only pipeline forced
 * `+frag_keyframe+empty_moov` to land a streamable header, but that
 * fragmented-MP4 layout was rejected by some desktop players
 * (downloaded .m4a wouldn't open in QuickTime / Finder preview),
 * producing the "재생 안 됨" symptom the host reported.
 *
 * Throws on a non-zero exit code or unreadable output.
 */
export async function transcodeWebmToM4a(webm: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'translate-m4a-'));
  const outPath = join(dir, 'out.m4a');
  try {
    await new Promise<void>((resolve, reject) => {
      const args = [
        '-hide_banner',
        '-loglevel', 'error',
        '-i', 'pipe:0',
        '-vn',                          // strip any (unlikely) video stream
        '-c:a', 'aac',
        '-b:a', '128k',
        // Plain `+faststart`. ffmpeg writes the file linearly, then on
        // close it rewinds the seekable output and moves the moov atom
        // to the front. The result is a normal (non-fragmented) MP4
        // that every player accepts.
        '-movflags', '+faststart',
        '-f', 'ipod',                   // m4a container family (MP4 audio-only)
        '-y',                           // overwrite the temp file
        outPath,
      ];

      const proc = spawn(FFMPEG_PATH, args, {
        stdio: ['pipe', 'ignore', 'pipe'],
      });

      const stderrChunks: Buffer[] = [];
      proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      proc.on('error', (err) => {
        reject(new Error(`ffmpeg spawn failed: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          const stderr = Buffer.concat(stderrChunks).toString('utf8').slice(0, 2000);
          reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
          return;
        }
        resolve();
      });

      // Write the source bytes to stdin and close.
      proc.stdin.on('error', (err) => {
        // EPIPE here usually means ffmpeg already errored out — let the
        // 'close' handler surface the real reason via stderr.
        if ((err as NodeJS.ErrnoException).code !== 'EPIPE') {
          reject(err);
        }
      });
      proc.stdin.end(Buffer.from(webm));
    });

    const buf = await readFile(outPath);
    if (buf.length === 0) {
      throw new Error('ffmpeg produced empty output');
    }
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } finally {
    // Best-effort cleanup; the tmpdir is per-call so leftovers don't
    // collide on the next invocation either way.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
