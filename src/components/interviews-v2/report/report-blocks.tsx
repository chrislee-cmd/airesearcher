'use client';

/* ────────────────────────────────────────────────────────────────────
   ReportBlocks — 읽기 모드 보고서 블록 렌더러 11종 (fresh · BUILD-SPEC §1.3
   필수표 · GEOMETRY §C · S3 .dc.html 비주얼 SSOT).

   기존 topline-blocks.tsx(superseded — 편집 금지)의 프레젠테이션을 대체하는 새
   컴포넌트. 데이터 계약(ToplineBlock)은 그대로 받는 dumb 렌더러다. 편집(Section
   Gap·drag-to-ask·인라인 편집)은 C2 — 여기엔 없다.

   좌측 거터 mono 라벨(exec summary/para/table…)은 .dc.html 의 컴프 주석이므로
   구현하지 않는다(거터 폭 0). 본문 컬럼은 764px 고정·가운데 정렬(§C1).

   렌더러 소관 파생(프롬프트 무변경 — DECISIONS):
   - heading 번호 chip: exec 제외 순번(01, 02…).
   - insight 라벨: "발견" / 교차분석 절 이후 "대조 N".
   - 표/그림 번호: "표 N" · "그림 N" 순번.
   - table 차이 열: 마지막 열이 "차이" 면 rose-bg + |Δ|≥15%p 강조.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { ToplineBlock } from '@/lib/interview-v2/types';
import { ReportProse } from './report-prose';
import { ReportChart } from './report-chart';

// 풀뷰 헤더 타이틀과 동일한 Outfit display 폰트 소스(런타임 var). font-display
// 유틸이 없어 인라인으로 소비(FullviewHeader 선례).
const DISPLAY_FONT = { fontFamily: 'var(--font-outfit), var(--font-sans)' } as const;

// md 에서 표시용 plain 텍스트만 뽑는다(heading 제목·toc 라벨·교차분석 감지용).
function plainText(md?: string): string {
  return (md ?? '')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s*\[[^\]\n]+\](?!\()/g, '')
    .trim();
}

// 교차분석 절 진입 감지 — heading 텍스트가 교차/대조 키워드를 담으면 이후
// insight 라벨을 "대조 N"으로. 로케일 키워드 목록(보수적 — 매칭 실패 시 전부
// "발견"으로 폴백, 회귀 없음).
const CROSS_KEYWORDS =
  /교차\s*분석|교차분석|대조|cross[-\s]?analysis|クロス分析|การวิเคราะห์เชิงเปรียบเทียบ/i;

// ── toc ────────────────────────────────────────────────────────────
export type TocItem = { id: string; label: string; num: number | null };

// exec + heading 을 목차 항목으로. heading 번호(exec 제외 순번)를 붙인다.
export function buildToc(blocks: ToplineBlock[], execLabel: string): TocItem[] {
  const items: TocItem[] = [];
  let headingNo = 0;
  for (const b of blocks) {
    if (b.type === 'executive_summary') {
      items.push({ id: b.id, label: execLabel, num: null });
    } else if (b.type === 'heading') {
      headingNo += 1;
      items.push({
        id: b.id,
        label: plainText(b.md) || `#${headingNo}`,
        num: headingNo,
      });
    }
  }
  return items;
}

// 2자리 zero-pad 번호.
const pad2 = (n: number) => String(n).padStart(2, '0');

// 블록 간 수직 리듬(§C2) — 타입/직전 타입 기준 margin-top.
function marginTop(type: string, prev: string | null): string {
  if (prev === null) return '';
  if (type === 'heading') return 'mt-11'; // 44
  if (type === 'insight' && prev === 'insight') return 'mt-3.5'; // 14
  if (prev === 'heading') return 'mt-[18px]';
  if (prev === 'subheading') return 'mt-3'; // 12
  return 'mt-5'; // 20
}

// ── 개별 렌더러 ─────────────────────────────────────────────────────

function ExecutiveSummary({
  block,
  execLabel,
  metaRight,
}: {
  block: ToplineBlock;
  execLabel: string;
  metaRight: string;
}) {
  const summary = block.summary?.trim() ?? '';
  const keyPoints = (block.key_points ?? []).filter((p) => p.trim());
  return (
    <div
      id={block.id}
      className="overflow-hidden rounded-sm border-[2.5px] border-ink bg-rose-bg shadow-memphis-lg-faint"
    >
      <div className="flex items-center gap-[9px] border-b-[1.5px] border-line-strong bg-paper px-5 py-[9px]">
        <span className="font-mono-label text-xs font-extrabold uppercase tracking-[0.16em] text-amore-deep">
          {execLabel}
        </span>
        <span className="ml-auto font-mono-label text-xs text-mute-soft">
          {metaRight}
        </span>
      </div>
      <div className="flex flex-col gap-[15px] p-5">
        {block.title && (
          <div
            className="text-3xl font-extrabold leading-[1.4] tracking-[-0.4px] text-ink"
            style={DISPLAY_FONT}
          >
            {block.title}
          </div>
        )}
        {summary && (
          <div className="text-xl leading-[1.85] text-ink-2">
            <ReportProse md={summary} citations={block.citations} />
          </div>
        )}
        {keyPoints.length > 0 && (
          <div className="flex flex-col gap-2 border-t-[1.5px] border-line-strong pt-3.5">
            {keyPoints.map((point, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className="shrink-0 text-lg leading-[1.65] text-amore-deep"
                >
                  ✦
                </span>
                <span className="text-lg leading-[1.65] text-ink">{point}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Heading({ block, num }: { block: ToplineBlock; num: number }) {
  return (
    <div
      id={block.id}
      className="flex items-baseline gap-3 border-b-2 border-ink pb-2.5"
    >
      <span className="shrink-0 rounded-chip bg-ink px-2 py-[3px] font-mono-label text-sm font-extrabold text-paper">
        {pad2(num)}
      </span>
      <span
        className="text-3xl font-extrabold leading-[1.3] tracking-[-0.5px] text-ink"
        style={DISPLAY_FONT}
      >
        {plainText(block.md)}
      </span>
    </div>
  );
}

function Subheading({ block }: { block: ToplineBlock }) {
  return (
    <div className="flex items-center gap-[9px]">
      <span className="h-[17px] w-[3px] shrink-0 rounded-2xs bg-amore" />
      <span className="text-xl font-extrabold text-ink">
        {plainText(block.md)}
      </span>
    </div>
  );
}

function Paragraph({ block }: { block: ToplineBlock }) {
  return (
    <div className="text-lg leading-[1.85] text-ink-2">
      <ReportProse md={block.md} citations={block.citations} />
    </div>
  );
}

function Insight({ block, label }: { block: ToplineBlock; label: string }) {
  return (
    <div className="flex gap-[13px] rounded-panel border-2 border-ink bg-paper-soft px-[18px] py-[15px]">
      <span className="shrink-0 pt-[3px] font-mono-label text-xs font-extrabold uppercase tracking-[0.14em] text-amber-text">
        {label}
      </span>
      <div className="min-w-0 text-lg leading-[1.8] text-ink">
        <ReportProse md={block.md} citations={block.citations} />
      </div>
    </div>
  );
}

function Quote({ block }: { block: ToplineBlock }) {
  return (
    <div className="flex gap-3.5 rounded-r-panel border-l-[3px] border-amore bg-rose-bg px-5 py-4">
      <span
        aria-hidden
        className="shrink-0 text-4xl font-extrabold leading-[0.9] text-amore"
        style={DISPLAY_FONT}
      >
        &ldquo;
      </span>
      <div className="min-w-0">
        {/* italic 없음(의도된 변경 §1.3) · 본문은 body 보다 한 단계 큰 text-xl */}
        <div className="text-xl leading-[1.8] text-ink">
          <ReportProse md={block.md} citations={block.citations} />
        </div>
        {block.attribution && (
          <div className="mt-2.5 font-mono-label text-xs text-mute-soft">
            {block.attribution}
          </div>
        )}
      </div>
    </div>
  );
}

// 표 — 마지막 열이 "차이" 면 세그먼트 표로 보고 rose-bg + |Δ| 강조.
const DIFF_HEADER = /^\s*(차이|diff(erence)?|Δ|差|ความแตกต่าง)\s*$/i;
// 셀 값에서 숫자 크기(%p·% 등 접미 무시) — |Δ|≥15 강조 판정용.
function magnitude(cell: string): number | null {
  const m = cell.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Math.abs(Number.parseFloat(m[0])) : null;
}

function Table({
  block,
  label,
}: {
  block: ToplineBlock;
  label: string;
}) {
  if (!block.table) return null;
  const { headers, rows } = block.table;
  const diffCol =
    headers.length > 0 && DIFF_HEADER.test(headers[headers.length - 1])
      ? headers.length - 1
      : -1;
  const caption = plainText(block.md);
  return (
    <div>
      <div className="mb-2 font-mono-label text-xs uppercase tracking-[0.14em] text-mute-soft">
        {label}
        {caption ? ` · ${caption}` : ''}
      </div>
      <div className="overflow-hidden rounded-panel border-2 border-ink bg-paper shadow-memphis-md-faint">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-paper-soft">
              {headers.map((h, i) => (
                <th
                  key={i}
                  className={`border-b-2 border-ink px-3.5 py-2.5 font-mono-label text-xs font-extrabold uppercase tracking-[0.12em] text-mute ${
                    i === 0 ? 'text-left' : 'text-right'
                  } ${i === diffCol ? 'bg-rose-bg' : ''}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr
                key={r}
                className={r % 2 === 1 ? 'bg-surface-canvas' : undefined}
              >
                {row.map((cell, c) => {
                  const isDiff = c === diffCol;
                  const mag = isDiff ? magnitude(cell) : null;
                  const emphasis =
                    mag === null
                      ? 'text-ink'
                      : mag >= 15
                        ? 'font-extrabold text-amore-deep'
                        : mag < 5
                          ? 'font-bold text-mute-soft'
                          : 'text-ink';
                  return (
                    <td
                      key={c}
                      className={`border-b border-line px-3.5 py-2.5 text-md ${
                        c === 0
                          ? 'text-ink'
                          : `text-right tabular-nums ${emphasis}`
                      } ${isDiff ? 'bg-rose-bg' : ''}`}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.description && (
        <div className="mt-2 font-mono-label text-xs leading-[1.6] text-faint">
          {block.description}
        </div>
      )}
    </div>
  );
}

function Chart({
  block,
  eyebrow,
}: {
  block: ToplineBlock;
  eyebrow: string;
}) {
  const kind = block.type === 'pie' ? 'pie' : (block.chartKind ?? 'bar');
  return (
    <ReportChart
      kind={kind}
      eyebrow={eyebrow}
      title={block.title}
      data={block.data}
      description={block.description}
    />
  );
}

// 삽입 블록(qa/section) 공용 프레임 — dashed(사용자 생성물 표식, 파스텔 정체성
// 금지). 헤더 스트립 + 본문.
function InsertedFrame({
  chip,
  metaRight,
  children,
}: {
  chip: string;
  metaRight?: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-panel border-2 border-dashed border-ink/30 bg-paper-soft">
      <div className="flex items-center gap-2 border-b-[1.5px] border-dashed border-ink/20 bg-paper px-4 py-[9px]">
        <span className="rounded-nav border-[1.4px] border-ink/20 bg-paper-soft px-[7px] py-0.5 font-mono-label text-xs font-extrabold uppercase tracking-[0.1em] text-mute">
          {chip}
        </span>
        {metaRight && (
          <span className="ml-auto truncate font-mono-label text-xs text-faint">
            {metaRight}
          </span>
        )}
      </div>
      <div className="px-[18px] py-[15px]">{children}</div>
    </div>
  );
}

function InsertedQa({ block, t }: { block: ToplineBlock; t: Tr }) {
  return (
    <InsertedFrame chip={t('reportInsertedQa')}>
      <div className="flex flex-col gap-3">
        {block.selected_excerpt && (
          <div className="border-l-2 border-ink/20 pl-3 text-md leading-[1.7] text-mute">
            {t('reportSelectedExcerpt')} · &ldquo;{block.selected_excerpt}&rdquo;
          </div>
        )}
        {block.question && (
          <div className="text-lg font-extrabold leading-[1.6] text-ink">
            Q. {block.question}
          </div>
        )}
        <div className="text-lg leading-[1.8] text-ink-2">
          <ReportProse md={block.md} citations={block.citations} />
        </div>
      </div>
    </InsertedFrame>
  );
}

function InsertedSection({ block, t }: { block: ToplineBlock; t: Tr }) {
  return (
    <InsertedFrame
      chip={t('reportInsertedSection')}
      metaRight={
        block.prompt
          ? `${t('reportSectionPrompt')}: "${block.prompt}"`
          : undefined
      }
    >
      <div className="text-lg leading-[1.8] text-ink-2">
        <ReportProse md={block.md} citations={block.citations} />
      </div>
    </InsertedFrame>
  );
}

// t() 시그니처(느슨) — 삽입 렌더러에 상위 t 를 넘겨 훅 규칙(루프 내 훅 금지)을
// 피한다.
type Tr = (key: string, values?: Record<string, string | number>) => string;

// ── 조립 ────────────────────────────────────────────────────────────

// 블록별 파생 메타(순번·라벨·마진). 렌더 밖 순수 함수에서 카운터를 돌려
// react-hooks/immutability(JSX map 내 재할당 금지)를 피한다.
type BlockMeta =
  | { kind: 'exec' }
  | { kind: 'heading'; num: number }
  | { kind: 'subheading' }
  | { kind: 'paragraph' }
  | { kind: 'insight'; label: string }
  | { kind: 'quote' }
  | { kind: 'table'; label: string }
  | { kind: 'chart'; eyebrow: string }
  | { kind: 'qa' }
  | { kind: 'section' }
  | { kind: 'skip' };

function planBlocks(
  blocks: ToplineBlock[],
  t: Tr,
): { block: ToplineBlock; mt: string; meta: BlockMeta }[] {
  const plan: { block: ToplineBlock; mt: string; meta: BlockMeta }[] = [];
  let headingNo = 0;
  let tableNo = 0;
  let figureNo = 0;
  let crossMode = false;
  let contrastNo = 0;
  let prevType: string | null = null;
  for (const b of blocks) {
    if (b.type === 'heading' && CROSS_KEYWORDS.test(plainText(b.md))) {
      crossMode = true;
    }
    const mt = marginTop(b.type, prevType);
    let meta: BlockMeta;
    switch (b.type) {
      case 'executive_summary':
        meta = { kind: 'exec' };
        break;
      case 'heading':
        headingNo += 1;
        meta = { kind: 'heading', num: headingNo };
        break;
      case 'subheading':
        meta = { kind: 'subheading' };
        break;
      case 'paragraph':
        meta = { kind: 'paragraph' };
        break;
      case 'insight':
        if (crossMode) {
          contrastNo += 1;
          meta = {
            kind: 'insight',
            label: `${t('reportInsightContrast')} ${contrastNo}`,
          };
        } else {
          meta = { kind: 'insight', label: t('reportInsightFound') };
        }
        break;
      case 'quote':
        meta = { kind: 'quote' };
        break;
      case 'table':
        tableNo += 1;
        meta = { kind: 'table', label: t('reportTableLabel', { n: tableNo }) };
        break;
      case 'chart':
      case 'pie': {
        figureNo += 1;
        const kindLabel =
          b.type === 'pie' ? t('reportChartPie') : t('reportChartBar');
        meta = {
          kind: 'chart',
          eyebrow: `${t('reportFigureLabel', { n: figureNo })} · ${kindLabel}`,
        };
        break;
      }
      case 'inserted_qa':
        meta = { kind: 'qa' };
        break;
      case 'inserted_section':
        meta = { kind: 'section' };
        break;
      default:
        meta = { kind: 'skip' };
    }
    plan.push({ block: b, mt, meta });
    prevType = b.type;
  }
  return plan;
}

function renderBlock(
  block: ToplineBlock,
  meta: BlockMeta,
  t: Tr,
  execLabel: string,
  metaRight: string,
): ReactNode {
  switch (meta.kind) {
    case 'exec':
      return (
        <ExecutiveSummary
          block={block}
          execLabel={execLabel}
          metaRight={metaRight}
        />
      );
    case 'heading':
      return <Heading block={block} num={meta.num} />;
    case 'subheading':
      return <Subheading block={block} />;
    case 'paragraph':
      return <Paragraph block={block} />;
    case 'insight':
      return <Insight block={block} label={meta.label} />;
    case 'quote':
      return <Quote block={block} />;
    case 'table':
      return <Table block={block} label={meta.label} />;
    case 'chart':
      return <Chart block={block} eyebrow={meta.eyebrow} />;
    case 'qa':
      return <InsertedQa block={block} t={t} />;
    case 'section':
      return <InsertedSection block={block} t={t} />;
    default:
      return null;
  }
}

export function ReportBody({
  blocks,
  metaRight,
}: {
  blocks: ToplineBlock[];
  // executive_summary 우측 메타 = "n=N · 전수 순회 · 모델".
  metaRight: string;
}) {
  const t = useTranslations('InterviewsV2') as unknown as Tr;
  const execLabel = t('reportExecLabel');
  const plan = planBlocks(blocks, t);
  return (
    <article className="mx-auto flex w-[var(--iv-body-col-w)] max-w-full flex-col">
      {plan.map(({ block, mt, meta }) => (
        <div key={block.id} className={mt}>
          {renderBlock(block, meta, t, execLabel, metaRight)}
        </div>
      ))}
    </article>
  );
}
