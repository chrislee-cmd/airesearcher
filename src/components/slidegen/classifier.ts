// Deterministic Phase 0/1 classifier — splits a plain text / markdown
// report into slide-sized chunks and produces a DeckSpec. Each chunk is
// inspected for an `@layout:` marker; recognised layouts (currently
// `bullet_body`, `two_by_two`, `process_flow`, `pyramid`) parse their
// structured payload, and anything unrecognised — or any payload that
// fails its diagram's validate() — falls back to `bullet_body` so a
// slide is always renderable. LLM-backed Storyline + Layout classifier
// (SPEC §11 A/B) replaces this in later PRs; this stays as the offline
// fallback and the contract anchor for tests.
//
// Split priority:
//   1. `---` thematic breaks delimit slides explicitly.
//   2. `##` headings split otherwise (heading text → actionTitle).
//   3. If neither marker is present, the whole text is one slide.

import type {
  DeckSpec,
  ProcessFlowPayload,
  PyramidPayload,
  SlideSpec,
  TwoByTwoPayload,
} from './types';
import { twoByTwoTemplate } from './diagrams/two-by-two';
import { processFlowTemplate } from './diagrams/process-flow';
import { pyramidTemplate } from './diagrams/pyramid';

const MAX_BULLETS = 8;
const DEFAULT_TITLE = '제목 없음';

type Chunk = { actionTitle: string; body: string; sourceRef: number };

function splitIntoChunks(text: string): Chunk[] {
  const trimmed = text.replace(/\r\n/g, '\n').trim();
  if (trimmed.length === 0) return [];

  // 1) `---` separators win.
  if (/\n---+\n/.test(`\n${trimmed}\n`)) {
    return trimmed
      .split(/\n---+\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((segment, idx) => extractTitle(segment, idx));
  }

  // 2) `##` headings.
  if (/^##\s+/m.test(trimmed)) {
    const parts: string[] = [];
    let cursor = 0;
    const re = /^##\s+.*$/gm;
    const indexes: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(trimmed)) !== null) {
      indexes.push(m.index);
    }
    if (indexes[0] !== 0 && indexes[0] !== undefined) {
      parts.push(trimmed.slice(0, indexes[0]).trim());
    }
    for (let i = 0; i < indexes.length; i++) {
      const start = indexes[i];
      const end = indexes[i + 1] ?? trimmed.length;
      parts.push(trimmed.slice(start, end).trim());
      cursor = end;
    }
    if (cursor < trimmed.length && parts.length === 0) {
      parts.push(trimmed.slice(cursor).trim());
    }
    return parts
      .filter((p) => p.length > 0)
      .map((segment, idx) => extractTitle(segment, idx));
  }

  // 3) Single slide.
  return [extractTitle(trimmed, 0)];
}

function extractTitle(segment: string, sourceRef: number): Chunk {
  const lines = segment.split('\n');
  const headingIdx = lines.findIndex((l) => /^##\s+/.test(l));
  if (headingIdx === -1) {
    const firstLine = lines.find((l) => l.trim().length > 0)?.trim() ?? '';
    return {
      actionTitle: firstLine.length > 0 ? firstLine : DEFAULT_TITLE,
      body: segment,
      sourceRef,
    };
  }
  const title = lines[headingIdx].replace(/^##\s+/, '').trim();
  const body = lines.slice(headingIdx + 1).join('\n').trim();
  return {
    actionTitle: title.length > 0 ? title : DEFAULT_TITLE,
    body,
    sourceRef,
  };
}

// `@layout:two_by_two` parser. SPEC §8 markup:
//   @layout:two_by_two
//   x: 빈도 낮음 :: 빈도 높음
//   y: 영향 낮음 :: 영향 높음
//   TL: 모니터 :: 분기 보고 이슈 | 백오피스 권한
//   TR: ...
//   BL: ...
//   BR: ...
//
// Returns null when any required line is missing or malformed; the
// caller falls back to bullet_body. Pipe `|` separates list items; lines
// with no `::` are treated as label-only quadrants.
function parseTwoByTwoBody(body: string): TwoByTwoPayload | null {
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const axis: { x?: { low: string; high: string }; y?: { low: string; high: string } } = {};
  const quadrants: TwoByTwoPayload['quadrants'] = [];

  for (const line of lines) {
    const xMatch = line.match(/^x\s*:\s*(.+?)\s*::\s*(.+)$/i);
    if (xMatch) {
      axis.x = { low: xMatch[1].trim(), high: xMatch[2].trim() };
      continue;
    }
    const yMatch = line.match(/^y\s*:\s*(.+?)\s*::\s*(.+)$/i);
    if (yMatch) {
      axis.y = { low: yMatch[1].trim(), high: yMatch[2].trim() };
      continue;
    }
    const qMatch = line.match(/^(TL|TR|BL|BR)\s*:\s*(.+)$/i);
    if (qMatch) {
      const position = qMatch[1].toUpperCase() as 'TL' | 'TR' | 'BL' | 'BR';
      const rest = qMatch[2].trim();
      const [labelPart, itemsPart] = rest.includes('::')
        ? rest.split(/\s*::\s*/, 2)
        : [rest, ''];
      const items = itemsPart
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      quadrants.push({ position, label: labelPart.trim(), items });
    }
  }

  if (!axis.x || !axis.y || quadrants.length !== 4) return null;
  const payload: TwoByTwoPayload = {
    xAxis: axis.x,
    yAxis: axis.y,
    quadrants,
  };
  return twoByTwoTemplate.validate(payload) ? payload : null;
}

// `@layout:process_flow` parser. SPEC §8 markup:
//   @layout:process_flow
//   1: 진단 :: 시장 정체를 정량 데이터로 정리
//   2: 설계 :: 자동화 파이프라인 정의
//   3: 검증 :: 파일럿 3사로 KPI 측정
//   4: 확장 :: SaaS 전환
//
// Returns null when fewer than one valid `N: title :: desc` line is
// parsed or the template's validate() rejects (e.g. >6 steps). Order is
// taken from the leading number, not file position, so users can paste
// out-of-order lines without breaking the diagram.
function parseProcessFlowBody(body: string): ProcessFlowPayload | null {
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const steps: ProcessFlowPayload['steps'] = [];
  for (const line of lines) {
    const m = line.match(/^(\d+)\s*[:.)]\s*(.+?)\s*::\s*(.+)$/);
    if (!m) continue;
    const order = Number.parseInt(m[1], 10);
    if (!Number.isFinite(order)) continue;
    steps.push({ order, title: m[2].trim(), desc: m[3].trim() });
  }

  if (steps.length === 0) return null;
  const payload: ProcessFlowPayload = { steps };
  return processFlowTemplate.validate(payload) ? payload : null;
}

// `@layout:pyramid` parser. SPEC §8 markup:
//   @layout:pyramid
//   1: 비전 :: 산업 표준 SaaS 플랫폼 (정점)
//   2: 가치 :: 자동화 · 신뢰성 · 확장성
//   3: 원칙 :: 빠른 실행 · 고객 피드백 루프
//   4: 실행 :: 분기 OKR · 주간 운영 회의
//
// tier 1 이 최상위(피라미드 정점), 큰 숫자가 밑변. 2~5단 만 허용 — 그
// 이상은 가독성이 떨어져 bullet_body 로 폴백시킨다.
function parsePyramidBody(body: string): PyramidPayload | null {
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const levels: PyramidPayload['levels'] = [];
  for (const line of lines) {
    const m = line.match(/^(\d+)\s*[:.)]\s*(.+?)\s*::\s*(.+)$/);
    if (!m) continue;
    const tier = Number.parseInt(m[1], 10);
    if (!Number.isFinite(tier)) continue;
    levels.push({ tier, label: m[2].trim(), desc: m[3].trim() });
  }

  if (levels.length === 0) return null;
  const payload: PyramidPayload = { levels };
  return pyramidTemplate.validate(payload) ? payload : null;
}

function detectLayout(
  body: string,
): 'two_by_two' | 'process_flow' | 'pyramid' | null {
  const match = body.match(/^@layout\s*:\s*([a-z_]+)\s*$/im);
  if (!match) return null;
  const layout = match[1].toLowerCase();
  if (layout === 'two_by_two') return 'two_by_two';
  if (layout === 'process_flow') return 'process_flow';
  if (layout === 'pyramid') return 'pyramid';
  return null;
}

function buildSlide(chunk: Chunk): SlideSpec {
  const layout = detectLayout(chunk.body);
  if (layout === 'two_by_two') {
    const payload = parseTwoByTwoBody(chunk.body);
    if (payload) {
      return {
        id: `slide-${chunk.sourceRef}`,
        actionTitle: chunk.actionTitle,
        speakerNotes: null,
        sourceRefs: [chunk.sourceRef],
        layoutType: 'two_by_two',
        payload,
      };
    }
  }
  if (layout === 'process_flow') {
    const payload = parseProcessFlowBody(chunk.body);
    if (payload) {
      return {
        id: `slide-${chunk.sourceRef}`,
        actionTitle: chunk.actionTitle,
        speakerNotes: null,
        sourceRefs: [chunk.sourceRef],
        layoutType: 'process_flow',
        payload,
      };
    }
  }
  if (layout === 'pyramid') {
    const payload = parsePyramidBody(chunk.body);
    if (payload) {
      return {
        id: `slide-${chunk.sourceRef}`,
        actionTitle: chunk.actionTitle,
        speakerNotes: null,
        sourceRefs: [chunk.sourceRef],
        layoutType: 'pyramid',
        payload,
      };
    }
  }
  return toBulletBody(chunk);
}

function toBulletBody(chunk: Chunk): SlideSpec {
  const lines = chunk.body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const blockquoteIntro = lines.find((l) => l.startsWith('>'));
  const body = blockquoteIntro
    ? blockquoteIntro.replace(/^>\s*/, '').trim() || null
    : null;

  const bullets = lines
    .filter((l) => /^[-*•]\s+/.test(l))
    .map((l) => l.replace(/^[-*•]\s+/, '').trim())
    .filter((l) => l.length > 0)
    .slice(0, MAX_BULLETS);

  // No explicit bullets? Treat each remaining non-heading line as a bullet
  // so plain prose still produces visible content instead of an empty slide.
  const fallbackBullets =
    bullets.length === 0
      ? lines
          .filter(
            (l) => !l.startsWith('>') && !l.startsWith('#') && !l.startsWith('@'),
          )
          .slice(0, MAX_BULLETS)
      : bullets;

  return {
    id: `slide-${chunk.sourceRef}`,
    actionTitle: chunk.actionTitle,
    speakerNotes: null,
    sourceRefs: [chunk.sourceRef],
    layoutType: 'bullet_body',
    payload: {
      bullets: fallbackBullets,
      body,
    },
  };
}

export function buildDeckSpec(
  text: string,
  options: { title?: string } = {},
): DeckSpec {
  const chunks = splitIntoChunks(text);
  const slides = chunks.map(buildSlide);
  return {
    meta: {
      title: options.title ?? slides[0]?.actionTitle ?? DEFAULT_TITLE,
      client: null,
      author: null,
      theme: 'primary_source',
      createdAt: new Date().toISOString(),
    },
    slides,
  };
}
