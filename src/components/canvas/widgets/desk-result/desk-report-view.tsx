'use client';

import { useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type {
  DeskClaim,
  DeskJob,
  DeskRevenueSeries,
} from '@/components/desk-job-provider';
import type { DeskSkipReason } from '@/lib/desk-sources';
import { DeskAnalyticsPanel } from '@/components/desk-analytics-panel';
import {
  parseDeskReport,
  type DeskParsedSection,
} from '@/lib/desk-report-parser';
import { DeskMarkdownBody } from './desk-markdown';
import { RevenueChart } from './revenue-chart';
import { SectionCard } from './section-card';
import { TopicCard } from './topic-card';
import { RQCard } from './rq-card';
import { SectionNav, type NavItem } from './section-nav';

type TDesk = ReturnType<typeof useTranslations<'Desk'>>;

// "주요 기업 매출" 섹션 식별 — 이 섹션 상단에 구조화 매출 grouped bar 를 얹는다
// (#461). market 리포트 prompt 가 고정 발행하는 heading("🏢 주요 기업 매출" /
// 영어 "Key Company Revenue")을 이모지 제거 후 title 로 매칭한다. 매칭 실패해도
// wide 테이블은 그대로 렌더되므로 회귀는 없다(차트만 그 섹션에 안 붙음).
function isRevenueSection(title: string): boolean {
  return /주요\s*기업\s*매출|기업\s*매출|주요\s*상장사\s*매출|company\s*revenue|key\s*compan/i.test(
    title,
  );
}

// 데스크 결과 보고서 위젯 grid — 좌측 섹션 nav (scroll-spy) + 우측 섹션별
// Memphis 카드 grid. LLM markdown (job.output) 을 섹션으로 파싱해 카드로
// 펼치되, RQ / Quant 는 구조화 데이터 (job.rq_answers / claims / analytics)
// 를 우선 사용해 confidence·표·차트를 안정적으로 렌더한다.
//
// 파싱이 인식 섹션 0 이면 (약식/raw-dump/형식 이탈) raw markdown 한 덩이로
// fallback — UI 깨짐 0 (회귀 가드).
export function DeskReportView({
  job,
  tDesk,
}: {
  job: DeskJob;
  tDesk: TDesk;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const parsed = useMemo(
    () => parseDeskReport(job.output ?? ''),
    [job.output],
  );

  const hasArticles = !!(job.articles && job.articles.length > 0);
  const hasCharts = !!(job.analytics && job.analytics.charts.length > 0);
  // 구조화 매출 시계열 (코드 emit) — "주요 기업 매출" 섹션 상단 grouped bar 용.
  const revenueSeries = useMemo(
    () => job.analytics?.revenueSeries ?? [],
    [job.analytics],
  );
  const quantClaims = useMemo(
    () =>
      (job.claims ?? []).filter(
        (c): c is Extract<DeskClaim, { kind: 'quant' }> => c.kind === 'quant',
      ),
    [job.claims],
  );
  const rqById = useMemo(
    () => new Map((job.rq_answers ?? []).map((a) => [a.rq_id, a])),
    [job.rq_answers],
  );
  const hasStructuredRq = !!(
    job.research_questions && job.research_questions.length > 0
  );

  // nav 항목 — 파싱 섹션 + 구조화 전용 카드 (수집 원자료). fallback 시엔
  // 단일 항목.
  const navItems: NavItem[] = useMemo(() => {
    const items: NavItem[] = parsed.ok
      ? parsed.sections.map((s) => ({
          id: s.id,
          icon: s.icon,
          title: s.title,
        }))
      : [{ id: 'desk-sec-report', icon: '📄', title: tDesk('reportTitle') }];
    if (hasArticles) {
      items.push({ id: 'desk-sec-articles', icon: '🗂️', title: tDesk('collected') });
    }
    return items;
    // tDesk 는 안정적 (locale 단위) — 의존성에서 제외해 불필요 재계산 방지.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, hasArticles]);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {navItems.length > 1 && (
        <div className="hidden lg:block">
          <SectionNav items={navItems} scrollRef={scrollRef} />
        </div>
      )}
      <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto px-5 py-5">
        {/* 상단 메타 strip — 누락 소스 / 유사 키워드 (있을 때만). */}
        {((job.skipped && job.skipped.length > 0) ||
          job.similar_keywords.length > 0) && (
          <div className="mb-4 flex flex-col gap-2">
            {job.skipped && job.skipped.length > 0 && (
              <SkippedBanners skipped={job.skipped} tDesk={tDesk} />
            )}
            {job.similar_keywords.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-[.18em] text-amore">
                  {tDesk('similarKeywords')}
                </span>
                {job.similar_keywords.map((k) => (
                  <span
                    key={k}
                    className="rounded-pill border border-line bg-white px-2.5 py-0.5 text-xs text-mute"
                  >
                    {k}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {parsed.ok ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {parsed.sections.map((section) => (
              <SectionRenderer
                key={section.id}
                section={section}
                job={job}
                tDesk={tDesk}
                quantClaims={quantClaims}
                hasCharts={hasCharts}
                hasStructuredRq={hasStructuredRq}
                rqById={rqById}
                revenueSeries={revenueSeries}
              />
            ))}

            {hasArticles && <ArticlesCard job={job} tDesk={tDesk} />}
          </div>
        ) : (
          // ── fallback — 인식 섹션 0. raw markdown 한 덩이 + 구조화 카드. ──
          <div className="grid grid-cols-1 gap-4">
            <SectionCard
              id="desk-sec-report"
              icon="📄"
              title={tDesk('reportTitle')}
              emphasis="large"
              accent="ink"
            >
              <DeskMarkdownBody source={job.output ?? ''} />
            </SectionCard>
            {revenueSeries.length > 0 && (
              <SectionCard
                id="desk-sec-revenue"
                icon="🏢"
                title={tDesk('revenueCardTitle')}
                emphasis="large"
                accent="peach"
              >
                <RevenueChart series={revenueSeries} tDesk={tDesk} />
              </SectionCard>
            )}
            {hasCharts && job.analytics && (
              <SectionCard
                id="desk-sec-analytics"
                icon="📊"
                title={tDesk('quantSnapshotsTitle')}
                emphasis="large"
                accent="warning"
              >
                <DeskAnalyticsPanel analytics={job.analytics} />
              </SectionCard>
            )}
            {hasArticles && <ArticlesCard job={job} tDesk={tDesk} />}
          </div>
        )}
      </div>
    </div>
  );
}

// 누락/실패 소스 배너 — reason 별로 문구·톤을 분리해서, 이번 잠복의 직접
// 원인이던 "키 없음(no_key)" vs "키 틀림(invalid_key)" 을 명확히 구분한다.
// invalid_key 는 사용자 액션(키 재등록)이 필요하므로 amore 강조 톤, 나머지는
// warning 톤. reason 누락(옛 job row) 은 'no_key' 로 취급 — 회귀 X.
const SKIPPED_REASON_ORDER: DeskSkipReason[] = [
  'invalid_key',
  'rate_limited',
  'fetch_failed',
  'no_key',
];

const SKIPPED_REASON_META: Record<
  DeskSkipReason,
  { titleKey: Parameters<TDesk>[0]; tone: 'amore' | 'warning' }
> = {
  invalid_key: { titleKey: 'skippedInvalidKey', tone: 'amore' },
  rate_limited: { titleKey: 'skippedRateLimited', tone: 'warning' },
  fetch_failed: { titleKey: 'skippedFetchFailed', tone: 'warning' },
  no_key: { titleKey: 'skippedTitle', tone: 'warning' },
};

function SkippedBanners({
  skipped,
  tDesk,
}: {
  skipped: NonNullable<DeskJob['skipped']>;
  tDesk: TDesk;
}) {
  const groups = new Map<DeskSkipReason, string[]>();
  for (const s of skipped) {
    const reason: DeskSkipReason = s.reason ?? 'no_key';
    const arr = groups.get(reason) ?? [];
    arr.push(s.source);
    groups.set(reason, arr);
  }

  return (
    <>
      {SKIPPED_REASON_ORDER.filter((r) => groups.has(r)).map((reason) => {
        const meta = SKIPPED_REASON_META[reason];
        const sources = groups.get(reason) ?? [];
        const toneClass =
          meta.tone === 'amore'
            ? 'border-amore bg-amore-bg text-ink-2'
            : 'border-warning-line bg-warning-bg text-ink-2';
        const labelClass =
          meta.tone === 'amore'
            ? 'font-semibold text-amore'
            : 'font-semibold';
        return (
          <div
            key={reason}
            className={`rounded-sm border px-4 py-2.5 text-sm ${toneClass}`}
          >
            <span className={labelClass}>{tDesk(meta.titleKey)}</span>
            <span className="ml-2 font-mono text-mute">
              {sources.join(', ')}
            </span>
          </div>
        );
      })}
    </>
  );
}

function SectionRenderer({
  section,
  job,
  tDesk,
  quantClaims,
  hasCharts,
  hasStructuredRq,
  rqById,
  revenueSeries,
}: {
  section: DeskParsedSection;
  job: DeskJob;
  tDesk: TDesk;
  quantClaims: Extract<DeskClaim, { kind: 'quant' }>[];
  hasCharts: boolean;
  hasStructuredRq: boolean;
  rqById: Map<string, NonNullable<DeskJob['rq_answers']>[number]>;
  revenueSeries: DeskRevenueSeries[];
}) {
  const common = {
    id: section.id,
    icon: section.icon,
    title: section.title,
    emphasis: section.emphasis,
    accent: section.accent,
  };

  // ── 주요 기업 매출 — 구조화 매출 grouped bar(위) + wide 테이블 markdown(아래). ──
  // 차트는 구조화 DART 값(revenueSeries)에서, 표는 LLM markdown 에서 오지만 둘 다
  // 같은 공시 원값이라 수치가 일치한다(#461). 값 없으면 표만 렌더(회귀 없음).
  if (isRevenueSection(section.title) && revenueSeries.length > 0) {
    return (
      <SectionCard {...common}>
        <div className="mb-4">
          <RevenueChart series={revenueSeries} tDesk={tDesk} />
        </div>
        <DeskMarkdownBody source={section.body} compact />
      </SectionCard>
    );
  }

  // ── Findings / Competitive — ### 토픽 sub-card grid ──
  if (
    (section.kind === 'findings' || section.kind === 'competitive') &&
    section.topics.length > 0
  ) {
    return (
      <SectionCard {...common} meta={`${section.topics.length} 토픽`}>
        {section.body && (
          <div className="mb-3">
            <DeskMarkdownBody source={section.body} compact />
          </div>
        )}
        <div
          className={
            section.kind === 'findings'
              ? 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3'
              : 'grid grid-cols-1 gap-3 md:grid-cols-2'
          }
        >
          {section.topics.map((t) => (
            <TopicCard key={t.id} topic={t} />
          ))}
        </div>
      </SectionCard>
    );
  }

  // ── RQ — 구조화 데이터 우선 (confidence pill 등). 없으면 markdown. ──
  if (section.kind === 'rq' && hasStructuredRq && job.research_questions) {
    return (
      <SectionCard {...common} meta={`${job.research_questions.length}`}>
        <div className="space-y-3">
          {job.research_questions.map((rq) => (
            <RQCard
              key={rq.id}
              rq={rq}
              answer={rqById.get(rq.id)}
              tDesk={tDesk}
            />
          ))}
        </div>
      </SectionCard>
    );
  }

  // ── Quant — 구조화 표 + analytics 차트. 둘 다 없으면 markdown. ──
  if (section.kind === 'quant' && (quantClaims.length > 0 || hasCharts)) {
    return (
      <SectionCard {...common} meta={quantClaims.length ? `${quantClaims.length}` : undefined}>
        {hasCharts && job.analytics && (
          <div className="mb-3">
            <DeskAnalyticsPanel analytics={job.analytics} />
          </div>
        )}
        {quantClaims.length > 0 ? (
          <QuantTable claims={quantClaims} tDesk={tDesk} />
        ) : (
          section.body && <DeskMarkdownBody source={section.body} compact />
        )}
      </SectionCard>
    );
  }

  // ── Appendix — default collapsed (reference). ──
  if (section.kind === 'appendix') {
    return (
      <SectionCard {...common} collapsible defaultOpen={false}>
        <DeskMarkdownBody source={section.body} compact />
      </SectionCard>
    );
  }

  // ── 그 외 (executive / caveats / topic 없는 findings·competitive / other) ──
  return (
    <SectionCard {...common}>
      <DeskMarkdownBody
        source={section.body}
        compact={section.emphasis !== 'large'}
      />
    </SectionCard>
  );
}

function QuantTable({
  claims,
  tDesk,
}: {
  claims: Extract<DeskClaim, { kind: 'quant' }>[];
  tDesk: TDesk;
}) {
  return (
    <div className="overflow-x-auto rounded-xs border border-line">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-white text-xs uppercase tracking-[.16em] text-mute-soft">
          <tr>
            <th className="border-b border-line px-3 py-2 text-left font-medium">
              {tDesk('cols.subject')}
            </th>
            <th className="border-b border-line px-3 py-2 text-left font-medium">
              {tDesk('cols.value')}
            </th>
            <th className="border-b border-line px-3 py-2 text-left font-medium">
              {tDesk('cols.source')}
            </th>
            <th className="border-b border-line px-3 py-2 text-left font-medium">
              {tDesk('cols.tier')}
            </th>
          </tr>
        </thead>
        <tbody>
          {claims.slice(0, 30).map((c, i) => (
            <tr key={`${c.article_url}-${i}`} className="text-ink-2">
              <td className="border-b border-line-soft px-3 py-2 align-top">
                {c.subject}
              </td>
              <td className="border-b border-line-soft px-3 py-2 align-top font-semibold text-amore">
                {c.value}
                {c.unit ? ` ${c.unit}` : ''}
              </td>
              <td className="border-b border-line-soft px-3 py-2 align-top">
                <a
                  href={c.article_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amore underline decoration-amore/40 underline-offset-2 hover:decoration-amore"
                >
                  {tDesk('viewSource')}
                </a>
              </td>
              <td className="border-b border-line-soft px-3 py-2 align-top text-mute">
                {c.tier}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArticlesCard({ job, tDesk }: { job: DeskJob; tDesk: TDesk }) {
  const articles = job.articles ?? [];
  return (
    <SectionCard
      id="desk-sec-articles"
      icon="🗂️"
      title={tDesk('collected')}
      emphasis="small"
      accent="mute-soft"
      collapsible
      defaultOpen={false}
      meta={`${articles.length}`}
    >
      <ul className="divide-y divide-line-soft">
        {articles.map((a) => (
          <li key={`${a.source}-${a.url}`} className="py-2.5 first:pt-0">
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-ink-2 hover:text-amore"
            >
              {a.title}
            </a>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-mute-soft">
              <span className="uppercase tracking-[.18em]">{a.source}</span>
              {a.origin && <span>{a.origin}</span>}
              {a.publishedAt && <span>{a.publishedAt}</span>}
              <span className="text-amore">#{a.keyword}</span>
            </div>
            {a.snippet && (
              <p className="mt-1 text-xs leading-[1.6] text-mute">{a.snippet}</p>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
