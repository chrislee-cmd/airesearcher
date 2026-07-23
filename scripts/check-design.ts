#!/usr/bin/env node
// 디자인 토큰 하드코드 ratchet 가드 — check:korean 의 형제.
//
// PROJECT.md §9 디자인 시스템의 불변식("색/크기/모서리/그림자는 토큰만 사용")을
// 정적으로 강제한다. 렌더 무관·file:line 정확·CI 회귀차단. `globals.css` 의
// 토큰(색 --color-*, --shadow-memphis-*, --radius-*)으로 커버되는 속성을 임의값
// (arbitrary)·인라인 hex 로 하드코딩하면 토큰화가 우회되고, 톤 swap·라디우스 조정
// 같은 "토큰 1곳 변경 → 전체 반영" 이 깨진다.
//
// 스윕(기존 하드코드 제거)은 후속 burn-down PR 들이 담당한다. 이 가드는 "신규
// 유입 차단" + "진척 가시화" 만 한다: `.design-hardcode-baseline.json` 에 현 위반을
// 파일별 카운트로 스냅샷하고, CI 에서 파일별 현재 카운트가 baseline 을 초과하면
// red. 감소하면 baseline 갱신을 권장한다. 스윕 PR 은 baseline 을 단조 감소시킨다.
//
// 검출 (토큰 대상 속성만 — 과탐 방지 최우선):
//   · Tailwind arbitrary shadow:  shadow-[...]           (→ shadow-memphis-*)
//   · Tailwind arbitrary color:   (bg|text|border|ring|…)-[#hex|rgb()|hsl()]
//   · Tailwind arbitrary radius:  rounded-[<len>]        (→ rounded-{xs,sm,…})
//   · Arbitrary CSS property:     [border-radius:3px] · [box-shadow:…] · [color:#…]
//   · 인라인 style 객체:           style={{ color:'#fff', borderRadius:'3px', … }}
//   · SVG/JSX 색 속성:            fill="#…" · stroke="#…" · stopColor="#…"
//
// 제외 (보수적 — 레이아웃/토큰참조는 하드코드 아님):
//   · 순수 레이아웃 arbitrary:   w-[280px]·grid-cols-[…]·gap-[…]·top-[…]·calc()·url()
//   · var(--token) 참조:          bg-[var(--x)]·style={{color:'var(--color-ink)'}}
//   · border 폭(border-[2px]):    기존 DS-6 bracket-border eslint 게이트 담당 → 중복 회피
//   · text-[Npx] 폰트크기:        기존 no-restricted-syntax(text-[Npx]) 게이트 담당
//
// 정당한 하드코드(브랜드 SVG 자산·third-party·1회성)는 같은 줄 또는 바로 윗줄의
// `design-allow-hardcoded` 지시자로 개별 예외 처리한다 (i18n-allow-korean 과 동일 톤).
//
// 실행:
//   pnpm check:design             — baseline 대비 검사 (CI). 초과 시 exit 1.
//   pnpm check:design --update    — 현 상태로 baseline 재스냅샷 (스윕 후 갱신).
//
// AGENTS.md: Next.js 16. PROJECT.md §3.8 하네스, §7 함정, §9 디자인 시스템 참조.

import ts from 'typescript';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_FILE = join(ROOT, '.design-hardcode-baseline.json');

// 유저-facing UI 스캔 대상 루트 (ROOT 기준 상대, POSIX 구분자).
const TARGET_DIRS = ['src/components', 'src/app/[locale]', 'src/lib'];

// 화이트리스트 — 절대 스캔하지 않음.
//  · design-system: 토큰/primitive 카탈로그. 의도적으로 raw 값(데모 swatch,
//    `[border-radius:Npx]` 플레이스홀더 등)을 보여주는 표면이라 하드코드가 정상.
//  · (canvas-lab): 라우팅 안 되는 내부 dev 샌드박스(레퍼런스 구현).
//  · *.test / *.spec / *.d.ts: 테스트 fixture · 타입 선언.
const WHITELIST_DIR_SEGMENTS = [
  'src/app/[locale]/(app)/design-system/',
  'src/app/[locale]/(canvas-lab)/',
];

// 개별 라인 예외 지시자.
const ALLOW_DIRECTIVE = 'design-allow-hardcoded';

const EXTENSIONS = ['.ts', '.tsx'];

type Category = 'shadow' | 'color' | 'radius' | 'inline-color' | 'inline-dim' | 'svg-color';
type Violation = { line: number; snippet: string; category: Category };

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

export function isWhitelisted(relPath: string): boolean {
  const p = toPosix(relPath);
  if (p.endsWith('.d.ts')) return true;
  if (p.includes('/__tests__/') || p.includes('.test.') || p.includes('.spec.')) return true;
  if (WHITELIST_DIR_SEGMENTS.some((seg) => p.includes(seg))) return true;
  return false;
}

// ── 색/치수 리터럴 프리미티브 ────────────────────────────────────────────────
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const RGB_HSL = /\b(?:rgba?|hsla?)\(/;
const LENGTH = /\d*\.?\d+(?:px|rem|em)\b/;
const COLOR = new RegExp(`(?:${HEX.source}|${RGB_HSL.source})`);

// self-identifying Tailwind / arbitrary-CSS 패턴 (className 문자열 어디에 있든 안전).
// shadow-[...] 전체 — memphis 스케일(shadow-memphis-*) 을 우회하는 임의 그림자.
const RE_SHADOW = /(?<![\w-])shadow-\[[^\]]+\]/g;
// 색 계열 유틸의 arbitrary 색 리터럴. border 는 색만(폭 border-[2px] 은 DS-6 담당).
const RE_COLOR = new RegExp(
  `(?<![\\w-])(?:bg|text|border|ring|outline|fill|stroke|from|via|to|decoration|divide|caret|accent|placeholder)-\\[[^\\]]*(?:${HEX.source}|${RGB_HSL.source})[^\\]]*\\]`,
  'g',
);
// rounded-[<len>] — radius 토큰(rounded-{xs,sm,md,…}) 우회. var() 참조는 아래서 제외.
const RE_RADIUS = /(?<![\w-])rounded(?:-[a-z]+)?-\[[^\]]*\]/g;
// arbitrary CSS property [prop:value] — 토큰 대상 속성만.
const RE_ARB_PROP =
  /\[(border-radius|box-shadow|color|background|background-color|border-color|outline-color|fill|stroke|text-decoration-color):[^\]]+\]/g;

// 인라인 style 객체에서 하드코드로 볼 토큰 대상 키.
const STYLE_COLOR_KEYS = new Set([
  'color', 'background', 'backgroundColor', 'borderColor', 'borderTopColor',
  'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor',
  'fill', 'stroke', 'boxShadow', 'textDecorationColor', 'caretColor',
]);
const STYLE_DIM_KEYS = new Set(['borderRadius', 'boxShadow']);

// JSX 색 속성 (SVG 자산 등).
const SVG_COLOR_ATTRS = new Set(['fill', 'stroke', 'stopColor', 'floodColor', 'lightingColor']);

function hasToken(s: string): boolean {
  return s.includes('var(--');
}

// className / 문자열 리터럴 텍스트에서 self-identifying 하드코드 패턴을 찾는다.
function scanText(text: string): { category: Category; match: string }[] {
  const out: { category: Category; match: string }[] = [];

  for (const m of text.matchAll(RE_SHADOW)) {
    // var() 참조는 하드코드 아님 — rounded-[var(--x)]·[box-shadow:var(--x)] 와
    // 동일 원칙(파일 상단 "제외" 주석). 승격 그림자 토큰을 shadow-[var(--fv-*)]
    // 로 소비하는 경로(globals.css §F6(B))를 통과시킨다.
    if (hasToken(m[0])) continue;
    out.push({ category: 'shadow', match: m[0] });
  }
  for (const m of text.matchAll(RE_COLOR)) {
    out.push({ category: 'color', match: m[0] });
  }
  for (const m of text.matchAll(RE_RADIUS)) {
    // 길이 리터럴(px/rem/em)이 있고 var() 토큰이 아닐 때만 (rounded-[var(--x)] 제외).
    if (LENGTH.test(m[0]) && !hasToken(m[0])) out.push({ category: 'radius', match: m[0] });
  }
  for (const m of text.matchAll(RE_ARB_PROP)) {
    const prop = m[1];
    const val = m[0];
    if (hasToken(val)) continue; // [box-shadow:var(--shadow-bento)] 등 토큰 참조는 통과
    const isColorProp = prop !== 'border-radius'; // border-radius 는 치수, 나머지는 색/그림자
    if (COLOR.test(val) || (prop === 'box-shadow' && LENGTH.test(val))) {
      out.push({ category: isColorProp ? 'color' : 'radius', match: val });
    } else if (prop === 'border-radius' && LENGTH.test(val)) {
      out.push({ category: 'radius', match: val });
    }
  }
  return out;
}

// AST 로 파싱해 위반을 찾는다. `design-allow-hardcoded` 가 같은 줄/윗줄에 있으면 제외.
export function scanSource(fileName: string, text: string): Violation[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = text.split('\n');
  const out: Violation[] = [];

  const suppressed = (lineIdx: number): boolean => {
    const cur = lines[lineIdx] ?? '';
    const prev = lineIdx > 0 ? lines[lineIdx - 1] ?? '' : '';
    return cur.includes(ALLOW_DIRECTIVE) || prev.includes(ALLOW_DIRECTIVE);
  };

  const lineOf = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line;

  const push = (node: ts.Node, category: Category, snippet: string): void => {
    const line = lineOf(node);
    if (!suppressed(line)) out.push({ line: line + 1, snippet: snippet.trim().slice(0, 60), category });
  };

  // 리터럴 텍스트 노드에서 self-identifying Tailwind/arbitrary 패턴.
  const litText = (node: ts.Node): string | null => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    ) {
      return (node as ts.LiteralLikeNode).text;
    }
    return null;
  };

  const visit = (node: ts.Node): void => {
    // 1) className 등 문자열 리터럴의 Tailwind/arbitrary 하드코드.
    const t = litText(node);
    if (t !== null) {
      for (const hit of scanText(t)) push(node, hit.category, hit.match);
    }

    // 2) 인라인 style 객체 + SVG 색 속성 (컨텍스트 필요 — 과탐 방지).
    if (ts.isJsxAttribute(node) && node.name && ts.isIdentifier(node.name)) {
      const attr = node.name.text;
      const init = node.initializer;

      // style={{ ... }}
      if (attr === 'style' && init && ts.isJsxExpression(init) && init.expression) {
        collectStyleObject(init.expression, push);
      }

      // fill="#..." / stroke="#..." 등 (문자열 리터럴 값만).
      if (SVG_COLOR_ATTRS.has(attr) && init && ts.isStringLiteral(init)) {
        if (HEX.test(init.text) || RGB_HSL.test(init.text)) {
          push(init, 'svg-color', `${attr}="${init.text}"`);
        }
      }
    }

    node.forEachChild(visit);
  };

  visit(source);
  return out;
}

// style={{ ... }} ObjectLiteral 의 토큰 대상 속성에서 hex/px 하드코드 수집.
function collectStyleObject(
  expr: ts.Expression,
  push: (node: ts.Node, category: Category, snippet: string) => void,
): void {
  if (!ts.isObjectLiteralExpression(expr)) return;
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
    if (!key) continue;
    const val = prop.initializer;
    // 정적 문자열 값만 (템플릿 보간·변수·계산식은 skip).
    let str: string | null = null;
    if (ts.isStringLiteral(val) || ts.isNoSubstitutionTemplateLiteral(val)) str = val.text;
    if (str === null || hasToken(str)) continue;

    if (STYLE_COLOR_KEYS.has(key) && (HEX.test(str) || RGB_HSL.test(str))) {
      push(val, 'inline-color', `${key}: '${str}'`);
    } else if (STYLE_DIM_KEYS.has(key) && LENGTH.test(str)) {
      push(val, 'inline-dim', `${key}: '${str}'`);
    }
  }
}

function walkFiles(dirAbs: string, acc: string[]): void {
  if (!existsSync(dirAbs)) return;
  for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
    const abs = join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      walkFiles(abs, acc);
    } else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      acc.push(abs);
    }
  }
}

// 대상 파일 전체를 스캔해 { relPath: count } 맵과 상세 위반을 반환.
export function scanRepo(): { counts: Record<string, number>; details: Map<string, Violation[]> } {
  const files: string[] = [];
  for (const dir of TARGET_DIRS) walkFiles(join(ROOT, dir), files);

  const counts: Record<string, number> = {};
  const details = new Map<string, Violation[]>();
  for (const abs of files) {
    const rel = toPosix(relative(ROOT, abs));
    if (isWhitelisted(rel)) continue;
    const violations = scanSource(abs, readFileSync(abs, 'utf8'));
    if (violations.length > 0) {
      counts[rel] = violations.length;
      details.set(rel, violations);
    }
  }
  return { counts, details };
}

function loadBaseline(): Record<string, number> {
  if (!existsSync(BASELINE_FILE)) return {};
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Record<string, number>;
}

function writeBaseline(counts: Record<string, number>): void {
  // 결정론적 출력(파일 경로 정렬) — diff 안정.
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(counts).sort()) sorted[key] = counts[key];
  writeFileSync(BASELINE_FILE, JSON.stringify(sorted, null, 2) + '\n');
}

function main(): void {
  const update = process.argv.includes('--update') || process.argv.includes('--write');
  const { counts, details } = scanRepo();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const fileCount = Object.keys(counts).length;

  // 카테고리별 집계 (리포트).
  const byCat: Record<Category, number> = {
    shadow: 0, color: 0, radius: 0, 'inline-color': 0, 'inline-dim': 0, 'svg-color': 0,
  };
  for (const vs of details.values()) for (const v of vs) byCat[v.category]++;
  const catLine = (Object.entries(byCat) as [Category, number][])
    .filter(([, n]) => n > 0)
    .map(([c, n]) => `${c} ${n}`)
    .join(' · ');

  if (update) {
    writeBaseline(counts);
    console.log(`✓ baseline 갱신: ${fileCount} 파일 / ${total} 하드코드 → ${relative(ROOT, BASELINE_FILE)}`);
    console.log(`  카테고리: ${catLine}`);
    return;
  }

  const baseline = loadBaseline();
  const regressions: { file: string; base: number; now: number; violations: Violation[] }[] = [];
  const improvements: { file: string; base: number; now: number }[] = [];

  for (const [file, now] of Object.entries(counts)) {
    const base = baseline[file] ?? 0; // 신규 파일 = 0 허용
    if (now > base) regressions.push({ file, base, now, violations: details.get(file) ?? [] });
    else if (now < base) improvements.push({ file, base, now });
  }
  // baseline 에 있었으나 이제 위반 0 인 파일도 개선.
  for (const [file, base] of Object.entries(baseline)) {
    if (!(file in counts) && base > 0) improvements.push({ file, base, now: 0 });
  }

  if (regressions.length > 0) {
    console.error('\n✗ 디자인 하드코드 baseline 초과 — 신규 하드코딩 값이 감지됐습니다.');
    console.error('  색/그림자/라디우스는 토큰만 사용하세요 (globals.css: --color-*, --shadow-memphis-*, --radius-*).');
    console.error(`  정당한 하드코드(브랜드 SVG·third-party)면 같은 줄/윗줄에 \`// ${ALLOW_DIRECTIVE} -- 사유\` 를 추가하세요.\n`);
    for (const r of regressions) {
      console.error(`  📁 ${r.file}  (baseline ${r.base} → 현재 ${r.now})`);
      for (const v of r.violations.slice(0, 8)) {
        console.error(`     L${v.line}: [${v.category}] "${v.snippet}"`);
      }
      if (r.violations.length > 8) console.error(`     … 외 ${r.violations.length - 8}건`);
    }
    console.error('\n  참고: PROJECT.md §9 디자인 시스템 · docs/DESIGN_SYSTEM.md');
    process.exit(1);
  }

  if (improvements.length > 0) {
    console.log(`✓ baseline 준수. 다만 ${improvements.length} 파일에서 하드코드가 줄었습니다:`);
    for (const i of improvements.slice(0, 20)) {
      console.log(`   ${i.file}: ${i.base} → ${i.now}`);
    }
    console.log('   → burn-down 진척입니다. `pnpm check:design --update` 로 baseline 을 조여주세요(선택).');
  }

  console.log(`\n✓ 디자인 하드코드 가드 통과 — ${fileCount} 파일 / ${total} 하드코드 (모두 baseline 이내).`);
  console.log(`  카테고리: ${catLine}`);
}

// CLI 로 직접 실행될 때만 main() (테스트에서 import 시 실행 안 함).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
