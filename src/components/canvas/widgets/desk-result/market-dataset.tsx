'use client';

import { useMemo, type ReactNode } from 'react';
import type { useTranslations } from 'next-intl';
import type { DeskJob } from '@/components/desk-job-provider';
import type { DeskAccent, DeskEmphasis } from '@/lib/desk-report-parser';
import { DeskReportView } from './desk-report-view';
import { DeskMarkdownBody } from './desk-markdown';
import { SectionCard } from './section-card';

type TDesk = ReturnType<typeof useTranslations<'Desk'>>;

// 시장조사 mode 결과 뷰 — 표준 "시장규모 보고서" shape. 트렌드/커스텀 mode 의
// 텍스트 나열과 달리, market mode 는 관례적 6 섹션(핵심 지표 KPI 히어로 →
// 요약 → 규모 계층 → 기업 매출 → 성장·전망 → 근거)으로 조립하고 **숫자를
// 주인공**으로 렌더한다 (조/억 주 표기 · tabular-nums · 수치 우측 정렬 · ▲/▼
// 증감 색 · 확보 실패 = 회색 dash).
//
// 데이터 소스는 LLM markdown(job.output) 하나뿐이라 (market.ts 는 다른 PR 소유 —
// 별도 구조화 컬럼 없음), 여기서 desk-market-prompt.ts 가 고정한 6 heading +
// GFM 표를 클라이언트에서 파싱한다. 파싱이 market shape 를 못 잡으면 (구 job /
// 형식 이탈) 기존 disclaimer + 공용 DeskReportView 로 회귀 — UI 깨짐 0.
//
// 소유권: 이 파일 + desk-result/index.tsx 의 mode branch 만 market PR 소유.

// ── 파싱 ────────────────────────────────────────────────────────────
type MarketKind =
  | 'kpi'
  | 'summary'
  | 'tier'
  | 'companies'
  | 'outlook'
  | 'sources';

type MarketTable = { headers: string[]; rows: string[][] };

type MarketSection = {
  kind: MarketKind;
  icon: string;
  title: string;
  body: string; // 표 라인을 제외한 markdown 본문
  table: MarketTable | null;
};

type MarketReport = { title: string; sections: MarketSection[] };

const KIND_ICON: Record<MarketKind, string> = {
  kpi: '📈',
  summary: '📝',
  tier: '🧱',
  companies: '🏢',
  outlook: '📊',
  sources: '📚',
};

// 섹션 카드 톤 — accent chip 색 + 강조(padding/타이틀). SectionCard 가 소유한
// 실재 토큰만 사용 (desk-report-parser 의 DeskAccent).
const KIND_CARD: Record<MarketKind, { accent: DeskAccent; emphasis: DeskEmphasis }> = {
  kpi: { accent: 'amore', emphasis: 'large' },
  summary: { accent: 'amore', emphasis: 'large' },
  tier: { accent: 'success', emphasis: 'large' },
  companies: { accent: 'peach', emphasis: 'large' },
  outlook: { accent: 'warning', emphasis: 'large' },
  sources: { accent: 'mute-soft', emphasis: 'small' },
};

// heading → kind. 아이콘이 1차 신호(prompt 가 고정), 없으면 키워드 fallback.
const ICON_TO_KIND: { icon: string; kind: MarketKind }[] = [
  { icon: '📈', kind: 'kpi' },
  { icon: '📝', kind: 'summary' },
  { icon: '🧱', kind: 'tier' },
  { icon: '🏢', kind: 'companies' },
  { icon: '📊', kind: 'outlook' },
  { icon: '📚', kind: 'sources' },
];

const KEYWORD_TO_KIND: { re: RegExp; kind: MarketKind }[] = [
  { re: /핵심\s*지표|key\s*metrics/i, kind: 'kpi' },
  { re: /핵심\s*요약|executive|요약|summary/i, kind: 'summary' },
  { re: /계층|tam.*sam|tier/i, kind: 'tier' },
  { re: /기업\s*매출|주요\s*기업|공시|compan|revenue/i, kind: 'companies' },
  { re: /성장|전망|growth|outlook|forecast/i, kind: 'outlook' },
  { re: /근거\s*자료|근거|출처|source|reference|appendix/i, kind: 'sources' },
];

function classifyMarket(title: string): MarketKind | null {
  for (const { icon, kind } of ICON_TO_KIND) if (title.includes(icon)) return kind;
  for (const { re, kind } of KEYWORD_TO_KIND) if (re.test(title)) return kind;
  return null;
}

// 선두 이모지 1개 분리 (variation selector 포함). 실패 시 빈 문자열.
function splitLeadingEmoji(raw: string): { icon: string; rest: string } {
  const m =
    /^\s*([\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]️?)\s*(.*)$/u.exec(
      raw,
    );
  if (m) return { icon: m[1].replace(/️/g, '') || m[1], rest: m[2].trim() };
  return { icon: '', rest: raw.trim() };
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

// 본문에서 첫 GFM 표 한 개를 떼어낸다 — `| … |` 헤더 + `|---|` 구분선 + 데이터
// 행 블록. 표를 뺀 나머지 라인은 body 로 돌려준다.
function extractTable(bodyLines: string[]): {
  table: MarketTable | null;
  rest: string[];
} {
  const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l: string) =>
    l.includes('-') && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(l);

  let start = -1;
  for (let i = 0; i < bodyLines.length - 1; i++) {
    if (isRow(bodyLines[i]) && isSep(bodyLines[i + 1])) {
      start = i;
      break;
    }
  }
  if (start === -1) return { table: null, rest: bodyLines };

  let end = start + 2;
  while (end < bodyLines.length && isRow(bodyLines[end])) end++;

  const headers = splitRow(bodyLines[start]);
  const rows = bodyLines
    .slice(start + 2, end)
    .map(splitRow)
    .filter((r) => r.some((c) => c.length > 0));
  const rest = [...bodyLines.slice(0, start), ...bodyLines.slice(end)];
  return { table: { headers, rows }, rest };
}

function parseMarketReport(md: string): MarketReport | null {
  const source = (md ?? '').trim();
  if (!source) return null;

  const lines = source.split('\n');
  let title = '';
  const raws: { title: string; body: string[] }[] = [];
  let cur: { title: string; body: string[] } | null = null;
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h2 = !inFence ? /^##\s+(.+?)\s*$/.exec(line) : null;
    const h1 = !inFence ? /^#\s+(.+?)\s*$/.exec(line) : null;
    if (h2) {
      if (cur) raws.push(cur);
      cur = { title: h2[1].trim(), body: [] };
    } else if (h1 && !cur && !title) {
      title = h1[1].trim();
    } else if (cur) {
      cur.body.push(line);
    }
    // 첫 H2 앞 preamble 은 무시 (표지 문구는 title 로 잡음).
  }
  if (cur) raws.push(cur);

  const sections: MarketSection[] = [];
  const seen = new Set<MarketKind>();
  for (const raw of raws) {
    const kind = classifyMarket(raw.title);
    if (!kind || seen.has(kind)) continue;
    seen.add(kind);
    const { icon, rest } = splitLeadingEmoji(raw.title);
    const { table, rest: bodyLines } = extractTable(raw.body);
    sections.push({
      kind,
      icon: icon || KIND_ICON[kind],
      title: rest || raw.title,
      body: bodyLines.join('\n').trim(),
      table,
    });
  }

  // 6 섹션 중 2개 이상 인식돼야 market shape 로 판단. 아니면 fallback.
  if (sections.length < 2) return null;
  return { title, sections };
}

// ── 셀 렌더 (숫자 가독성 규칙) ────────────────────────────────────────
// "데이터 확보 실패" / 빈칸 / dash 판정 — 실패는 빨간 에러가 아니라 회색 dash.
function isMissing(cell: string): boolean {
  const t = cell.trim();
  return (
    t === '' ||
    t === '—' ||
    t === '-' ||
    /데이터\s*확보\s*실패/i.test(t) ||
    /^n\/?a$/i.test(t)
  );
}

// markdown 링크 `[text](url)` 를 <a> 로. 나머지는 텍스트 그대로.
function renderInline(text: string): ReactNode {
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <a
        key={key++}
        href={m[2]}
        target="_blank"
        rel="noopener noreferrer"
        className="text-amore underline decoration-amore/40 underline-offset-2 hover:decoration-amore"
      >
        {m[1]}
      </a>,
    );
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

function CellContent({ text }: { text: string }) {
  const t = text.trim();
  if (isMissing(t)) {
    const reason = /데이터\s*확보\s*실패\s*\(([^)]*)\)/i.exec(t)?.[1];
    return (
      <span className="text-mute-soft">
        —
        {reason && (
          <span className="ml-1 text-xs text-mute-soft">({reason})</span>
        )}
      </span>
    );
  }
  // 증감 방향 색 — 상승 success, 하락 amore (기존 palette. 임의 색 X).
  const dir = t.startsWith('▲')
    ? 'text-success'
    : t.startsWith('▼')
      ? 'text-amore'
      : '';
  return <span className={dir}>{renderInline(t)}</span>;
}

// 셀이 수치성인지 — 링크(텍스트열) 아니고 숫자/단위/증감 기호 포함.
function isNumericText(t: string): boolean {
  if (/\[[^\]]+\]\([^)]+\)/.test(t)) return false;
  return /[▲▼]/.test(t) || /\d[조억]/.test(t) || /^\s*[+\-]?[\d.,]+\s*(조|억|원|%|명|건|배|위)?/.test(t);
}

// 컬럼 단위 정렬 — 데이터 셀 과반이 수치면 우측 정렬 + tabular-nums.
function columnNumeric(table: MarketTable, col: number): boolean {
  const cells = table.rows
    .map((r) => r[col] ?? '')
    .filter((c) => !isMissing(c));
  if (cells.length === 0) return true; // 전부 missing → dash 우측
  return cells.filter(isNumericText).length * 2 >= cells.length;
}

function MarketTableView({ table }: { table: MarketTable }) {
  if (table.headers.length === 0 || table.rows.length === 0) return null;
  const numeric = table.headers.map((_, c) => columnNumeric(table, c));
  return (
    <div className="overflow-x-auto rounded-xs border border-line">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-white text-xs uppercase tracking-[.16em] text-mute-soft">
          <tr>
            {table.headers.map((h, c) => (
              <th
                key={c}
                className={`border-b border-line px-3 py-2 font-medium text-mute ${
                  numeric[c] ? 'text-right' : 'text-left'
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r} className="text-ink-2">
              {table.headers.map((_, c) => (
                <td
                  key={c}
                  className={`border-b border-line-soft px-3 py-2 align-top ${
                    numeric[c]
                      ? 'text-right font-medium tabular-nums'
                      : 'text-left'
                  }`}
                >
                  <CellContent text={row[c] ?? ''} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ① KPI 히어로 — 지표별 카드. 수치가 최대 요소(text-3xl tabular-nums), 라벨/
// 대상/기간은 작게. 위치 기반 매핑(방어적): [지표, 값, 대상, 기간, 출처].
function KpiHero({ table }: { table: MarketTable }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {table.rows.map((row, i) => {
        const label = row[0] ?? '';
        const value = row[1] ?? '';
        const subject = row[2] ?? '';
        const period = row[3] ?? '';
        const source = row[4] ?? '';
        const missing = isMissing(value);
        const v = value.trim();
        const dir = v.startsWith('▲')
          ? 'text-success'
          : v.startsWith('▼')
            ? 'text-amore'
            : 'text-ink';
        const sub = [subject, period].filter((x) => x && !isMissing(x));
        return (
          <div
            key={i}
            // eslint-disable-next-line no-restricted-syntax -- DS-2 가 정확 일치 memphis 토큰 부재로 유지한 잔존(ink 색 오프셋 shadow + 3px 폭 — 새 토큰 임의 신설 금지). DS-6 lint gate baseline.
            className="rounded-sm border-[3px] border-ink bg-paper p-4 shadow-[4px_4px_0_var(--color-ink)]"
          >
            <div className="text-xs font-semibold uppercase tracking-[.16em] text-mute">
              {label || '지표'}
            </div>
            <div
              className={`mt-2 text-3xl font-bold tracking-[-0.02em] tabular-nums ${
                missing ? 'text-mute-soft' : dir
              }`}
            >
              {missing ? '—' : renderInline(v)}
            </div>
            {sub.length > 0 && (
              <div className="mt-1.5 text-xs text-mute">{sub.join(' · ')}</div>
            )}
            {source && !isMissing(source) && (
              <div className="mt-2 text-xs">{renderInline(source)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MarketSectionCard({ section }: { section: MarketSection }) {
  const meta = KIND_CARD[section.kind];
  const collapsible = section.kind === 'sources';
  return (
    <SectionCard
      id={`market-sec-${section.kind}`}
      icon={section.icon}
      title={section.title}
      emphasis={meta.emphasis}
      accent={meta.accent}
      collapsible={collapsible}
      defaultOpen={!collapsible}
      meta={
        section.table && section.table.rows.length > 0
          ? `${section.table.rows.length}행`
          : undefined
      }
    >
      {section.body && (
        <div className={section.table ? 'mb-3' : ''}>
          <DeskMarkdownBody source={section.body} compact />
        </div>
      )}
      {section.table && <MarketTableView table={section.table} />}
    </SectionCard>
  );
}

// 신 shape 인식 실패 시 회귀용 — 기존 참고 데이터 disclaimer.
function Disclaimer() {
  return (
    <div className="rounded-sm border border-warning-line bg-warning-bg px-4 py-3 text-sm text-ink-2">
      <span className="font-semibold">⚠️ TAM/SAM 참고 데이터</span>
      <p className="mt-1 leading-[1.6] text-mute">
        아래 시장 규모 수치는 확정값이 아니라 출처가 명시된 참고 데이터입니다. 각
        수치의 근거(통계·공시·기사)를 직접 확인한 뒤 TAM/SAM 을 판단하세요.
        근거를 확보하지 못한 항목은 “데이터 확보 실패”로 표기됩니다.
      </p>
    </div>
  );
}

export function MarketDataset({ job, tDesk }: { job: DeskJob; tDesk: TDesk }) {
  const report = useMemo(() => parseMarketReport(job.output ?? ''), [job.output]);

  // 신 6-섹션 shape 인식 실패 (구 job / 형식 이탈) → disclaimer + 공용 뷰 회귀.
  if (!report) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 px-5 pt-4">
          <Disclaimer />
        </div>
        <DeskReportView job={job} tDesk={tDesk} />
      </div>
    );
  }

  const kpi = report.sections.find(
    (s) => s.kind === 'kpi' && s.table && s.table.rows.length > 0,
  );
  const rest = report.sections.filter((s) => s !== kpi);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
      {report.title && (
        <h2 className="mb-4 text-xl font-bold tracking-[-0.02em] text-ink">
          {report.title}
        </h2>
      )}

      {/* ① KPI 히어로 (3 카드) */}
      {kpi?.table && (
        <div className="mb-4">
          <KpiHero table={kpi.table} />
        </div>
      )}

      {/* 참고 데이터 경고 한 줄 */}
      <div className="mb-5 flex items-start gap-2 rounded-sm border border-warning-line bg-warning-bg px-4 py-2.5 text-sm">
        <span aria-hidden>⚠️</span>
        <p className="leading-[1.6] text-mute">
          <span className="font-semibold text-ink-2">
            참고 데이터 — 확정값이 아닙니다.
          </span>{' '}
          각 수치의 출처(통계·공시·기사)를 직접 확인한 뒤 TAM/SAM 을 판단하세요.
          근거를 확보하지 못한 항목은 <span className="text-mute-soft">—</span>{' '}
          으로 표기됩니다.
        </p>
      </div>

      {/* ②~⑥ 섹션 카드 */}
      <div className="grid grid-cols-1 gap-4">
        {rest.map((s) => (
          <MarketSectionCard key={s.kind} section={s} />
        ))}
      </div>
    </div>
  );
}
