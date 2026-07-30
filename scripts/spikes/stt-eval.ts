// STT engine A/B eval harness — spike (pr-stt-engine-eval-spike, card 582).
//
// WHAT — runs a directory of audio samples through the current production
// engines (ElevenLabs Scribe v2 · Deepgram Nova-3) AND the OpenAI candidates
// (gpt-transcribe with/without keyword injection · gpt-4o-transcribe-diarize),
// dumps every transcript side-by-side, records wall-clock + a cost estimate,
// and — with --judge — asks a Claude judge to list concrete divergences
// (Korean 조사/전문용어/화자 전환). Read-only against prod: it never touches
// Supabase, the transcript_jobs table, or any app route. Output lands next to
// the samples, NOT in the repo (samples are PII-sensitive — never commit them).
//
// WHY it is self-contained (does NOT import src/lib/transcripts/*) — the repo
// runs ops scripts under `node --experimental-strip-types`, which resolves ESM
// specifiers with mandatory extensions. The app helpers
// (src/lib/transcripts/scribe.ts → './models', dispatch.ts → '@/env', …) use
// extensionless + alias imports that only Next's bundler resolves, so importing
// them here throws ERR_MODULE_NOT_FOUND (verified). Adding tsx/ts-node to make
// them importable would change dependencies — forbidden by the spike's
// "프로덕션 무변경 (의존성 변경 0)" constraint. So this mirrors the exact request
// shapes of the SSOT helpers instead, with citations. The SSOT for each engine's
// param set stays those files — keep this in sync if they change:
//   ElevenLabs : src/lib/transcripts/scribe.ts · dispatch.ts (dispatchElevenLabs)
//   Deepgram   : src/lib/transcripts/dispatch.ts (dispatchDeepgram)
//   OpenAI     : NEW — no prod helper exists (batch STT is Deepgram/Scribe only;
//                OpenAI is realtime-interpretation-only today, openai-realtime.ts)
//
// RUN:
//   node --experimental-strip-types --env-file-if-exists=.env.local \
//     scripts/spikes/stt-eval.ts <sampleDir> [options]
// OPTIONS:
//   --engines a,b,c      subset of: scribe,deepgram,gpt-transcribe,gpt-transcribe-kw,diarize
//                        (default: all)
//   --lang <code>        language hint (e.g. ko). Default: auto-detect.
//   --keywords "a,b,c"   domain terms for the gpt-transcribe-kw condition
//                        (isolates the keyword-injection effect vs the plain run).
//   --prompt "…"         optional prompt string for gpt-transcribe (biases style/terms).
//   --deepgram-model m   default nova-3.
//   --judge              run the Claude divergence judge on transcript pairs.
//   --judge-model m      default claude-haiku-4-5-20251001 (matches the prod post-pass).
//   --out <dir>          output dir. Default: <sampleDir>/_stt-eval-out.
//
// ENV (from .env.local): ELEVENLABS_API_KEY, DEEPGRAM_API_KEY, OPENAI_API_KEY,
//   ANTHROPIC_API_KEY (only for --judge).

import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, basename } from 'node:path';

// ── Pricing table — USD, verified against provider pages 2026-07-29. Sources are
// cited in docs/spikes/stt-engine-eval-2026-07.md §비용. Kept here so the cost
// column is reproducible; update alongside the report when rates move.
const RATE_PER_MIN_USD: Record<string, number> = {
  // ElevenLabs Scribe v2 batch STT: $0.22/hr (PAYG, post 2026-06-29 cut).
  scribe: 0.22 / 60,
  // Deepgram Nova-3 monolingual pre-recorded: $0.0077/min.
  deepgram: 0.0077,
  // OpenAI gpt-transcribe: token-billed ($2.50/1M in, $10/1M out); ~$0.006/min
  // is OpenAI's published per-minute estimate for the gpt-4o-transcribe family.
  'gpt-transcribe': 0.006,
  'gpt-transcribe-kw': 0.006,
  // gpt-4o-transcribe-diarize: same token basis, diarized_json output tokens
  // push effective per-minute a touch higher; use the family estimate as a floor.
  diarize: 0.006,
};

const OPENAI_MAX_BYTES = 25 * 1024 * 1024; // hard 25 MB file cap on the audio API.
const AUDIO_EXTS = new Set(['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm']);
const ALL_ENGINES = ['scribe', 'deepgram', 'gpt-transcribe', 'gpt-transcribe-kw', 'diarize'] as const;
type Engine = (typeof ALL_ENGINES)[number];

type EngineResult = {
  engine: Engine;
  ok: boolean;
  ms: number;
  transcript: string;
  durationSec: number | null;
  error?: string;
};

// ── tiny arg parser ────────────────────────────────────────────────────────
function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        opts[key] = true;
      } else {
        opts[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, opts };
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case '.mp3':
    case '.mpga':
      return 'audio/mpeg';
    case '.m4a':
    case '.mp4':
      return 'audio/mp4';
    case '.wav':
      return 'audio/wav';
    case '.webm':
      return 'audio/webm';
    case '.mpeg':
      return 'audio/mpeg';
    default:
      return 'application/octet-stream';
  }
}

// ── engine callers (mirror the SSOT helper param sets — see header) ──────────

// ElevenLabs Scribe v2. Mirrors scribe.ts (sync, no webhook) + dispatch.ts's
// diarize/timestamp/tag flags so the eval matches what prod actually sends.
async function runScribe(buf: Buffer, filename: string, lang: string | null): Promise<EngineResult> {
  const key = process.env.ELEVENLABS_API_KEY;
  const started = Date.now();
  if (!key) return { engine: 'scribe', ok: false, ms: 0, transcript: '', durationSec: null, error: 'missing ELEVENLABS_API_KEY' };
  const form = new FormData();
  form.append('model_id', 'scribe_v2'); // = ELEVENLABS_API_MODEL (src/lib/transcripts/models.ts)
  form.append('file', new Blob([new Uint8Array(buf)], { type: mimeForExt(extname(filename)) }), filename);
  form.append('diarize', 'true');
  form.append('timestamps_granularity', 'word');
  form.append('tag_audio_events', 'true');
  if (lang) form.append('language_code', lang);
  try {
    const resp = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: form,
    });
    const ms = Date.now() - started;
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return { engine: 'scribe', ok: false, ms, transcript: '', durationSec: null, error: `elevenlabs_${resp.status}: ${txt.slice(0, 200)}` };
    }
    const json = (await resp.json()) as {
      text?: string;
      words?: Array<{ text?: string; start?: number; end?: number; speaker_id?: string | number | null }>;
    };
    const words = json.words ?? [];
    const durationSec = words.length ? (words[words.length - 1].end ?? null) : null;
    const transcript = formatScribeTurns(json.text ?? '', words);
    return { engine: 'scribe', ok: true, ms, transcript, durationSec };
  } catch (e) {
    return { engine: 'scribe', ok: false, ms: Date.now() - started, transcript: '', durationSec: null, error: e instanceof Error ? e.message : 'fetch_failed' };
  }
}

// Group Scribe word list into `Speaker N: …` turns (approximates
// elevenlabsToMarkdown in src/lib/transcripts/elevenlabs.ts, minus timestamps).
function formatScribeTurns(
  fallbackText: string,
  words: Array<{ text?: string; speaker_id?: string | number | null }>,
): string {
  if (!words.length) return fallbackText.trim();
  const turns: string[] = [];
  let curSpeaker: string | null = null;
  let cur = '';
  for (const w of words) {
    const sp = w.speaker_id == null ? '0' : String(w.speaker_id);
    if (sp !== curSpeaker) {
      if (cur.trim()) turns.push(`Speaker ${curSpeaker}: ${cur.trim()}`);
      curSpeaker = sp;
      cur = '';
    }
    cur += w.text ?? '';
  }
  if (cur.trim()) turns.push(`Speaker ${curSpeaker}: ${cur.trim()}`);
  return turns.join('\n');
}

// Deepgram Nova-3. Mirrors dispatchDeepgram's query params (dispatch.ts) but in
// SYNC mode — no `callback`, so the POST returns the transcript inline (the eval
// has no webhook endpoint; prod uses the webhook only to survive the 60s budget).
async function runDeepgram(buf: Buffer, filename: string, lang: string | null, model: string): Promise<EngineResult> {
  const key = process.env.DEEPGRAM_API_KEY;
  const started = Date.now();
  if (!key) return { engine: 'deepgram', ok: false, ms: 0, transcript: '', durationSec: null, error: 'missing DEEPGRAM_API_KEY' };
  const qs = new URLSearchParams({
    model,
    language: lang ?? 'multi',
    diarize: 'true',
    punctuate: 'true',
    utterances: 'true',
    smart_format: 'true',
    paragraphs: 'true',
  });
  try {
    const resp = await fetch(`https://api.deepgram.com/v1/listen?${qs.toString()}`, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': mimeForExt(extname(filename)) },
      body: new Uint8Array(buf),
    });
    const ms = Date.now() - started;
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return { engine: 'deepgram', ok: false, ms, transcript: '', durationSec: null, error: `deepgram_${resp.status}: ${txt.slice(0, 200)}` };
    }
    const json = (await resp.json()) as {
      metadata?: { duration?: number };
      results?: {
        channels?: Array<{
          alternatives?: Array<{
            transcript?: string;
            paragraphs?: { transcript?: string };
          }>;
        }>;
      };
    };
    const alt = json.results?.channels?.[0]?.alternatives?.[0];
    const transcript = (alt?.paragraphs?.transcript ?? alt?.transcript ?? '').trim();
    return { engine: 'deepgram', ok: true, ms, transcript, durationSec: json.metadata?.duration ?? null };
  } catch (e) {
    return { engine: 'deepgram', ok: false, ms: Date.now() - started, transcript: '', durationSec: null, error: e instanceof Error ? e.message : 'fetch_failed' };
  }
}

// OpenAI batch transcription. NEW code — no prod helper exists.
//   gpt-transcribe          : supports prompt/keywords/languages (docs: File
//                             transcription). We run it plain and (with --keywords)
//                             biased, to isolate the keyword-injection effect.
//   gpt-4o-transcribe-diarize: speaker labels via response_format=diarized_json;
//                             does NOT support prompt/keywords (per docs).
async function runOpenAI(
  engine: Extract<Engine, 'gpt-transcribe' | 'gpt-transcribe-kw' | 'diarize'>,
  buf: Buffer,
  filename: string,
  opts: { lang: string | null; keywords: string | null; prompt: string | null },
): Promise<EngineResult> {
  const key = process.env.OPENAI_API_KEY;
  const started = Date.now();
  if (!key) return { engine, ok: false, ms: 0, transcript: '', durationSec: null, error: 'missing OPENAI_API_KEY' };
  if (buf.byteLength > OPENAI_MAX_BYTES) {
    return {
      engine,
      ok: false,
      ms: 0,
      transcript: '',
      durationSec: null,
      error: `file ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB exceeds OpenAI 25MB cap — real interviews need chunking (see report §한계)`,
    };
  }
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buf)], { type: mimeForExt(extname(filename)) }), filename);
  if (engine === 'diarize') {
    form.append('model', 'gpt-4o-transcribe-diarize');
    form.append('response_format', 'diarized_json');
  } else {
    form.append('model', 'gpt-transcribe');
    form.append('response_format', 'json');
    if (opts.lang) form.append('languages', opts.lang);
    if (opts.prompt) form.append('prompt', opts.prompt);
    if (engine === 'gpt-transcribe-kw' && opts.keywords) form.append('keywords', opts.keywords);
  }
  try {
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    const ms = Date.now() - started;
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return { engine, ok: false, ms, transcript: '', durationSec: null, error: `openai_${resp.status}: ${txt.slice(0, 240)}` };
    }
    const json = (await resp.json()) as {
      text?: string;
      duration?: number;
      segments?: Array<{ speaker?: string; text?: string }>;
    };
    let transcript: string;
    if (engine === 'diarize' && Array.isArray(json.segments)) {
      transcript = json.segments.map((s) => `Speaker ${s.speaker ?? '?'}: ${(s.text ?? '').trim()}`).join('\n');
    } else {
      transcript = (json.text ?? '').trim();
    }
    return { engine, ok: true, ms, transcript, durationSec: json.duration ?? null };
  } catch (e) {
    return { engine, ok: false, ms: Date.now() - started, transcript: '', durationSec: null, error: e instanceof Error ? e.message : 'fetch_failed' };
  }
}

// ── Claude divergence judge (reproducible prompt — also printed to the report) ─
const JUDGE_SYSTEM =
  'You compare two speech-to-text transcripts of the SAME audio. You cannot hear ' +
  'the audio, so judge only from internal evidence. List CONCRETE divergences ' +
  'where the two transcripts disagree, and for each, say which reading is more ' +
  'plausible and why. Focus on: (1) Korean 조사/어미 attachment errors, (2) domain/' +
  'proper-noun spelling variants, (3) speaker-turn boundary disagreements, (4) ' +
  'dropped/hallucinated spans. Return STRICT JSON: {"divergences":[{"kind":' +
  '"josa|term|speaker|dropped|other","a":"…","b":"…","likelier":"a|b|unclear",' +
  '"why":"…"}],"summary":"one line: which transcript looks cleaner overall"}.';

async function judgePair(
  model: string,
  fileLabel: string,
  aName: string,
  aText: string,
  bName: string,
  bText: string,
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return JSON.stringify({ error: 'missing ANTHROPIC_API_KEY' });
  const user = `File: ${fileLabel}\n\n=== Transcript A (${aName}) ===\n${aText.slice(0, 12000)}\n\n=== Transcript B (${bName}) ===\n${bText.slice(0, 12000)}`;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        system: JUDGE_SYSTEM,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!resp.ok) return JSON.stringify({ error: `anthropic_${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}` });
    const json = (await resp.json()) as { content?: Array<{ text?: string }> };
    return json.content?.[0]?.text ?? '{}';
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : 'judge_failed' });
  }
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const sampleDir = positional[0];
  if (!sampleDir) {
    console.error('Usage: node --experimental-strip-types --env-file-if-exists=.env.local scripts/spikes/stt-eval.ts <sampleDir> [--engines …] [--lang ko] [--keywords "a,b"] [--judge]');
    process.exit(1);
  }

  const engines: Engine[] = typeof opts.engines === 'string'
    ? (opts.engines.split(',').map((s) => s.trim()).filter((s): s is Engine => (ALL_ENGINES as readonly string[]).includes(s)))
    : [...ALL_ENGINES];
  const lang = typeof opts.lang === 'string' ? opts.lang : null;
  const keywords = typeof opts.keywords === 'string' ? opts.keywords : null;
  const prompt = typeof opts.prompt === 'string' ? opts.prompt : null;
  const dgModel = typeof opts['deepgram-model'] === 'string' ? (opts['deepgram-model'] as string) : 'nova-3';
  const judge = opts.judge === true;
  const judgeModel = typeof opts['judge-model'] === 'string' ? (opts['judge-model'] as string) : 'claude-haiku-4-5-20251001';
  const outDir = typeof opts.out === 'string' ? (opts.out as string) : join(sampleDir, '_stt-eval-out');

  if (keywords == null && engines.includes('gpt-transcribe-kw')) {
    console.warn('⚠️  gpt-transcribe-kw requested without --keywords — it will run identically to gpt-transcribe. Pass --keywords "term1,term2" to measure the injection effect.');
  }

  const entries = (await readdir(sampleDir)).filter((f) => AUDIO_EXTS.has(extname(f).toLowerCase())).sort();
  if (!entries.length) {
    console.error(`No audio files (${[...AUDIO_EXTS].join(', ')}) found in ${sampleDir}`);
    process.exit(1);
  }
  await mkdir(outDir, { recursive: true });

  console.log(`STT eval — ${entries.length} sample(s), engines: ${engines.join(', ')}${lang ? `, lang=${lang}` : ' (auto lang)'}`);
  console.log(`Output → ${outDir}\n`);

  type Row = { file: string; engine: Engine; ok: boolean; ms: number; durationSec: number | null; chars: number; costUsd: number | null; error?: string };
  const rows: Row[] = [];
  const perFileMd: string[] = [];

  for (const file of entries) {
    const buf = Buffer.from(await readFile(join(sampleDir, file)));
    console.log(`▶ ${file} (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB)`);
    const results: EngineResult[] = [];
    for (const engine of engines) {
      let r: EngineResult;
      if (engine === 'scribe') r = await runScribe(buf, file, lang);
      else if (engine === 'deepgram') r = await runDeepgram(buf, file, lang, dgModel);
      else r = await runOpenAI(engine, buf, file, { lang, keywords, prompt });
      results.push(r);
      const durationSec = r.durationSec;
      const rate = RATE_PER_MIN_USD[engine];
      const costUsd = durationSec != null && rate != null ? (durationSec / 60) * rate : null;
      rows.push({ file, engine, ok: r.ok, ms: r.ms, durationSec, chars: r.transcript.length, costUsd, error: r.error });
      console.log(`   ${r.ok ? '✓' : '✗'} ${engine.padEnd(20)} ${String(r.ms).padStart(6)}ms  ${r.ok ? `${r.transcript.length} chars` : r.error}`);
      await writeFile(join(outDir, `${basename(file, extname(file))}.${engine}.txt`), r.ok ? r.transcript : `ERROR: ${r.error}`, 'utf8');
    }

    // side-by-side markdown block for this file
    perFileMd.push(`## ${file}\n`);
    for (const r of results) {
      perFileMd.push(`### ${r.engine}${r.ok ? '' : ' — ERROR'}\n`);
      perFileMd.push('```\n' + (r.ok ? r.transcript.slice(0, 4000) : r.error) + '\n```\n');
    }

    // optional judge — compare current-prod baseline vs OpenAI candidate
    if (judge) {
      const baseline = results.find((r) => r.ok && (r.engine === 'scribe' || r.engine === 'deepgram'));
      const candidate = results.find((r) => r.ok && r.engine.startsWith('gpt'));
      if (baseline && candidate) {
        console.log(`   ⚖  judging ${baseline.engine} vs ${candidate.engine} …`);
        const verdict = await judgePair(judgeModel, file, baseline.engine, baseline.transcript, candidate.engine, candidate.transcript);
        await writeFile(join(outDir, `${basename(file, extname(file))}.judge.json`), verdict, 'utf8');
        perFileMd.push(`### judge (${baseline.engine} vs ${candidate.engine})\n`);
        perFileMd.push('```json\n' + verdict.slice(0, 4000) + '\n```\n');
      }
    }
    console.log('');
  }

  // ── summary tables ─────────────────────────────────────────────────────────
  const header = '| file | engine | ok | ms | duration(s) | chars | est. cost (USD) |\n|---|---|---|---|---|---|---|';
  const body = rows
    .map((r) => `| ${r.file} | ${r.engine} | ${r.ok ? '✓' : '✗'} | ${r.ms} | ${r.durationSec ?? '—'} | ${r.chars} | ${r.costUsd != null ? '$' + r.costUsd.toFixed(4) : '—'} |`)
    .join('\n');

  const summaryMd = [
    `# STT eval run — ${sampleDir}`,
    '',
    '> Generated by scripts/spikes/stt-eval.ts. Samples are NOT committed (PII).',
    `> Engines: ${engines.join(', ')}${lang ? ` · lang=${lang}` : ' · auto lang'}${keywords ? ` · keywords="${keywords}"` : ''}${judge ? ` · judge=${judgeModel}` : ''}`,
    '',
    '## Results',
    '',
    header,
    body,
    '',
    '## Cost basis (per-minute, USD — see docs/spikes/stt-engine-eval-2026-07.md §비용 for sources)',
    '',
    Object.entries(RATE_PER_MIN_USD).map(([k, v]) => `- ${k}: $${v.toFixed(5)}/min ($${(v * 60).toFixed(3)}/hr)`).join('\n'),
    '',
    '## Judge prompt (reproducibility)',
    '',
    '```',
    JUDGE_SYSTEM,
    '```',
    '',
    '## Transcripts (side by side)',
    '',
    perFileMd.join('\n'),
  ].join('\n');

  await writeFile(join(outDir, 'summary.md'), summaryMd, 'utf8');
  await writeFile(join(outDir, 'results.json'), JSON.stringify(rows, null, 2), 'utf8');

  console.log('── summary ──');
  console.log(header + '\n' + body);
  console.log(`\nWrote ${join(outDir, 'summary.md')} + results.json + per-engine .txt`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
