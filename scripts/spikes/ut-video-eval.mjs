#!/usr/bin/env node
// Spike (card 583) — UT 영상 인사이트 대안 평가 러너.
//
// 목적: 현행 TwelveLabs 4단 파이프라인(인덱싱 → Marengo 순간탐색 → ffmpeg 클립
// → Pegasus 분석)을, **네이티브 Gemini 영상 이해 모델의 단일 호출**로 대체할 수
// 있는지 A/B 로 실측한다. 하나의 UT 세션 녹화(화면+음성)와 task_goal 을 받아,
// 지정한 각 Gemini 모델에게 "모먼트 목록(타임코드+사유) + 세션 인사이트 요약" 을
// 한 번의 generateContent 로 요청하고 결과를 나란히 덤프한다.
//
// 산출 스키마는 현행 파이프라인의 src/lib/ut/insight-llm.ts 를 **참조**해 동일
// 필드로 맞췄다(복제 아님 — 앱 코드를 import 하지 않는다). 대응:
//   planMoments()      → moments[]  {start/end (MM:SS + sec), theme, query, relevance}
//   synthesizeReport() → report     {overview, key_themes[], top_frictions[],
//                                     notable_quotes[], task_outcome}
// (insight-llm.ts 의 momentsSchema / reportSchema 와 1:1)
//
// 의존성 0 — Node 내장 fetch/fs 만 사용(스펙 "프로덕션 무변경: 의존성 0").
// Node ≥ 18 필요.
//
// 사용법:
//   node scripts/spikes/ut-video-eval.mjs --check
//       → 이 API 키에서 가용한 영상-이해 모델 목록만 출력(영상 업로드 없음, 비용 0).
//   node scripts/spikes/ut-video-eval.mjs \
//       --video ./mysession.mp4 \
//       --goal "결제 흐름에서 사용자가 막히는 지점 찾기" \
//       --locale ko \
//       --models gemini-3.6-flash,gemini-2.5-flash \
//       --resolution low
//
// 옵션:
//   --video PATH        분석할 UT 녹화(mp4/webm/mov 등). PII 규칙: 팀 자체 녹화만,
//                       프로덕션 사용자 녹음 금지. 결과·영상은 커밋 금지(.gitignore).
//   --goal TEXT         task_goal(분석 기준). 생략 시 일반 UT 분석.
//   --locale ko|en      산출 언어(기본 ko). insight-llm 의 langDirective 와 동형.
//   --models a,b,c      비교할 모델(기본 gemini-3.6-flash,gemini-2.5-flash).
//   --resolution low|default  media_resolution(기본 default). low = 토큰/비용 1/3,
//                       최대 영상 길이 3배(1M 컨텍스트 기준 3h). docs/spikes 표 참조.
//   --max-moments N     요청할 최대 모먼트 수(기본 6 — MAX_CLIPS 와 동일).
//   --out DIR           결과 JSON 덤프 디렉토리(기본 scripts/spikes/out, gitignored).
//
// 키: 환경변수 GEMINI_API_KEY, 없으면 저장소 루트/현재 .env.local 에서 로드.

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const UPLOAD = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

// ── 요금표 (2026-07, 실확인). 출처는 docs/spikes/ut-video-llm-eval-2026-07.md §비용.
//   USD / 1M tokens. audio 가 별도 요율이면 audioIn, 아니면 input 재사용.
//   영상 토큰: 기본 해상도 ~300 tok/s(프레임) + 오디오 ~32 tok/s / 저해상도 ~100 tok/s.
const RATES = {
  'gemini-2.5-flash': { input: 0.30, audioIn: 1.00, output: 2.50 },
  'gemini-3.5-flash': { input: 1.50, audioIn: 1.50, output: 9.00 },
  'gemini-3.6-flash': { input: 1.50, audioIn: 1.50, output: 9.00 }, // 3.5 계열 요율 가정(3.6 별도 고시 없으면)
  'gemini-2.5-pro': { input: 1.25, audioIn: 1.25, output: 10.0 },
  'gemini-3.1-pro-preview': { input: 2.00, audioIn: 2.00, output: 12.0 },
};

function parseArgs(argv) {
  const a = { models: 'gemini-3.6-flash,gemini-2.5-flash', locale: 'ko', resolution: 'default', 'max-moments': '6', out: 'scripts/spikes/out' };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--check') { a.check = true; continue; }
    if (k.startsWith('--')) { a[k.slice(2)] = argv[++i]; }
  }
  return a;
}

function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  for (const p of ['.env.local', '../repo/.env.local', '../.env.local']) {
    if (existsSync(p)) {
      const m = readFileSync(p, 'utf8').match(/^GEMINI_API_KEY=(.+)$/m);
      if (m) return m[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  console.error('ERROR: GEMINI_API_KEY 없음 (env 또는 .env.local). 스펙: /api 팝업으로 발급.');
  process.exit(1);
}

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

function langDirective(locale) {
  // insight-llm.ts 와 동형.
  return locale === 'en'
    ? 'Write all string values in English.'
    : 'Write all string values in Korean, using a polite, formal register.';
}

// ── 응답 스키마 (insight-llm.ts momentsSchema + reportSchema 참조, OpenAPI subset) ──
function responseSchema(maxMoments) {
  return {
    type: 'object',
    properties: {
      moments: {
        type: 'array',
        maxItems: maxMoments,
        items: {
          type: 'object',
          properties: {
            start: { type: 'string', description: 'MM:SS 시작 타임코드' },
            end: { type: 'string', description: 'MM:SS 종료 타임코드' },
            start_sec: { type: 'number' },
            end_sec: { type: 'number' },
            theme: { type: 'string', description: '짧은 라벨(예: 결제 버튼 혼란)' },
            query: { type: 'string', description: '그 순간의 화면/음성 1문장 묘사' },
            relevance: { type: 'number', description: '0..1 인사이트 가치' },
          },
          required: ['start', 'end', 'theme', 'query', 'relevance'],
        },
      },
      report: {
        type: 'object',
        properties: {
          overview: { type: 'string' },
          key_themes: {
            type: 'array',
            items: { type: 'object', properties: { theme: { type: 'string' }, detail: { type: 'string' } }, required: ['theme', 'detail'] },
          },
          top_frictions: {
            type: 'array',
            items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' }, moment_index: { type: 'integer' } }, required: ['title', 'detail'] },
          },
          notable_quotes: {
            type: 'array',
            items: { type: 'object', properties: { quote: { type: 'string' }, moment_index: { type: 'integer' } }, required: ['quote'] },
          },
          task_outcome: { type: 'string' },
        },
        required: ['overview', 'key_themes', 'top_frictions', 'notable_quotes', 'task_outcome'],
      },
    },
    required: ['moments', 'report'],
  };
}

function buildPrompt(goal, locale, maxMoments) {
  const goalLine = goal ? `Task goal (analysis context): ${goal}\n\n` : '';
  return `You are a UX researcher analyzing a usability test (UT) session recording (screen + audio).
${goalLine}Do BOTH of the following in one pass, using the video's visuals AND audio as evidence:

1) moments: pick up to ${maxMoments} moments richest in insight (confusion/hesitation, errors, key task steps, strong emotional reactions, important utterances). For each moment give start/end as MM:SS timecodes referring to the actual video timeline, plus start_sec/end_sec in seconds, a short theme label, a one-sentence description (query), and relevance 0..1. Keep moments non-overlapping and in time order.

2) report: synthesize a session insight report — overview (3-5 sentences), key_themes, top_frictions (each may reference a supporting moment by moment_index, 1-based), notable_quotes (verbatim, with moment_index), and task_outcome (success vs drop-off against the task goal, with evidence).

Observed facts only. Never copy sensitive data such as card numbers or passwords. ${langDirective(locale)}`;
}

async function j(res) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return { _raw: t, _status: res.status }; }
}

async function listModels(key) {
  const res = await fetch(`${API}/models?key=${key}&pageSize=200`);
  const data = await j(res);
  if (data.error) { console.error('API_ERROR:', data.error.message); process.exit(1); }
  return (data.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'));
}

// Gemini File API 리줌어블 업로드 → { uri, mimeType, name }
async function uploadVideo(key, path) {
  const bytes = await readFile(path);
  const size = bytes.byteLength;
  const ext = extname(path).toLowerCase();
  const mimeType = ext === '.webm' ? 'video/webm' : ext === '.mov' ? 'video/quicktime' : ext === '.mkv' ? 'video/x-matroska' : 'video/mp4';
  process.stderr.write(`  업로드 시작 ${basename(path)} (${(size / 1e6).toFixed(1)} MB, ${mimeType})…\n`);

  const startRes = await fetch(`${UPLOAD}?key=${key}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: basename(path) } }),
  });
  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) { console.error('업로드 URL 못 받음:', await startRes.text()); process.exit(1); }

  const putRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize', 'Content-Length': String(size) },
    body: bytes,
  });
  const info = await j(putRes);
  if (!info.file) { console.error('업로드 실패:', JSON.stringify(info).slice(0, 400)); process.exit(1); }
  let file = info.file;

  // ACTIVE 될 때까지 폴링(대용량 영상은 서버 처리 시간 필요).
  while (file.state === 'PROCESSING') {
    await new Promise((r) => setTimeout(r, 4000));
    process.stderr.write('  영상 처리 중…\n');
    file = await j(await fetch(`${API}/${file.name}?key=${key}`));
  }
  if (file.state !== 'ACTIVE') { console.error('영상 상태 비정상:', file.state, file.error); process.exit(1); }
  process.stderr.write('  업로드 완료(ACTIVE).\n');
  return { uri: file.uri, mimeType, name: file.name };
}

function estimateCost(model, usage) {
  const r = RATES[model];
  if (!r || !usage) return null;
  // usageMetadata.promptTokensDetails 로 modality 별 분해가 오면 정밀 계산, 아니면 근사.
  const details = usage.promptTokensDetails || [];
  let audioTok = 0, otherIn = 0;
  for (const d of details) {
    if (d.modality === 'AUDIO') audioTok += d.tokenCount || 0;
    else otherIn += d.tokenCount || 0;
  }
  if (!details.length) otherIn = usage.promptTokenCount || 0;
  const out = usage.candidatesTokenCount || 0;
  const usd = (otherIn * r.input + audioTok * r.audioIn + out * r.output) / 1e6;
  return { usd: +usd.toFixed(4), promptTokens: usage.promptTokenCount, audioTokens: audioTok, outputTokens: out };
}

async function analyze(key, model, file, goal, locale, resolution, maxMoments) {
  const genCfg = {
    responseMimeType: 'application/json',
    responseSchema: responseSchema(maxMoments),
    temperature: 0.2,
  };
  if (resolution === 'low') genCfg.mediaResolution = 'MEDIA_RESOLUTION_LOW';

  const body = {
    contents: [{ role: 'user', parts: [{ fileData: { fileUri: file.uri, mimeType: file.mimeType } }, { text: buildPrompt(goal, locale, maxMoments) }] }],
    generationConfig: genCfg,
  };

  const t0 = Date.now();
  const res = await fetch(`${API}/models/${model}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await j(res);
  const elapsedSec = +((Date.now() - t0) / 1000).toFixed(1);

  if (data.error) return { model, error: data.error.message, elapsedSec };
  const cand = data.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text).filter(Boolean).join('') ?? '';
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* 스키마 강제라 드묾; raw 보존 */ }
  return {
    model,
    elapsedSec,
    finishReason: cand?.finishReason,
    cost: estimateCost(model, data.usageMetadata),
    usage: data.usageMetadata,
    result: parsed,
    rawText: parsed ? undefined : text.slice(0, 2000),
  };
}

function printMoments(label, r) {
  console.log(`\n──── ${label} (${r.model}) ────`);
  if (r.error) { console.log('  ⚠ 오류:', r.error); return; }
  console.log(`  처리시간 ${r.elapsedSec}s | finish=${r.finishReason} | 비용≈$${r.cost?.usd ?? '?'} (prompt ${r.cost?.promptTokens ?? '?'} tok, out ${r.cost?.outputTokens ?? '?'} tok)`);
  const m = r.result?.moments ?? [];
  console.log(`  모먼트 ${m.length}개:`);
  m.forEach((x, i) => console.log(`    [${i + 1}] ${x.start}-${x.end}  (${(x.relevance ?? 0).toFixed(2)})  ${x.theme}\n         ${x.query}`));
  const rep = r.result?.report;
  if (rep) {
    console.log(`  개요: ${rep.overview}`);
    console.log(`  task_outcome: ${rep.task_outcome}`);
    console.log(`  frictions ${rep.top_frictions?.length ?? 0} · quotes ${rep.notable_quotes?.length ?? 0} · themes ${rep.key_themes?.length ?? 0}`);
  }
}

async function main() {
  const a = parseArgs(process.argv);
  const key = loadKey();

  if (a.check) {
    console.log('가용 영상-이해 후보 모델(generateContent 지원):\n');
    const models = await listModels(key);
    for (const m of models) {
      const id = m.name.replace('models/', '');
      if (!/flash|pro|omni/.test(id) || /image|tts|banana|lyria/.test(id)) continue;
      const rate = RATES[id] ? `  요율 in$${RATES[id].input}/out$${RATES[id].output}` : '';
      const gen = /omni/.test(id) ? '  ⚠ 영상 *생성* 모델(이해 부적합, docs §후보 참조)' : '';
      console.log(`  ${id}${rate}${gen}`);
    }
    console.log('\n(영상 업로드 없음 — 비용 0. 실 A/B 는 --video 로 실행.)');
    return;
  }

  if (!a.video) { console.error('ERROR: --video PATH 필요 (또는 --check). 사용법은 파일 상단 주석.'); process.exit(1); }
  const videoPath = resolve(a.video);
  if (!existsSync(videoPath)) { console.error('영상 파일 없음:', videoPath); process.exit(1); }
  const models = a.models.split(',').map((s) => s.trim()).filter(Boolean);
  const maxMoments = parseInt(a['max-moments'], 10) || 6;

  const info = await stat(videoPath);
  console.log(`영상: ${basename(videoPath)} (${(info.size / 1e6).toFixed(1)} MB) | goal: ${a.goal || '(없음)'} | locale: ${a.locale} | resolution: ${a.resolution}`);
  console.log(`모델: ${models.join(', ')}\n`);

  const file = await uploadVideo(key, videoPath);

  const runs = [];
  for (const model of models) {
    process.stderr.write(`분석 중: ${model}…\n`);
    const r = await analyze(key, model, file, a.goal || null, a.locale, a.resolution, maxMoments);
    runs.push(r);
    printMoments(model, r);
  }

  // 참고용 베이스라인 안내(현행 TwelveLabs 산출은 앱/DB 에 있음 — 나란히 비교는 수동).
  console.log('\n※ 베이스라인(현행 TwelveLabs 4단) 산출은 앱 세션에서 생성됨. 동일 영상의');
  console.log('  기존 insight_summary/ut_clips 와 위 결과를 docs 표에 나란히 기록하세요.');

  await mkdir(a.out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = join(a.out, `eval-${basename(videoPath, extname(videoPath))}-${stamp}.json`);
  await writeFile(outPath, JSON.stringify({ video: basename(videoPath), goal: a.goal, locale: a.locale, resolution: a.resolution, runs }, null, 2));
  console.log(`\n덤프 저장: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
