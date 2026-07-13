#!/usr/bin/env node
// Codegen — design-system 카탈로그 "캔버스 사용처" 데이터.
//
// 각 primitive 섹션(button/icon-button/…/canvas-widget-primitives)이 실제로
// 어떤 캔버스 위젯에서 쓰이는지를 소스에서 grep 해 집계한다. 수동 map 은
// 금방 stale 해져 카탈로그 신뢰도를 무너뜨리므로(수동 유지 지양) 코드가 SSOT.
//
// 출력: src/app/[locale]/(app)/design-system/usage-map.generated.json
//   { [sectionId]: [{ widget, file, line }] }  (component 섹션마다 키 존재, 0이면 [])
//
// 실행: pnpm gen:ds-usage  (생성된 JSON 커밋). 멱등 — 소스 안 바뀌면 diff 0.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const CANVAS_DIR = join(SRC, 'components/canvas');
const WIDGETS_DIR = join(CANVAS_DIR, 'widgets');
const DS_DIR = join(SRC, 'app/[locale]/(app)/design-system');
const SECTIONS_FILE = join(DS_DIR, 'components/sections.tsx');
const VISIBILITY_FILE = join(SRC, 'lib/canvas/visibility.ts');
const OUT_FILE = join(DS_DIR, 'usage-map.generated.json');

// Foundation(token) 섹션은 부품이 아니라 usage 대상이 아니다. 나머지가 component 섹션.
const FOUNDATION = new Set(['color', 'radius', 'font-size', 'z-index', 'motion']);

// convention 을 벗어난 섹션의 모듈 경로(확장자 없이, SRC 기준 상대).
// 나머지는 src/components/ui/<sectionId> 로 자동 매핑된다.
const MODULE_OVERRIDES = {
  'widget-fullview-modal': ['components/canvas/shell/widget-fullview-modal'],
  'canvas-widget-primitives': [
    'components/canvas/shell/field',
    'components/canvas/shell/banner',
    'components/canvas/shell/control-board',
    'components/canvas/shell/widget-subheader',
    'components/canvas/shell/widget-outputs',
    'components/canvas/shell/widget-credit-badge',
    'components/canvas/shell/widget-state-pill',
  ],
};

// ── 1. SectionId union 을 sections.tsx 에서 파싱 (drift 방지: 섹션 추가/삭제 자동 반영)
function readComponentSections() {
  const src = readFileSync(SECTIONS_FILE, 'utf8');
  const m = src.match(/export type SectionId =([\s\S]*?);/);
  if (!m) throw new Error('sections.tsx 에서 SectionId union 을 못 찾음');
  const ids = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  return ids.filter((id) => !FOUNDATION.has(id));
}

// ── 2. component 섹션 → 카탈로그 모듈(절대경로, 확장자 없음) 매핑
function buildModuleToSection(sections) {
  const moduleToSection = new Map();
  for (const id of sections) {
    const mods = MODULE_OVERRIDES[id] ?? [`components/ui/${id}`];
    for (const rel of mods) {
      const abs = join(SRC, rel);
      if (!existsSync(`${abs}.tsx`) && !existsSync(`${abs}.ts`)) {
        throw new Error(`섹션 '${id}' 의 모듈 ${rel} 파일이 없음 — MODULE_OVERRIDES 갱신 필요`);
      }
      moduleToSection.set(abs, id);
    }
  }
  return moduleToSection;
}

// ── 3a. 캔버스에 실제 렌더되는(visibility=true) 위젯 key 집합 — deep-link focus 대상.
//    hidden 위젯(moderator/topline/slidegen)은 focus 방어되므로 링크 미부여.
function readVisibleCanvasKeys() {
  const src = readFileSync(VISIBILITY_FILE, 'utf8');
  const m = src.match(/CANVAS_VISIBILITY[^{]*{([\s\S]*?)}/);
  if (!m) throw new Error('visibility.ts 에서 CANVAS_VISIBILITY 를 못 찾음');
  const keys = new Set();
  for (const line of m[1].split('\n')) {
    const lm = line.match(/^\s*([a-z_]+):\s*true\b/);
    if (lm) keys.add(lm[1]);
  }
  return keys;
}

// ── 3b. 위젯 파일 → { label, key } lookup: *-card.tsx 의 meta.label + WidgetContent.key.
//    key = meta: 직전의 top-level key (focusable 위젯이면 값, 아니면 null).
function buildWidgetPrefixes(visibleKeys) {
  const prefixes = [];
  for (const f of readdirSync(WIDGETS_DIR)) {
    if (!f.endsWith('-card.tsx')) continue;
    const prefix = f.replace(/-card\.tsx$/, '');
    const src = readFileSync(join(WIDGETS_DIR, f), 'utf8');
    const metaIdx = src.indexOf('meta:');
    let label = prefix;
    let key = null;
    if (metaIdx !== -1) {
      const lm = src.slice(metaIdx).match(/label:\s*'([^']+)'/);
      if (lm) label = lm[1];
      // WidgetContent.key = meta: 직전 마지막 `key: '...'`
      const keyMatches = [...src.slice(0, metaIdx).matchAll(/key:\s*'([^']+)'/g)];
      const rawKey = keyMatches.length ? keyMatches[keyMatches.length - 1][1] : null;
      if (rawKey && visibleKeys.has(rawKey)) key = rawKey; // 렌더되는 위젯만 focusable
    }
    prefixes.push({ prefix, label, key });
  }
  // 긴 prefix 우선 (moderator-ai 가 moderator 보다 먼저 매칭돼야 함)
  prefixes.sort((a, b) => b.prefix.length - a.prefix.length);
  return prefixes;
}

// 반환: { label, key } (위젯 매핑) | null (shell 등 공용)
function widgetLookup(relFromCanvas, prefixes) {
  if (!relFromCanvas.startsWith('widgets/')) return null; // shell 등 공용
  const rel = relFromCanvas.slice('widgets/'.length);
  for (const { prefix, label, key } of prefixes) {
    if (rel === `${prefix}.tsx` || rel.startsWith(`${prefix}-`) || rel.startsWith(`${prefix}/`)) {
      return { label, key };
    }
  }
  return null;
}

// ── 4. 캔버스 파일 순회
function walkTsx(dir) {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...walkTsx(p));
    else if (name.name.endsWith('.tsx') && !name.name.endsWith('.test.tsx')) out.push(p);
  }
  return out;
}

// import 절에서 값(비-type) named local 식별자 추출
function namedValueLocals(clause) {
  const brace = clause.match(/{([\s\S]*)}/);
  if (!brace) return [];
  return brace[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !s.startsWith('type '))
    .map((s) => {
      const as = s.match(/\bas\s+([A-Za-z0-9_$]+)/);
      return as ? as[1] : s.split(/\s+/)[0];
    })
    .filter(Boolean);
}

function resolveSpecifier(spec, fromFile) {
  if (spec.startsWith('@/')) return join(SRC, spec.slice(2));
  if (spec.startsWith('.')) return resolve(dirname(fromFile), spec);
  return null; // node_modules
}

function main() {
  const sections = readComponentSections();
  const moduleToSection = buildModuleToSection(sections);
  const visibleKeys = readVisibleCanvasKeys();
  const prefixes = buildWidgetPrefixes(visibleKeys);

  const result = {};
  for (const id of sections) result[id] = [];
  const seen = new Set(); // `${sectionId}::${relFile}` 중복 방지

  const importRe = /import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;

  for (const file of walkTsx(CANVAS_DIR)) {
    const content = readFileSync(file, 'utf8');
    const relFile = relative(ROOT, file);
    const relFromCanvas = relative(CANVAS_DIR, file);
    const lines = content.split('\n');

    let m;
    importRe.lastIndex = 0;
    while ((m = importRe.exec(content)) !== null) {
      if (m[1]) continue; // `import type ...` 전체 스킵
      const clause = m[2];
      const spec = m[3];
      const abs = resolveSpecifier(spec, file);
      if (!abs) continue;
      const sectionId = moduleToSection.get(abs);
      if (!sectionId) continue;

      const key = `${sectionId}::${relFile}`;
      if (seen.has(key)) continue;

      const locals = namedValueLocals(clause);
      if (locals.length === 0) continue; // type-only named import

      // 사용 라인 = 가장 이른 JSX open(`<Local`) — 없으면 import 라인
      const importLine = content.slice(0, m.index).split('\n').length;
      let usageLine = importLine;
      let best = Infinity;
      for (let i = 0; i < lines.length; i++) {
        for (const loc of locals) {
          if (new RegExp(`<${loc}\\b`).test(lines[i]) && i + 1 < best) best = i + 1;
        }
      }
      if (best !== Infinity) usageLine = best;

      seen.add(key);
      const w = widgetLookup(relFromCanvas, prefixes);
      // 위젯 매핑되면 라벨+focus key, shell/공용은 '캔버스 공용'(key 없음).
      result[sectionId].push({
        widget: w ? w.label : '캔버스 공용',
        key: w ? w.key : null,
        file: relFile,
        line: usageLine,
      });
    }
  }

  // 결정적 출력(멱등): 각 섹션 배열을 widget→file→line 로 정렬
  for (const id of sections) {
    result[id].sort(
      (a, b) => a.widget.localeCompare(b.widget) || a.file.localeCompare(b.file) || a.line - b.line,
    );
  }

  writeFileSync(OUT_FILE, `${JSON.stringify(result, null, 2)}\n`);
  const total = sections.reduce((n, id) => n + result[id].length, 0);
  console.log(`gen:ds-usage — ${sections.length} 섹션, ${total} 사용처 → ${relative(ROOT, OUT_FILE)}`);
}

main();
