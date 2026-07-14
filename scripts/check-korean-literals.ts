#!/usr/bin/env node
// 한글 리터럴 ratchet 가드 — docs/WRITING.md 불변식 ①("디폴트 뷰 한글 노출 금지")의
// CI 강제 장치. 유저-facing 소스(page/layout/컴포넌트/lib)에 하드코딩된 한글
// 문자열 리터럴은 로케일과 무관하게 /en 뷰에도 그대로 노출되므로 근본 원인이다.
//
// 스윕(기존 한글 제거)은 후속 Phase 4~7 이 담당한다. 이 가드는 "신규 유입 차단"만
// 한다: `.i18n-korean-baseline.json` 에 현 위반을 파일별 카운트로 스냅샷하고, CI 에서
// 파일별 현재 카운트가 baseline 을 초과하면 red. 감소하면 baseline 갱신을 권장한다.
// 스윕 PR 은 baseline 을 단조 감소시킨다.
//
// 검출: TypeScript 컴파일러 AST 로 문자열 리터럴 / 템플릿 리터럴 / JSX 텍스트만
// 본다. 주석은 AST trivia 라 자연히 제외된다(휴리스틱 grep 의 오탐 없음).
// 정당한 한글(ko.json 값 비교, 정규식, 유저 데이터 fixture 등)은 같은 줄 또는
// 바로 윗줄의 `i18n-allow-korean` 지시자로 개별 예외 처리한다.
//
// 실행:
//   pnpm check:korean             — baseline 대비 검사 (CI). 초과 시 exit 1.
//   pnpm check:korean --update    — 현 상태로 baseline 재스냅샷 (스윕 후 갱신).
//
// AGENTS.md: Next.js 16. PROJECT.md §3.8 하네스, §7 함정 참조.

import ts from 'typescript';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_FILE = join(ROOT, '.i18n-korean-baseline.json');

// 한글: 완성형 음절 + 자모(옛한글 포함). 한자/가나(ja) 는 대상 아님 — ja 는 별도.
const HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏ꥠ-꥿ힰ-퟿]/;

// 유저-facing 스캔 대상 루트 (ROOT 기준 상대, POSIX 구분자).
const TARGET_DIRS = ['src/components', 'src/lib', 'src/app/[locale]'];

// 화이트리스트 — 절대 스캔하지 않음(내부 도구·테스트).
//  · admin / design-system: 내부 도구, 한글 유지 (WRITING.md 예외).
//  · *.test.ts / tests: 테스트 fixture 는 원어 유지.
const WHITELIST_DIR_SEGMENTS = [
  'src/app/[locale]/(app)/admin/',
  'src/app/[locale]/(app)/design-system/',
];
// 파일명 부분 일치 화이트리스트. Phase 1 언어 제안 배너(의도된 예외)는 아직
// main 에 없을 수 있어 forward-compatible 하게 파일명으로 매칭한다.
const WHITELIST_FILE_PATTERNS = ['locale-suggest', 'language-banner', 'language-switch-banner'];

// 개별 라인 예외 지시자.
const ALLOW_DIRECTIVE = 'i18n-allow-korean';

const EXTENSIONS = ['.ts', '.tsx'];

type Violation = { line: number; snippet: string };

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

export function isWhitelisted(relPath: string): boolean {
  const p = toPosix(relPath);
  if (p.endsWith('.d.ts')) return true;
  if (p.includes('/__tests__/') || p.includes('.test.') || p.includes('.spec.')) return true;
  if (WHITELIST_DIR_SEGMENTS.some((seg) => p.includes(seg))) return true;
  const base = p.slice(p.lastIndexOf('/') + 1);
  if (WHITELIST_FILE_PATTERNS.some((pat) => base.includes(pat))) return true;
  return false;
}

// 파일 텍스트를 AST 로 파싱해 한글 포함 리터럴을 찾는다.
// `i18n-allow-korean` 이 같은 줄 또는 바로 윗줄에 있으면 제외.
export function scanSource(fileName: string, text: string): Violation[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = text.split('\n');
  const out: Violation[] = [];

  const suppressed = (lineIdx: number): boolean => {
    const cur = lines[lineIdx] ?? '';
    const prev = lineIdx > 0 ? lines[lineIdx - 1] ?? '' : '';
    return cur.includes(ALLOW_DIRECTIVE) || prev.includes(ALLOW_DIRECTIVE);
  };

  const visit = (node: ts.Node): void => {
    let literal: string | null = null;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    ) {
      literal = (node as ts.LiteralLikeNode).text;
    } else if (ts.isJsxText(node)) {
      literal = node.text;
    }

    if (literal !== null && HANGUL.test(literal)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      if (!suppressed(line)) {
        out.push({ line: line + 1, snippet: literal.trim().slice(0, 60) });
      }
    }
    node.forEachChild(visit);
  };

  visit(source);
  return out;
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

  if (update) {
    writeBaseline(counts);
    console.log(`✓ baseline 갱신: ${fileCount} 파일 / ${total} 한글 리터럴 → ${relative(ROOT, BASELINE_FILE)}`);
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
    console.error('\n✗ 한글 리터럴 baseline 초과 — 신규 하드코딩 한글이 감지됐습니다.');
    console.error('  디폴트(영어) 뷰에도 노출됩니다. messages/*.json 으로 옮기거나,');
    console.error(`  정당한 한글이면 같은 줄/윗줄에 \`// ${ALLOW_DIRECTIVE} -- 사유\` 지시자를 추가하세요.\n`);
    for (const r of regressions) {
      console.error(`  📁 ${r.file}  (baseline ${r.base} → 현재 ${r.now})`);
      for (const v of r.violations.slice(0, 8)) {
        console.error(`     L${v.line}: "${v.snippet}"`);
      }
      if (r.violations.length > 8) console.error(`     … 외 ${r.violations.length - 8}건`);
    }
    console.error('\n  참고: docs/WRITING.md (Writing System SSOT)');
    process.exit(1);
  }

  if (improvements.length > 0) {
    console.log(`✓ baseline 준수. 다만 ${improvements.length} 파일에서 한글 리터럴이 줄었습니다:`);
    for (const i of improvements.slice(0, 20)) {
      console.log(`   ${i.file}: ${i.base} → ${i.now}`);
    }
    console.log('   → 스윕 진척입니다. `pnpm check:korean --update` 로 baseline 을 조여주세요(선택).');
  }

  console.log(`\n✓ 한글 리터럴 가드 통과 — ${fileCount} 파일 / ${total} 리터럴 (모두 baseline 이내).`);
}

// CLI 로 직접 실행될 때만 main() (테스트에서 import 시 실행 안 함).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
