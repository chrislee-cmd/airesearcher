// Deterministic Phase 0/1 classifier — splits a plain text / markdown
// report into slide-sized chunks and produces a DeckSpec where every
// slide is `bullet_body`. The LLM-backed Storyline + Layout classifier
// (SPEC §11 A/B) replaces this in later PRs; this stays as the offline
// fallback and the contract anchor for tests.
//
// Split priority:
//   1. `---` thematic breaks delimit slides explicitly.
//   2. `##` headings split otherwise (heading text → actionTitle).
//   3. If neither marker is present, the whole text is one slide.

import type { DeckSpec, SlideSpec } from './types';

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
  const slides = chunks.map(toBulletBody);
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
