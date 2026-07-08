import fs from 'node:fs';
import path from 'node:path';
import { ARTIFACTS_DIR, RESULTS_DIR, readEnv, type LoadedScript } from './lib/config';
import { relArtifact, writeReport, type SurfaceResult } from './lib/report';

// 실행 후 1회: surface별 결과 JSON + Playwright JSON 리포트(비디오/트레이스
// attachments) 를 합쳐 사람이 읽는 리포트(report.md/json)를 쓴다.
//
// ⚠️ 리포트 파일만 쓴다 — gh/git/PR 호출 0 (§D no-merge 게이트).

interface PwAttachment {
  name: string;
  path?: string;
  contentType?: string;
}
interface PwSpec {
  title: string;
  tests?: { results?: { attachments?: PwAttachment[] }[] }[];
}
interface PwSuite {
  specs?: PwSpec[];
  suites?: PwSuite[];
}

function collectSpecs(suite: PwSuite, out: PwSpec[]): void {
  for (const s of suite.specs ?? []) out.push(s);
  for (const nested of suite.suites ?? []) collectSpecs(nested, out);
}

/** 테스트 제목 → { video, trace } 상대경로 맵을 Playwright JSON 에서 뽑는다. */
function attachmentsByTitle(): Record<string, { video?: string; trace?: string }> {
  const p = path.join(ARTIFACTS_DIR, 'playwright-results.json');
  if (!fs.existsSync(p)) return {};
  let report: { suites?: PwSuite[] };
  try {
    report = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
  const specs: PwSpec[] = [];
  for (const suite of report.suites ?? []) collectSpecs(suite, specs);

  const map: Record<string, { video?: string; trace?: string }> = {};
  for (const spec of specs) {
    const atts = spec.tests?.flatMap((t) => t.results ?? []).flatMap((r) => r.attachments ?? []) ?? [];
    const video = atts.find((a) => a.name === 'video')?.path;
    const trace = atts.find((a) => a.name === 'trace')?.path;
    map[spec.title] = { video: relArtifact(video), trace: relArtifact(trace) };
  }
  return map;
}

function loadResolvedScript(): LoadedScript {
  const p = path.join(ARTIFACTS_DIR, 'resolved-script.json');
  if (!fs.existsSync(p)) return { surfaces: [], origin: '(resolved-script.json 없음)', unmapped: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8')) as LoadedScript;
}

function loadResults(): SurfaceResult[] {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8')) as SurfaceResult);
}

async function globalTeardown(): Promise<void> {
  const env = readEnv();
  const script = loadResolvedScript();
  const attachments = attachmentsByTitle();

  const results = loadResults()
    .map((r) => ({ ...r, ...attachments[r.name] }))
    // resolved-script 순서를 따라 정렬(리포트 순서를 관전 순서와 일치).
    .sort(
      (a, b) =>
        script.surfaces.findIndex((s) => s.name === a.name) -
        script.surfaces.findIndex((s) => s.name === b.name),
    );

  // 실행 시각은 스크립트 안에서 Date 를 못 쓰는 워크플로우 제약과 무관 —
  // 여기는 일반 Node 프로세스라 new Date() 사용 OK.
  const generatedAt = new Date().toISOString();
  const { md, json } = writeReport({ env, script, results, generatedAt });
  console.log(`[qa-harness] 리포트 생성: ${md}`);
  console.log(`[qa-harness] 리포트 JSON: ${json}`);
}

export default globalTeardown;
