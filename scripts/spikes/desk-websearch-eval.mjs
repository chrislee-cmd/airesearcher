// Spike (card 584) — 데스크 "웹 기사 레인" A/B 러너: 자체 크롤러 vs Claude 서버측 web_search.
//
// 목적: 데스크 리서치의 **웹 기사 레인**(뉴스·블로그·웹검색 크롤+요약)을,
// Anthropic 서버측 `web_search_20260209` + `web_fetch_20260209`(동적 필터링 —
// Claude 가 검색결과를 컨텍스트 도달 전에 코드로 필터, 인용 포함)로 대체/보강할 수
// 있는지 나란히 실측한다. 통계·공시 레인(DART/KOSIS/World Bank/SEC)은 범위 밖.
//
// 현행 레인은 **기존 lib 재사용(복제 금지)** — src/lib/desk-sources/*.ts 의 실제
// 소스 어댑터를 desk-lib-loader.mjs(의존성 0 ESM 훅) + env-shim.ts 로 그대로
// import 해 호출한다. tier 부여도 실제 classifyTier(desk-source-tiers.ts). 데스크
// job/DB/크레딧 경로는 타지 않는다(read-only, 크레딧 차감 없음).
//
// Claude 레인은 Anthropic Messages API 를 raw fetch 로 호출(스파이크 zero-dep
// 제약 — @anthropic-ai/sdk 도입 안 함; 형제 스파이크 stt-eval.ts / ut-video-eval.mjs
// 와 동일 관례). 모델 claude-sonnet-4-6(현행 데스크와 동일 — 비용 공정성).
//
// 실행(이 로더 배선은 러너의 SSOT — README 대신 여기 주석 참조):
//   node --experimental-strip-types \
//     --import 'data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; register("./scripts/spikes/desk-lib-loader.mjs", pathToFileURL("./"));' \
//     --env-file-if-exists=.env.local \
//     scripts/spikes/desk-websearch-eval.mjs [옵션]
//   (편의: `bash scripts/spikes/desk-websearch-eval.sh [옵션]` 래퍼)
//
// 옵션:
//   --keywords "a,b,c"   비교 키워드(기본: 국내 3 한국어 + 글로벌 2 영어).
//   --limit N            현행 레인 소스당 최대 기사 수(기본 8).
//   --only current|claude  한쪽만 실행(기본 둘 다).
//   --check              설정만 출력(API·크롤 호출 0 — 비용 0).
//   --out DIR            JSON 덤프 디렉토리(기본 scripts/spikes/out, gitignored).
//
// 키: .env.local — ANTHROPIC_API_KEY, TAVILY_API_KEY, NAVER_CLIENT_ID/SECRET,
//     KAKAO_REST_API_KEY. 없는 키의 소스는 조용히 [] 로 degrade(현행 동작 동일).

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// ── 현행 데스크 웹 기사 레인 = 실제 프로덕션 소스 어댑터(복제 아님) ──────────────
import { naverNews } from '@/lib/desk-sources/naver-news';
import { naverBlog } from '@/lib/desk-sources/naver-blog';
import { naverCafe } from '@/lib/desk-sources/naver-cafe';
import { kakaoWeb } from '@/lib/desk-sources/kakao-web';
import { kakaoBlog } from '@/lib/desk-sources/kakao-blog';
import { kakaoCafe } from '@/lib/desk-sources/kakao-cafe';
import { googleNews } from '@/lib/desk-sources/google-news';
import { gdeltNews } from '@/lib/desk-sources/gdelt-news';
import { webSearch } from '@/lib/desk-sources/web-search';
import { classifyTier } from '@/lib/desk-source-tiers';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6'; // 현행 데스크와 동일(스펙 §방법 2)

// 웹 기사 레인 소스 세트. 한국어 쿼리는 국내 포털·커뮤니티 + 웹서치, 글로벌은
// 구글뉴스(US)·GDELT·웹서치. (통계·공시 소스는 범위 밖이라 미포함.)
const LANE_KR = [naverNews, naverBlog, naverCafe, kakaoWeb, kakaoBlog, kakaoCafe, googleNews, webSearch];
const LANE_GLOBAL = [googleNews, gdeltNews, webSearch];

// 기본 키워드 — 실제 데스크 사용 패턴(국내 시장/트렌드 3 한국어 + 글로벌 2 영어).
// 키워드 자체는 PII 아님(일반 시장 주제).
const DEFAULT_KEYWORDS = [
  '실버 산업 시장 동향',      // 국내(고령친화 산업)
  '가정간편식 HMR 트렌드',    // 국내(소비재)
  '전기차 충전 인프라',        // 국내(모빌리티)
  'AI agent enterprise adoption', // 글로벌
  'GLP-1 weight loss market',      // 글로벌
];

const HANGUL = /[가-힣]/;
const isKorean = (s) => HANGUL.test(s);

// 국내 소스 커버리지 판정(스펙의 핵심 리스크). host 가 .kr TLD 이거나 대표 국내
// 포털/커뮤니티/블로그 도메인이면 한국어 소스로 센다.
const KR_HOST_HINTS = ['naver.com', 'daum.net', 'kakao.com', 'tistory.com', 'brunch.co.kr', 'velog.io'];
function hostOf(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.startsWith('www.') ? h.slice(4) : h;
  } catch {
    return '';
  }
}
function isKoreanSource(url) {
  const h = hostOf(url);
  if (!h) return false;
  if (h.endsWith('.kr')) return true;
  return KR_HOST_HINTS.some((d) => h === d || h.endsWith(`.${d}`));
}

function parseArgs(argv) {
  const a = { limit: '8', out: 'scripts/spikes/out' };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--check') { a.check = true; continue; }
    if (k.startsWith('--')) { a[k.slice(2)] = argv[++i]; }
  }
  return a;
}

// 소스 fetch 는 bare array 또는 {articles,error} 를 돌려준다(DeskFetchResult). 정규화.
function toArticles(res) {
  if (Array.isArray(res)) return { articles: res, error: undefined };
  return { articles: res?.articles ?? [], error: res?.error };
}

// crawlSourceWithTimeout(desk-crawl.ts, CRAWL_TASK_TIMEOUT_MS=15s)의 타임아웃
// 시맨틱을 이 스파이크 범위에서 재현. fetch 로직 자체는 실제 소스 어댑터.
function raceTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((resolve) => {
    t = setTimeout(() => resolve({ articles: [], error: 'fetch_failed', _timeout: label }), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// dedupeArticles(desk-crawl.ts)와 동일 규칙: url(없으면 source|title) 키로 dedupe +
// 생존분에 classifyTier(실제 함수) 부여.
function dedupeArticles(articles) {
  const seen = new Set();
  const out = [];
  for (const art of articles) {
    const key = art.url || `${art.source}|${art.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...art, tier: classifyTier(art.url) });
  }
  return out;
}

async function runCurrentLane(keyword, limit) {
  const region = isKorean(keyword) ? 'KR' : 'US';
  const lane = region === 'KR' ? LANE_KR : LANE_GLOBAL;
  const t0 = Date.now();
  const perSource = {};
  const collected = [];
  await Promise.all(
    lane.map(async (def) => {
      const res = await raceTimeout(
        Promise.resolve()
          .then(() => def.fetch({ keyword, region, range: {}, limit }))
          .then(toArticles)
          .catch((e) => ({ articles: [], error: 'fetch_failed', _err: String(e).slice(0, 120) })),
        15_000,
        def.id,
      );
      const { articles, error } = toArticles(res);
      perSource[def.id] = { count: articles.length, error: error ?? null };
      collected.push(...articles);
    }),
  );
  const deduped = dedupeArticles(collected);
  const tiers = { T1: 0, T2: 0, T3: 0, unknown: 0 };
  let koreanCount = 0;
  for (const a of deduped) {
    tiers[a.tier ?? 'unknown']++;
    if (isKoreanSource(a.url)) koreanCount++;
  }
  return {
    region,
    elapsedSec: +((Date.now() - t0) / 1000).toFixed(1),
    total: deduped.length,
    tiers,
    koreanCount,
    perSource,
    sample: deduped.slice(0, 8).map((a) => ({ source: a.source, tier: a.tier, url: a.url, title: a.title })),
  };
}

// ── Claude 서버측 web_search + web_fetch(동적 필터링) 레인 ──────────────────────
function buildSystem(keyword) {
  const koHint = isKorean(keyword)
    ? '이 쿼리는 한국어입니다. **국내(한국) 시장 소스와 한국어 기사를 우선**하세요(네이버/다음 블로그·카페·국내 언론 포함). '
    : 'Prioritize recent, credible sources; include trade/industry coverage. ';
  return `You are a market/desk researcher. Use web_search (and web_fetch when a source needs verification) to gather recent, credible articles about the given topic. ${koHint}Then write a concise briefing of 5-8 bullet points, each grounded in a source you actually found, with inline citations. End with a "Sources" list. Do not fabricate URLs — cite only what the tools returned.`;
}

// 응답 content 에서 소스를 수집한다. `web_search_20260209`(동적 필터링)는 검색이
// code_execution 을 거쳐 실행돼 결과가 `web_search_tool_result` 블록으로 온다
// (url/title/page_age). **이 모드에선 모델 text 에 inline citation 이 붙지 않는다**
// (실측 — 인용 검증 게이트는 tool_result URL 을 읽어야 함). 따라서:
//   - results:   web_search_tool_result 의 실제 URL(= 현행 레인의 기사 목록과 비교군)
//   - citations: text 블록의 inline citation(있으면; 이 모드선 보통 0 — nuance)
function extractFromContent(content) {
  const results = [];
  const citations = [];
  let searchRequests = 0;
  let text = '';
  for (const block of content ?? []) {
    if (block.type === 'text') {
      text += block.text ?? '';
      for (const c of block.citations ?? []) {
        if (c.url) citations.push({ url: c.url, title: c.title });
      }
    } else if (block.type === 'server_tool_use' && block.name === 'web_search') {
      searchRequests++;
    } else if (block.type === 'web_search_tool_result') {
      const items = Array.isArray(block.content) ? block.content : [];
      for (const it of items) {
        if (it?.type === 'web_search_result' && it.url) {
          results.push({ url: it.url, title: it.title, page_age: it.page_age });
        }
      }
    }
  }
  return { results, citations, searchRequests, text };
}

// 한 번의 Messages 요청을 **스트리밍(SSE)** 으로 호출한다. 서버측 web_search 는
// 단일 non-streaming 요청이 수 분 걸려 undici HeadersTimeout(~300s)에 걸린다 —
// claude-api 스킬 권고대로 스트리밍하면 TTFB 가 빨라 타임아웃이 없다. SSE 를
// 파싱해 content 블록/usage/stop_reason 을 재조립한다.
async function postAnthropicStream(body, apiKey) {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error?.message || JSON.stringify(j).slice(0, 300); } catch { /* */ }
    return { error: msg };
  }
  const blocks = [];
  let usageIn = 0, usageOut = 0, searchRequests = 0, stopReason = null;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const handle = (payload) => {
    let ev;
    try { ev = JSON.parse(payload); } catch { return; }
    switch (ev.type) {
      case 'message_start':
        usageIn = ev.message?.usage?.input_tokens ?? usageIn;
        break;
      case 'content_block_start': {
        const b = { ...ev.content_block };
        if (b.type === 'text') { b.text = b.text ?? ''; b.citations = b.citations ?? []; }
        blocks[ev.index] = b;
        break;
      }
      case 'content_block_delta': {
        const b = blocks[ev.index];
        if (!b) break;
        if (ev.delta?.type === 'text_delta') b.text = (b.text ?? '') + ev.delta.text;
        else if (ev.delta?.type === 'citations_delta' && ev.delta.citation) (b.citations ??= []).push(ev.delta.citation);
        break;
      }
      case 'message_delta':
        stopReason = ev.delta?.stop_reason ?? stopReason;
        if (ev.usage?.input_tokens) usageIn = ev.usage.input_tokens; // 서버툴 최종 누적치
        usageOut += ev.usage?.output_tokens ?? 0;
        searchRequests += ev.usage?.server_tool_use?.web_search_requests ?? 0;
        break;
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload && payload !== '[DONE]') handle(payload);
      }
    }
  }
  return { content: blocks.filter(Boolean), usageIn, usageOut, searchRequests, stopReason };
}

async function runClaudeLane(keyword, apiKey) {
  const t0 = Date.now();
  const tools = [
    { type: 'web_search_20260209', name: 'web_search' },
    { type: 'web_fetch_20260209', name: 'web_fetch' },
  ];
  const messages = [{ role: 'user', content: `Research topic: ${keyword}` }];
  let usageIn = 0, usageOut = 0, searchRequests = 0;
  const results = [];
  const inlineCitations = [];
  let text = '';
  let stopReason = null;

  // 서버측 도구 루프: pause_turn 이면 assistant content 를 다시 실어 재요청(최대 8회).
  for (let hop = 0; hop < 8; hop++) {
    const data = await postAnthropicStream(
      { model: MODEL, max_tokens: 6000, system: buildSystem(keyword), tools, messages },
      apiKey,
    );
    if (data.error) {
      return { error: data.error, elapsedSec: +((Date.now() - t0) / 1000).toFixed(1) };
    }
    usageIn += data.usageIn ?? 0;
    usageOut += data.usageOut ?? 0;
    searchRequests += data.searchRequests ?? 0;
    const ex = extractFromContent(data.content);
    results.push(...ex.results);
    inlineCitations.push(...(ex.citations ?? []));
    text += ex.text;
    stopReason = data.stopReason;
    if (data.stopReason === 'pause_turn') {
      messages.push({ role: 'assistant', content: data.content });
      continue;
    }
    break;
  }

  // 검색으로 실제 회수된 소스 URL(= 현행 레인 기사 목록과 비교군) dedupe + tier/국내 집계.
  const seen = new Set();
  const sources = [];
  for (const r of results) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    sources.push({ ...r, tier: classifyTier(r.url), korean: isKoreanSource(r.url) });
  }
  const tiers = { T1: 0, T2: 0, T3: 0, unknown: 0 };
  let koreanCount = 0;
  for (const s of sources) {
    tiers[s.tier]++;
    if (s.korean) koreanCount++;
  }
  // web search 요금(공개): $10 / 1,000 검색. 토큰: sonnet 4.6 $3/$15 per MTok.
  // (동적 필터링의 code_execution 은 web_search 동반 시 무료 — claude-api 스킬.)
  const searchCost = (searchRequests / 1000) * 10;
  const tokenCost = (usageIn * 3 + usageOut * 15) / 1e6;
  return {
    elapsedSec: +((Date.now() - t0) / 1000).toFixed(1),
    stopReason,
    searchRequests,
    total: sources.length,
    inlineCitationCount: inlineCitations.length, // 동적 필터링 모드선 보통 0(nuance)
    tiers,
    koreanCount,
    usage: { input_tokens: usageIn, output_tokens: usageOut },
    costUsd: +(searchCost + tokenCost).toFixed(4),
    sources,
    briefing: text.slice(0, 1400),
  };
}

function printCurrent(kw, r) {
  console.log(`\n── [현행 크롤러] ${kw}  (region ${r.region}, ${r.elapsedSec}s) ──`);
  console.log(`  총 ${r.total}건 | tier T1 ${r.tiers.T1}·T2 ${r.tiers.T2}·T3 ${r.tiers.T3}·? ${r.tiers.unknown} | 국내소스 ${r.koreanCount}`);
  console.log('  소스별:', Object.entries(r.perSource).map(([s, v]) => `${s}=${v.count}${v.error ? `(${v.error})` : ''}`).join(' '));
}
function printClaude(kw, r) {
  console.log(`\n── [Claude web_search] ${kw}  (${r.elapsedSec ?? '?'}s) ──`);
  if (r.error) { console.log('  ⚠ 오류:', r.error); return; }
  console.log(`  회수 소스 ${r.total}건 | tier T1 ${r.tiers.T1}·T2 ${r.tiers.T2}·T3 ${r.tiers.T3}·? ${r.tiers.unknown} | 국내소스 ${r.koreanCount} | inline인용 ${r.inlineCitationCount}`);
  console.log(`  web_search ${r.searchRequests}회 | 토큰 in${r.usage.input_tokens}/out${r.usage.output_tokens} | 비용≈$${r.costUsd} | stop=${r.stopReason}`);
  r.sources.slice(0, 6).forEach((c, i) => console.log(`    [${i + 1}] ${c.tier}${c.korean ? '·KR' : ''}  ${c.url}`));
}

async function main() {
  const a = parseArgs(process.argv);
  const keywords = (a.keywords ? a.keywords.split(',') : DEFAULT_KEYWORDS).map((s) => s.trim()).filter(Boolean);
  const limit = parseInt(a.limit, 10) || 8;
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  const only = a.only; // 'current' | 'claude' | undefined

  if (a.check) {
    console.log('데스크 웹 기사 레인 A/B 스파이크 — 설정(호출 없음, 비용 0):');
    console.log('  모델:', MODEL);
    console.log('  KR 레인:', LANE_KR.map((d) => d.id).join(', '));
    console.log('  글로벌 레인:', LANE_GLOBAL.map((d) => d.id).join(', '));
    console.log('  키워드:', keywords.join(' | '));
    console.log('  키 존재:', {
      ANTHROPIC: !!apiKey, TAVILY: !!process.env.TAVILY_API_KEY,
      NAVER: !!process.env.NAVER_CLIENT_ID, KAKAO: !!process.env.KAKAO_REST_API_KEY,
    });
    return;
  }

  if (only !== 'current' && !apiKey) {
    console.error('ERROR: ANTHROPIC_API_KEY 없음(.env.local). Claude 레인 실행 불가 — --only current 로 현행만 돌리거나 키 제공.');
    if (only === 'claude') process.exit(1);
  }

  const runs = [];
  for (const kw of keywords) {
    const entry = { keyword: kw, korean_query: isKorean(kw) };
    if (only !== 'claude') { entry.current = await runCurrentLane(kw, limit); printCurrent(kw, entry.current); }
    if (only !== 'current' && apiKey) { entry.claude = await runClaudeLane(kw, apiKey); printClaude(kw, entry.claude); }
    runs.push(entry);
  }

  await mkdir(a.out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = join(a.out, `desk-websearch-eval-${stamp}.json`);
  await writeFile(outPath, JSON.stringify({ model: MODEL, keywords, limit, runs }, null, 2));
  console.log(`\n덤프 저장: ${outPath}`);

  // 인용 실존 검증(스펙 §방법 3 게이트) 대상 안내 — 링크 ≥5 를 보고서 §인용검증에 기록.
  const allSources = runs.flatMap((r) => r.claude?.sources ?? []);
  if (allSources.length) {
    console.log(`\n인용 실존 검증 후보(${allSources.length}) — 상위 8개 URL(HTTP 검증):`);
    allSources.slice(0, 8).forEach((c, i) => console.log(`  [${i + 1}] ${c.url}`));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
