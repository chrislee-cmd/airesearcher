#!/usr/bin/env node
// Codegen — /design "Recently Changed" 탭 데이터.
//
// 최근 N일(기본 30일) 안에 머지된 squash 커밋을 훑어, UI 파일(컴포넌트 /
// 라우트 화면 / globals.css)이 바뀐 것만 모아 PR#/머지일/한 줄 요약과 함께
// 뽑아낸다. #533(gen-ds-usage) 과 같은 패턴 — codegen 이 JSON 을 커밋하고
// Vercel 빌드/런타임은 JSON 만 읽는다. 빌드타임에 git 을 만지지 않으므로
// shallow-clone(Vercel 기본) 에서도 안전하다.
//
// 출력: src/app/[locale]/(app)/design-system/changed-ui.generated.json
//   { generatedAt, sinceDays, entries: [{ kind, name, file, line, prNumber,
//     mergedAt, oneLine, catalogKey }] }
//   - kind: 'component' | 'route' | 'style'
//   - catalogKey: 카탈로그 등록 프리미티브면 SectionId, 아니면 null
//     (등록분만 탭에서 라이브 렌더, 나머지는 링크만)
//
// 실행: pnpm gen:changed-ui  (생성된 JSON 커밋). 멱등 — 같은 git 이력이면 diff 0.
//   기간: SINCE_DAYS 환경변수로 조절 (기본 30).

import { execFileSync } from 'node:child_process';
import { readFileSync as readFile, writeFileSync as writeFile, existsSync as fileExists } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DS_DIR = join(SRC, 'app/[locale]/(app)/design-system');
const SECTIONS_FILE = join(DS_DIR, 'components/sections.tsx');
const OUT_FILE = join(DS_DIR, 'changed-ui.generated.json');

const SINCE_DAYS = Number(process.env.SINCE_DAYS || 30);

// gen-ds-usage.mjs 와 동일한 규칙 — component 섹션의 카탈로그 모듈 경로.
// convention 밖(canvas shell 등)만 명시, 나머지는 components/ui/<id>.
const FOUNDATION = new Set(['color', 'radius', 'font-size', 'z-index', 'motion']);
const MODULE_OVERRIDES = {
  'widget-fullview-modal': ['components/canvas/shell/widget-fullview-modal'],
  'canvas-widget-primitives': [
    'components/canvas/shell/field',
    'components/canvas/shell/banner',
    'components/canvas/shell/control-board',
    'components/canvas/shell/widget-subheader',
    'components/canvas/shell/widget-outputs',
  ],
};

// ── 1. SectionId union 파싱 → 파일(SRC 기준 상대, .tsx) → catalogKey 매핑
function buildCatalogMap() {
  const src = readFile(SECTIONS_FILE, 'utf8');
  const m = src.match(/export type SectionId =([\s\S]*?);/);
  if (!m) throw new Error('sections.tsx 에서 SectionId union 을 못 찾음');
  const ids = [...m[1].matchAll(/'([^']+)'/g)]
    .map((x) => x[1])
    .filter((id) => !FOUNDATION.has(id));

  const fileToKey = new Map(); // 'src/components/ui/button.tsx' → 'button'
  for (const id of ids) {
    const mods = MODULE_OVERRIDES[id] ?? [`components/ui/${id}`];
    for (const rel of mods) {
      fileToKey.set(`src/${rel}.tsx`, id);
    }
  }
  return fileToKey;
}

// ── 2. git log — 최근 N일 squash 커밋 + 변경 파일
function readCommits() {
  const SEP_C = '\x1e'; // record sep (커밋 사이)
  const SEP_F = '\x1f'; // field sep
  const raw = execFileSync(
    'git',
    [
      'log',
      `--since=${SINCE_DAYS} days ago`,
      '--no-merges',
      `--pretty=format:${SEP_C}%H${SEP_F}%cI${SEP_F}%s`,
      '--name-only',
    ],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  const commits = [];
  for (const block of raw.split(SEP_C)) {
    if (!block.trim()) continue;
    const nl = block.indexOf('\n');
    const header = nl === -1 ? block : block.slice(0, nl);
    const body = nl === -1 ? '' : block.slice(nl + 1);
    const [hash, mergedAt, subject] = header.split(SEP_F);
    const files = body
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const prMatch = subject?.match(/\(#(\d+)\)\s*$/);
    commits.push({
      hash,
      mergedAt,
      subject: subject ?? '',
      prNumber: prMatch ? Number(prMatch[1]) : null,
      files,
    });
  }
  return commits;
}

// ── 3. UI 파일 분류
const ROUTE_PREFIX = 'src/app/[locale]/(app)/';
const GLOBALS = 'src/app/globals.css';

function classify(file) {
  if (file === GLOBALS) return { kind: 'style', name: 'globals.css' };
  const basename = file.split('/').pop().replace(/\.tsx$/, '');
  // src/app 의 page.tsx 만 "라우트 화면". layout/loading/콜로케이트 컴포넌트는
  // 화면이 아니라 컴포넌트로 취급 (route 오분류 방지 — 예: design-system 내부 파일).
  if (file.startsWith('src/app/') && file.endsWith('/page.tsx')) {
    let rest = file.startsWith(ROUTE_PREFIX) ? file.slice(ROUTE_PREFIX.length) : file.slice('src/app/'.length);
    rest = rest.replace(/\/page\.tsx$/, '');
    rest = rest.replace(/\[locale\]\/?/g, '').replace(/\([^)]+\)\/?/g, '');
    const name = `/${rest}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
    return { kind: 'route', name };
  }
  if (file.endsWith('.tsx') && (file.startsWith('src/components/') || file.startsWith('src/app/'))) {
    return { kind: 'component', name: basename };
  }
  return null; // UI 대상 아님
}

function main() {
  const fileToKey = buildCatalogMap();
  const commits = readCommits();

  // 파일별로 가장 최근 커밋만 유지 (commits 는 이미 최신순).
  const byFile = new Map();
  for (const c of commits) {
    for (const file of c.files) {
      if (byFile.has(file)) continue; // 이미 더 최신 커밋으로 채워짐
      const cls = classify(file);
      if (!cls) continue;
      if (!fileExists(join(ROOT, file))) continue; // 삭제된 파일 제외
      byFile.set(file, {
        kind: cls.kind,
        name: cls.name,
        file,
        line: 1,
        prNumber: c.prNumber,
        mergedAt: c.mergedAt,
        oneLine: c.subject,
        catalogKey: fileToKey.get(file) ?? null,
      });
    }
  }

  const entries = [...byFile.values()].sort(
    (a, b) => b.mergedAt.localeCompare(a.mergedAt) || a.file.localeCompare(b.file),
  );

  const out = {
    generatedAt: new Date().toISOString(),
    sinceDays: SINCE_DAYS,
    entries,
  };
  writeFile(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);

  const live = entries.filter((e) => e.catalogKey).length;
  console.log(
    `gen:changed-ui — 최근 ${SINCE_DAYS}일 · ${entries.length} 변경 UI (${live} 카탈로그 등록/라이브 렌더 가능) → ${OUT_FILE.replace(`${ROOT}/`, '')}`,
  );
}

main();
