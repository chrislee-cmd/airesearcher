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
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const FFMPEG_PATH = ffmpegInstaller.path;

/**
 * Transcode a webm/Opus blob to an m4a (AAC) blob.
 *
 * Spawns `ffmpeg` with pipe:0 → pipe:1, AAC LC at 128 kbps. The
 * `+faststart` flag moves the moov atom to the front of the file so
 * players can begin playback before the full download finishes.
 *
 * Throws on a non-zero exit code or unreadable stdout.
 */
export async function transcodeWebmToM4a(webm: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vn',                          // strip any (unlikely) video stream
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart+frag_keyframe+empty_moov',
      '-f', 'ipod',                   // m4a container family (MP4 audio-only)
      'pipe:1',
    ];

    const proc = spawn(FFMPEG_PATH, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
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
      const out = Buffer.concat(stdoutChunks);
      if (out.length === 0) {
        reject(new Error('ffmpeg produced empty output'));
        return;
      }
      resolve(new Uint8Array(out.buffer, out.byteOffset, out.byteLength));
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
}
