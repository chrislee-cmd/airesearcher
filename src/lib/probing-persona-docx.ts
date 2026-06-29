import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type FileChild,
} from 'docx';
import {
  PROBING_PERSONA_SECTION_KEYS,
  PROBING_TECHNIQUE_LABEL,
  type ProbingPersona,
  type ProbingPersonaSection,
  type ProbingPersonaSectionKey,
  type ProbingTechnique,
} from './probing-prompts';
import type { HistoryQuestion } from '@/components/canvas/widgets/probing-types';

// Editorial palette — mirrors interviews-docx.ts so the two exports share
// the same look. Sizes are docx half-points; line spacing in 240ths (240 = 1.0).
const AP = {
  amore: '1F5795',
  ink2: '1A1A1A',
  mute: '5A5A5A',
  muteSoft: '9B9B9B',
  line: 'E1E3E8',
} as const;

const SIZE = {
  h1: 56,
  h2: 32,
  h3: 26,
  subtitle: 22,
  eyebrow: 18,
  body: 22,
  quote: 22,
  caption: 20,
} as const;

const FONT = {
  ascii: 'Inter',
  cs: 'Sarabun',
  eastAsia: 'Pretendard',
} as const;

const PANEL_META: Record<
  ProbingPersonaSectionKey,
  { icon: string; title: string }
> = {
  demographics: { icon: '👤', title: '데모그래픽' },
  values: { icon: '🌱', title: '가치관' },
  preferences: { icon: '💎', title: '선호' },
  needs: { icon: '🎯', title: '니즈' },
  painpoints: { icon: '⚠️', title: '페인포인트' },
  brand_perception: { icon: '🏷️', title: '브랜드 인식' },
  decision_drivers: { icon: '🧭', title: '의사결정 요인' },
  behavioral_patterns: { icon: '🔁', title: '행동 패턴' },
};

const CONFIDENCE_LABEL: Record<ProbingPersonaSection['confidence'], string> = {
  high: '●●● 신호 강함',
  medium: '●●○ 신호 보통',
  low: '●○○ 신호 약함',
  insufficient: '○○○ 단서 부족',
};

function eyebrow(text: string, color: string = AP.amore): TextRun {
  return new TextRun({
    text: text.toUpperCase(),
    bold: true,
    size: SIZE.eyebrow,
    color,
    characterSpacing: 40,
    font: FONT,
  });
}

function thinRule(color: string = AP.line, after = 120): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 4, color, space: 1 },
    },
    children: [new TextRun({ text: '' })],
  });
}

function blank(after = 120): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after },
    children: [new TextRun({ text: '' })],
  });
}

function metaLine(label: string, value: string): Paragraph {
  return new Paragraph({
    spacing: { line: 280, lineRule: 'auto', after: 60 },
    children: [
      new TextRun({
        text: `${label}  `,
        size: SIZE.caption,
        color: AP.muteSoft,
        characterSpacing: 20,
      }),
      new TextRun({ text: value, size: SIZE.body, color: AP.ink2 }),
    ],
  });
}

function sectionHeader(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [
      new TextRun({
        text,
        bold: true,
        size: SIZE.h2,
        color: AP.ink2,
        font: FONT,
      }),
    ],
  });
}

function panelHeader(
  icon: string,
  title: string,
  confidence: ProbingPersonaSection['confidence'],
): Paragraph {
  return new Paragraph({
    spacing: { before: 180, after: 60 },
    children: [
      new TextRun({
        text: `${icon}  ${title}`,
        bold: true,
        size: SIZE.h3,
        color: AP.ink2,
        font: FONT,
      }),
      new TextRun({
        text: `   ${CONFIDENCE_LABEL[confidence]}`,
        size: SIZE.caption,
        color: AP.muteSoft,
        font: FONT,
      }),
    ],
  });
}

function summaryParagraph(text: string): Paragraph {
  return new Paragraph({
    spacing: { line: 320, lineRule: 'auto', after: 80 },
    children: [
      new TextRun({
        text,
        size: SIZE.body,
        color: AP.ink2,
        font: FONT,
      }),
    ],
  });
}

function signalBullet(bullet: string): Paragraph {
  return new Paragraph({
    spacing: { line: 300, lineRule: 'auto', after: 40 },
    indent: { left: 200 },
    children: [
      new TextRun({
        text: `· ${bullet}`,
        size: SIZE.body,
        color: AP.ink2,
        font: FONT,
      }),
    ],
  });
}

function signalQuote(quote: string): Paragraph {
  return new Paragraph({
    spacing: { line: 280, lineRule: 'auto', after: 60 },
    indent: { left: 360 },
    children: [
      new TextRun({
        text: `“${quote}”`,
        italics: true,
        size: SIZE.quote,
        color: AP.mute,
        font: FONT,
      }),
    ],
  });
}

function insufficientNote(): Paragraph {
  return new Paragraph({
    spacing: { line: 300, lineRule: 'auto', after: 60 },
    indent: { left: 200 },
    children: [
      new TextRun({
        text: '단서 부족 — 발화 누적이 더 필요했던 섹션',
        italics: true,
        size: SIZE.caption,
        color: AP.muteSoft,
        font: FONT,
      }),
    ],
  });
}

export type PersonaDocxInput = {
  persona: Partial<ProbingPersona> | null;
  starredQuestions: HistoryQuestion[];
  // Persona signals' transcript quotes, deduplicated by trimmed text.
  transcriptQuotes: string[];
  sessionMeta: {
    startedAt: Date | null;
    endedAt: Date;
    researchGoal?: string;
    keyResearchQuestion?: string;
  };
};

function formatDuration(startedAt: Date | null, endedAt: Date): string {
  if (!startedAt) return '—';
  const sec = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}초`;
  return `${m}분 ${s.toString().padStart(2, '0')}초`;
}

function formatDateKo(d: Date | null): string {
  if (!d) return '—';
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da} ${h}:${mi}`;
}

function techniqueLabel(t: HistoryQuestion['technique']): string {
  if (
    typeof t === 'string' &&
    (Object.keys(PROBING_TECHNIQUE_LABEL) as ProbingTechnique[]).includes(
      t as ProbingTechnique,
    )
  ) {
    return PROBING_TECHNIQUE_LABEL[t as ProbingTechnique];
  }
  return typeof t === 'string' ? t : '—';
}

export async function generatePersonaDocx(input: PersonaDocxInput): Promise<Blob> {
  const { persona, starredQuestions, transcriptQuotes, sessionMeta } = input;
  const children: FileChild[] = [];

  // ─── Title block ───────────────────────────────────────────────
  children.push(
    new Paragraph({
      spacing: { before: 0, after: 60 },
      children: [eyebrow('PERSONA · 응답자 분석 리포트')],
    }),
  );
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { before: 60, after: 240 },
      children: [
        new TextRun({
          text: '프로빙 인터뷰 페르소나',
          bold: true,
          size: SIZE.h1,
          color: AP.ink2,
          font: FONT,
        }),
      ],
    }),
  );

  children.push(
    metaLine('인터뷰 일시', formatDateKo(sessionMeta.startedAt)),
  );
  children.push(
    metaLine(
      '인터뷰 길이',
      formatDuration(sessionMeta.startedAt, sessionMeta.endedAt),
    ),
  );
  if (sessionMeta.researchGoal && sessionMeta.researchGoal.trim().length > 0) {
    children.push(metaLine('조사 목적', sessionMeta.researchGoal.trim()));
  }
  if (
    sessionMeta.keyResearchQuestion &&
    sessionMeta.keyResearchQuestion.trim().length > 0
  ) {
    children.push(
      metaLine('핵심 질문', sessionMeta.keyResearchQuestion.trim()),
    );
  }

  children.push(blank(160));
  children.push(thinRule(AP.amore, 160));

  // ─── 8-panel persona ──────────────────────────────────────────
  children.push(sectionHeader('응답자 페르소나'));

  const hasAnyPanel =
    persona !== null &&
    PROBING_PERSONA_SECTION_KEYS.some((k) => {
      const s = persona?.[k];
      return (
        s &&
        ((typeof s.summary === 'string' && s.summary.trim().length > 0) ||
          (Array.isArray(s.signals) && s.signals.length > 0))
      );
    });

  if (!hasAnyPanel) {
    children.push(
      new Paragraph({
        spacing: { line: 300, lineRule: 'auto', after: 120 },
        children: [
          new TextRun({
            text: '⚠ 발화가 충분히 누적되지 않아 페르소나 신호가 빈약합니다. 패널은 비어 있을 수 있습니다.',
            italics: true,
            size: SIZE.body,
            color: AP.muteSoft,
            font: FONT,
          }),
        ],
      }),
    );
  }

  for (const key of PROBING_PERSONA_SECTION_KEYS) {
    const sec = persona?.[key] ?? null;
    const meta = PANEL_META[key];
    const confidence: ProbingPersonaSection['confidence'] =
      sec?.confidence ?? 'insufficient';
    const summary = sec?.summary?.trim() ?? '';
    const signals = (sec?.signals ?? []).filter(
      (s) => typeof s?.bullet === 'string' && s.bullet.trim().length > 0,
    );
    const isInsufficient =
      confidence === 'insufficient' ||
      (summary.length === 0 && signals.length === 0);

    children.push(panelHeader(meta.icon, meta.title, confidence));
    if (isInsufficient) {
      children.push(insufficientNote());
      continue;
    }
    if (summary.length > 0) {
      children.push(summaryParagraph(summary));
    }
    for (const s of signals) {
      children.push(signalBullet(s.bullet.trim()));
      const q = s.quote?.trim();
      if (q && q.length > 0) {
        children.push(signalQuote(q));
      }
    }
  }

  // ─── Starred question chains ─────────────────────────────────
  children.push(blank(180));
  children.push(thinRule(AP.line, 160));
  children.push(sectionHeader('💡 인터뷰어 사고 흐름 — ★ 핵심 질문'));

  if (starredQuestions.length === 0) {
    children.push(
      new Paragraph({
        spacing: { line: 300, lineRule: 'auto', after: 120 },
        children: [
          new TextRun({
            text: '★ 로 마킹된 핵심 질문이 없습니다. (history 에서 핀하면 여기에 누적됩니다.)',
            italics: true,
            size: SIZE.body,
            color: AP.muteSoft,
            font: FONT,
          }),
        ],
      }),
    );
  } else {
    starredQuestions.forEach((q, i) => {
      children.push(
        new Paragraph({
          spacing: { before: 200, after: 60 },
          children: [
            new TextRun({
              text: `Chain ${i + 1}`,
              bold: true,
              size: SIZE.h3,
              color: AP.amore,
              font: FONT,
            }),
            new TextRun({
              text: `   · ${techniqueLabel(q.technique)}`,
              size: SIZE.caption,
              color: AP.muteSoft,
              font: FONT,
            }),
          ],
        }),
      );
      if (q.rationale && q.rationale.trim().length > 0) {
        children.push(
          new Paragraph({
            spacing: { line: 300, lineRule: 'auto', after: 40 },
            indent: { left: 200 },
            children: [
              new TextRun({
                text: '💡 가설 / 의미   ',
                bold: true,
                size: SIZE.caption,
                color: AP.muteSoft,
                font: FONT,
                characterSpacing: 20,
              }),
              new TextRun({
                text: q.rationale.trim(),
                size: SIZE.body,
                color: AP.ink2,
                font: FONT,
              }),
            ],
          }),
        );
      }
      children.push(
        new Paragraph({
          spacing: { line: 320, lineRule: 'auto', after: 120 },
          indent: { left: 200 },
          children: [
            new TextRun({
              text: '❓ 질문   ',
              bold: true,
              size: SIZE.caption,
              color: AP.muteSoft,
              font: FONT,
              characterSpacing: 20,
            }),
            new TextRun({
              text: q.text.trim(),
              size: SIZE.body,
              color: AP.ink2,
              font: FONT,
            }),
          ],
        }),
      );
    });
  }

  // ─── Cited transcript quotes ────────────────────────────────
  children.push(blank(180));
  children.push(thinRule(AP.line, 160));
  children.push(sectionHeader('📜 인용된 transcript 발화'));

  if (transcriptQuotes.length === 0) {
    children.push(
      new Paragraph({
        spacing: { line: 300, lineRule: 'auto', after: 120 },
        children: [
          new TextRun({
            text: '신호로 인용된 transcript 구절이 없습니다.',
            italics: true,
            size: SIZE.body,
            color: AP.muteSoft,
            font: FONT,
          }),
        ],
      }),
    );
  } else {
    for (const quote of transcriptQuotes) {
      children.push(
        new Paragraph({
          spacing: { line: 320, lineRule: 'auto', after: 80 },
          indent: { left: 200 },
          children: [
            new TextRun({
              text: `“${quote}”`,
              italics: true,
              size: SIZE.body,
              color: AP.ink2,
              font: FONT,
            }),
          ],
        }),
      );
    }
  }

  // ─── Footer ─────────────────────────────────────────────────
  children.push(blank(280));
  children.push(thinRule(AP.line, 80));
  children.push(
    new Paragraph({
      spacing: { before: 60 },
      alignment: AlignmentType.RIGHT,
      children: [eyebrow('AI Researcher · Probing Assistant', AP.muteSoft)],
    }),
  );

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: SIZE.body, color: AP.ink2 },
          paragraph: { spacing: { line: 320, lineRule: 'auto' } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}

// Build a filesystem-safe filename hint from persona demographics summary or
// a session UUID fallback. Falls back to 'persona' if neither is available.
export function buildPersonaFilename(input: {
  persona: Partial<ProbingPersona> | null;
  endedAt: Date;
  sessionId?: string;
}): string {
  const stamp = formatStampForFilename(input.endedAt);
  const hint = extractDemographicsHint(input.persona) ?? input.sessionId?.slice(0, 8) ?? 'persona';
  return `persona-${hint}-${stamp}.docx`;
}

function extractDemographicsHint(
  persona: Partial<ProbingPersona> | null,
): string | null {
  const demo = persona?.demographics;
  const raw = demo?.summary?.trim();
  if (!raw) return null;
  // Strip punctuation, collapse whitespace, keep first 24 chars of letters/digits.
  const cleaned = raw
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return cleaned.length > 0 ? cleaned : null;
}

function formatStampForFilename(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da}-${h}${mi}`;
}

// Collect deduplicated transcript quotes from persona signals. Order: by
// section order then signal order. Trimmed and de-duped by canonical lowercase.
export function collectTranscriptQuotes(
  persona: Partial<ProbingPersona> | null,
): string[] {
  if (!persona) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of PROBING_PERSONA_SECTION_KEYS) {
    const sec = persona[key];
    if (!sec || !Array.isArray(sec.signals)) continue;
    for (const s of sec.signals) {
      const q = typeof s?.quote === 'string' ? s.quote.trim() : '';
      if (q.length === 0) continue;
      const key2 = q.toLowerCase();
      if (seen.has(key2)) continue;
      seen.add(key2);
      out.push(q);
    }
  }
  return out;
}
