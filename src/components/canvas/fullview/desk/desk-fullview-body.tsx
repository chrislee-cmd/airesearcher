'use client';

/* ────────────────────────────────────────────────────────────────────
   DeskFullviewBody — 데스크 리서치 풀뷰 V2 body (CD state 09 · Report).
   fresh 신규 빌드 (design-handoff/FULLVIEW-SHELL.md §F4 Desk +
   fullview/Widget Fullview Comps.dc.html 09). 레거시 desk-result/
   desk-report-view.tsx · ai-judgment-log.tsx · desk-card-body 의 인라인
   fullview 프레젠테이션은 supersede — 편집·재사용 안 함.

   재사용 대상 = 로직/데이터만:
   - parseDeskReport() — 리포트 markdown → 섹션 분할(kind exec/find/rq/quant/
     appendix/competitive/caveats/other).
   - isJudgmentEvent() — progress.events 중 AI 판단 라인 필터.
   - DeskJob 구조화 데이터(claims·rq_answers·research_questions·
     similar_keywords) — quant 표 / RQ 카드 / 확장 키워드를 markdown 파싱
     의존 없이 안정 렌더.
   - DeskMarkdownBody — 공용 markdown→React 렌더러(프로즈 섹션).

   레이아웃(§F4 Desk): 좌 210px scroll-spy nav(border-r-2 ink · paper-soft)
   + 우 flex-1 스크롤 스트림. 스트림 = 판단로그 카드 → 확장 키워드 → 섹션
   카드(border-3 ink · rounded-sm · shadow-memphis-lg, 헤드 tint = kind별
   rose/mint/sun/lav/neutral) → export 액션. scroll-spy 동작(Intersection
   Observer + 클릭 점프)은 워커 소유(BUILD-SPEC §4).

   헤더 액션(§F3)은 셸 헤더가 소유 → 이 body 가 FullviewHeaderSlot 으로
   publish(프로젝트 pill = statusChip · 이전 산출물 Select = actions)하면
   CanvasBoard 의 FullviewHeader 가 렌더한다.
   ──────────────────────────────────────────────────────────────────── */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import type {
  DeskJob,
  DeskClaim,
  DeskAnalytics,
  DeskRevenueSeries,
} from '@/components/desk-job-provider';
import { isJudgmentEvent } from '@/lib/desk-orchestrator/types';
import {
  parseDeskReport,
  type DeskParsedSection,
  type DeskSectionKind,
} from '@/lib/desk-report-parser';
import { DeskMarkdownBody } from '@/components/canvas/widgets/desk-result/desk-markdown';
// 재사용(로직/프레젠테이션 컴포넌트) — market mode 뷰 · 정량 차트 · 매출 시계열.
// regular DeskResultView 가 job.mode 분기로 쓰는 것과 동일 컴포넌트로, fullview 도
// 데이터/렌더를 프레시 재구현 없이 재사용해 내용 parity 를 보장한다(스펙 제약).
import { MarketDataset } from '@/components/canvas/widgets/desk-result/market-dataset';
import { RevenueChart } from '@/components/canvas/widgets/desk-result/revenue-chart';
import { DeskAnalyticsPanel } from '@/components/desk-analytics-panel';
import { Select } from '@/components/ui/select';
import { BrandLoader } from '@/components/ui/brand-loader';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { FullviewProjectPill } from '../fullview-header';
import { useFullviewHeaderSlotPublisher } from '@/components/canvas/shell/fullview-header-slot-context';

// ── kind → CD state 09 비주얼(아이콘 · 헤드 tint · 액센트 dot) ──────────────
// tint/accent 는 CD 절대값을 승격한 §F6 토큰 유틸리티만(하드코드 hex 0).
// CD 5섹션 밖 kind(competitive/caveats/other)는 spec 대로 appendix 계열
// (neutral tint · mute-soft dot)로 수용 — 신규 발명 없음.
type KindVisual = { icon: string; headBg: string; dot: string };
const KIND_VISUAL: Record<DeskSectionKind, KindVisual> = {
  executive: { icon: '📌', headBg: 'bg-rose-bg', dot: 'bg-amore' },
  findings: { icon: '🔍', headBg: 'bg-mint-bg', dot: 'bg-success' },
  quant: { icon: '📊', headBg: 'bg-sun-bg', dot: 'bg-amber' },
  rq: { icon: '❓', headBg: 'bg-lav-bg-3', dot: 'bg-violet' },
  appendix: { icon: '🗂️', headBg: 'bg-neutral-bg', dot: 'bg-mute-soft' },
  competitive: { icon: '🏢', headBg: 'bg-neutral-bg', dot: 'bg-mute-soft' },
  caveats: { icon: '⚠️', headBg: 'bg-neutral-bg', dot: 'bg-mute-soft' },
  other: { icon: '📄', headBg: 'bg-neutral-bg', dot: 'bg-mute-soft' },
};

// confidence(RQ) → CD confColor + dot. high 🟢 success · medium 🟡 amber ·
// low ⚪ mute-soft(§F4: success / amber, low 는 근접 mute-soft).
const CONFIDENCE_VISUAL: Record<
  'high' | 'medium' | 'low',
  { dot: string; text: string; border: string }
> = {
  high: { dot: '🟢', text: 'text-success', border: 'border-success' },
  medium: { dot: '🟡', text: 'text-amber', border: 'border-amber' },
  low: { dot: '⚪', text: 'text-mute-soft', border: 'border-mute-soft' },
};

// quant tier → CD tierColor. T1 success · T2 amber · T3/unknown mute-soft.
function tierColor(tier: DeskClaim['tier']): string {
  return tier === 'T1'
    ? 'text-success'
    : tier === 'T2'
      ? 'text-amber'
      : 'text-mute-soft';
}

// claim.article_url → 짧은 출처명(hostname, www 제거). CD "Source" 칼럼용.
// URL 파싱 실패/빈 값이면 '—'.
function sourceDomain(url: string): string {
  if (!url) return '—';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '—';
  }
}

type TDesk = ReturnType<typeof useTranslations<'Desk'>>;

// "주요 기업 매출" 섹션 식별 — 이 섹션 상단에 구조화 매출 grouped bar(RevenueChart)
// 를 얹는다(#461). regular DeskReportView 와 동일한 순수 분류 로직(로직 재사용 —
// superseded 프레젠테이션 파일은 편집 안 함). 매칭 실패해도 섹션 본문은 그대로
// 렌더되므로 회귀는 없다(차트만 그 섹션에 안 붙음).
function isRevenueSection(title: string): boolean {
  return /주요\s*기업\s*매출|기업\s*매출|주요\s*상장사\s*매출|company\s*revenue|key\s*compan/i.test(
    title,
  );
}

export function DeskFullviewBody({
  job,
  jobs,
  onSelectJob,
  jobSelectorLabel,
  needsHydration,
  hydrationFailed,
  onRetryHydration,
  projectName,
  onExportMd,
  onExportDocx,
}: {
  // 현재 풀뷰가 보여주는 job(호스트가 선택/하이드레이션 소유). null = 미완료.
  job: DeskJob | null;
  // 이전 산출물 드롭다운용 목록(최근 job).
  jobs: DeskJob[];
  onSelectJob: (id: string | null) => void;
  jobSelectorLabel: (job: DeskJob) => string;
  needsHydration: boolean;
  hydrationFailed: boolean;
  onRetryHydration: () => void;
  projectName: string | null;
  onExportMd: () => void;
  onExportDocx: () => void;
}) {
  const t = useTranslations('Desk.fv');
  const tDesk = useTranslations('Desk');
  const publishHeaderSlot = useFullviewHeaderSlotPublisher();

  // ── 헤더 slot publish — 프로젝트 pill(statusChip) + 이전 산출물 Select(actions).
  // 셸 헤더밴드 톤(cyan)·타이틀·닫기✕ 는 셸이 소유, 위젯 종속 조각만 주입.
  useEffect(() => {
    publishHeaderSlot({
      statusChip: projectName ? (
        <FullviewProjectPill name={projectName} />
      ) : undefined,
      actions:
        jobs.length > 0 ? (
          <Select
            size="sm"
            fullWidth={false}
            aria-label={t('jobSelectAria')}
            className="min-w-[220px]"
            value={job?.id ?? ''}
            onChange={(e) => onSelectJob(e.target.value || null)}
            options={jobs.map((j) => ({
              value: j.id,
              label: jobSelectorLabel(j),
            }))}
          />
        ) : undefined,
    });
    return () => publishHeaderSlot({});
  }, [
    publishHeaderSlot,
    projectName,
    jobs,
    job?.id,
    onSelectJob,
    jobSelectorLabel,
    t,
  ]);

  // ── 판단 로그 — progress.events 중 AI 판단 라인만(재사용: isJudgmentEvent).
  const judgment = useMemo(
    () => (job?.progress?.events ?? []).filter(isJudgmentEvent),
    [job?.progress?.events],
  );

  // ── 리포트 섹션 — parseDeskReport(재사용 로직). ok=false 면 raw fallback.
  const parsed = useMemo(
    () => parseDeskReport(job?.output ?? ''),
    [job?.output],
  );

  // ── 구조화 데이터(재사용) — quant 표 / RQ 카드용. markdown 파싱 의존 0.
  const quantClaims = useMemo(
    () =>
      (job?.claims ?? []).filter(
        (c): c is Extract<DeskClaim, { kind: 'quant' }> => c.kind === 'quant',
      ),
    [job?.claims],
  );
  const rqById = useMemo(
    () => new Map((job?.rq_answers ?? []).map((a) => [a.rq_id, a])),
    [job?.rq_answers],
  );
  const researchQuestions = job?.research_questions ?? [];
  const similarKeywords = job?.similar_keywords ?? [];

  // 정량 분석 — analytics 차트(quant 섹션) + 매출 시계열(기업 매출 섹션). regular
  // DeskReportView 와 동일 데이터. 없으면 각 섹션은 표/프로즈만 렌더(회귀 없음).
  const analytics = job?.analytics ?? null;
  const revenueSeries = useMemo(
    () => job?.analytics?.revenueSeries ?? [],
    [job?.analytics],
  );

  // scroll-spy 활성 섹션 id.
  const scrollRef = useRef<HTMLDivElement>(null);
  const navItems = parsed.ok
    ? parsed.sections.map((s) => ({ id: s.id, kind: s.kind, title: s.title }))
    : [];
  const [activeId, setActiveId] = useState<string | null>(null);

  // ── 상태 게이트: 미완료 / 하이드레이션 중 / 실패 ─────────────────────────
  const ready = !!(job && job.status === 'done' && job.output);
  if (!ready) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-surface-canvas">
        <div className="flex min-h-0 flex-1 items-center justify-center p-10">
          {hydrationFailed ? (
            <EmptyState
              tone="subtle"
              title={t('loadFailedTitle')}
              description={t('loadFailedDesc')}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onRetryHydration}
                >
                  {tDesk('retry')}
                </Button>
              }
            />
          ) : needsHydration ? (
            <BrandLoader size={36} label={t('loading')} />
          ) : job ? (
            <EmptyState
              tone="subtle"
              title={t('notDoneTitle')}
              description={t('notDoneDesc')}
            />
          ) : (
            <EmptyState
              tone="subtle"
              title={t('emptyTitle')}
              description={t('emptyDesc')}
            />
          )}
        </div>
      </div>
    );
  }

  // ── market mode — 시장조사 결과(KPI 히어로 · 참고 데이터 disclaimer · 규모
  // 계층/기업 매출 표). regular DeskResultView 와 동일하게 재사용 컴포넌트
  // MarketDataset 로 위임 → 내용 parity 보장(프레시 재구현 금지 제약). V2 좌측
  // scroll-spy nav 는 report 섹션 구조 전용이라 market 은 자체 레이아웃을 쓰고,
  // 셸 프레임(헤더밴드·닫기·프로젝트 pill)은 CanvasBoard FullviewHeader 가 소유.
  // 판단 로그(상단)·export 액션(하단)은 report 스트림과 동일하게 유지한다.
  if (job.mode === 'market') {
    return (
      <div className="flex h-full min-h-0 flex-col bg-surface-canvas">
        {judgment.length > 0 && (
          <div className="shrink-0 px-6 pt-5">
            <JudgmentLog lines={judgment} label={t('judgmentLog')} />
          </div>
        )}
        <MarketDataset job={job} tDesk={tDesk} />
        <div className="flex shrink-0 gap-2 border-t border-line-soft px-6 py-3">
          <ExportButton onClick={onExportDocx} label={t('exportDocx')} />
          <ExportButton onClick={onExportMd} label={t('exportMd')} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-surface-canvas">
      {/* 좌 nav — scroll-spy(§F4: 210px · border-r-2 ink · paper-soft). */}
      {navItems.length > 0 && (
        <nav className="flex w-[210px] shrink-0 flex-col gap-1 overflow-y-auto border-r-2 border-ink bg-paper-soft px-3 py-4">
          <div className="px-2 pb-2 pt-0.5 font-mono-label text-xs font-bold uppercase tracking-[0.1em] text-faint">
            {t('sections')}
          </div>
          {navItems.map((n) => {
            const active = n.id === activeId;
            const visual = KIND_VISUAL[n.kind];
            return (
              // eslint-disable-next-line react/forbid-elements -- CD §F4 Desk scroll-spy nav item 은 radius-nav(8)·active bg-cyan 틴트 전용 chrome 으로 Button primitive 의 고정 radius/variant 와 불일치(§7.11). 셸 조각(nav/close ✕)과 동일 선례.
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  document
                    .getElementById(n.id)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={`flex items-center gap-2 rounded-[var(--fv-radius-nav)] px-2.5 py-2 text-left text-sm transition-colors ${
                  active
                    ? 'bg-cyan font-extrabold text-ink'
                    : 'font-semibold text-mute-soft hover:text-ink'
                }`}
              >
                <span aria-hidden className="text-md leading-none">
                  {visual.icon}
                </span>
                <span className="min-w-0 truncate">{n.title}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* 우 스트림 — 판단로그 → 확장키워드 → 섹션카드 → export. */}
      <div
        ref={scrollRef}
        className="sc flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
      >
        {judgment.length > 0 && (
          <JudgmentLog lines={judgment} label={t('judgmentLog')} />
        )}

        {/* 첫 헤딩 앞 preamble(표지 문구 등) — 보통 비어있고, 있을 때만 프로즈로. */}
        {parsed.ok && parsed.preamble && (
          <div className="text-md leading-[1.65] text-ink-2">
            <DeskMarkdownBody source={parsed.preamble} />
          </div>
        )}

        {similarKeywords.length > 0 && (
          <section>
            <div className="mb-2 font-mono-label text-xs font-bold uppercase tracking-[0.1em] text-mute-soft">
              {t('expandedKeywords')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {similarKeywords.map((k) => (
                <span
                  key={k}
                  className="rounded-pill border-[1.4px] border-line bg-paper px-3 py-[5px] text-sm font-semibold text-ink"
                >
                  {k}
                </span>
              ))}
            </div>
          </section>
        )}

        {parsed.ok ? (
          parsed.sections.map((section) => (
            <SectionCard
              key={section.id}
              section={section}
              quantClaims={section.kind === 'quant' ? quantClaims : []}
              researchQuestions={
                section.kind === 'rq' ? researchQuestions : []
              }
              rqById={rqById}
              analytics={section.kind === 'quant' ? analytics : null}
              revenueSeries={
                section.kind === 'competitive' ? revenueSeries : []
              }
              onVisible={setActiveId}
              scrollRoot={scrollRef}
              t={t}
              tDesk={tDesk}
            />
          ))
        ) : (
          // 인식 가능한 섹션 0 — raw markdown fallback(파서 계약).
          <article className="overflow-hidden rounded-sm border-[3px] border-ink bg-paper shadow-memphis-lg">
            <div className="px-4 py-4 text-md leading-[1.65] text-ink-2">
              <DeskMarkdownBody source={job.output ?? ''} />
            </div>
          </article>
        )}

        {/* export 액션(§09) — .docx / .md. Google Docs 공유는 카드 미리보기
            ShareMenu 로 유지(보수적 이관 — fullview 스코프는 리포트 렌더). */}
        <div className="flex gap-2 pt-1">
          <ExportButton onClick={onExportDocx} label={t('exportDocx')} />
          <ExportButton onClick={onExportMd} label={t('exportMd')} />
        </div>
      </div>
    </div>
  );
}

// ── AI 판단 로그 카드(§09: border 1.5 line · radius-panel · 2-col grid) ──────
function JudgmentLog({ lines, label }: { lines: string[]; label: string }) {
  return (
    <section className="overflow-hidden rounded-[var(--fv-radius-panel)] border-[1.5px] border-line bg-paper">
      <div className="flex items-center gap-2 border-b border-line-soft px-3.5 py-2.5">
        <span aria-hidden className="text-lg leading-none">
          🧠
        </span>
        <span className="text-md font-extrabold text-ink">{label}</span>
        <span className="font-mono-label text-sm text-mute-soft">
          {lines.length}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 px-3.5 py-3 md:grid-cols-2">
        {lines.map((line, i) => {
          // 마커(선두 emoji) + 본문 분리 — 첫 공백 기준(grapheme slice 회피).
          const spaceIdx = line.indexOf(' ');
          const marker = spaceIdx > 0 ? line.slice(0, spaceIdx) : line;
          const body = spaceIdx > 0 ? line.slice(spaceIdx + 1) : '';
          return (
            <div
              key={i}
              className="flex gap-2 text-sm leading-[1.5] text-ink-2"
            >
              <span aria-hidden className="shrink-0">
                {marker}
              </span>
              <span>{body}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── 섹션 카드(§F4 Desk: border-3 ink · rounded-sm · shadow-memphis-lg) ──────
function SectionCard({
  section,
  quantClaims,
  researchQuestions,
  rqById,
  analytics,
  revenueSeries,
  onVisible,
  scrollRoot,
  t,
  tDesk,
}: {
  section: DeskParsedSection;
  quantClaims: Extract<DeskClaim, { kind: 'quant' }>[];
  researchQuestions: NonNullable<DeskJob['research_questions']>;
  rqById: Map<string, NonNullable<DeskJob['rq_answers']>[number]>;
  // quant 섹션의 정량 차트(DeskAnalyticsPanel) — 비-quant 섹션이면 null.
  analytics: DeskAnalytics | null;
  // 기업 매출 섹션의 매출 시계열(RevenueChart) — 그 외 섹션이면 빈 배열.
  revenueSeries: DeskRevenueSeries[];
  onVisible: (id: string) => void;
  scrollRoot: React.RefObject<HTMLDivElement | null>;
  t: ReturnType<typeof useTranslations>;
  tDesk: TDesk;
}) {
  const visual = KIND_VISUAL[section.kind];
  // appendix(reference) 는 기본 접힘 — 본문 초점 유지(파서 collapsed 계약).
  const [open, setOpen] = useState(!section.collapsed);
  const ref = useRef<HTMLElement>(null);

  // scroll-spy — 이 섹션이 스크롤 컨테이너 상단 근처면 nav active 로.
  useEffect(() => {
    const el = ref.current;
    const root = scrollRoot.current;
    if (!el || !root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) onVisible(section.id);
        }
      },
      // 상단 밴드(위 12% ~ 위 -70%)에 헤드가 들어오면 활성 — 스크롤 방향
      // 무관하게 "지금 보고 있는" 섹션 하나로 수렴.
      { root, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [section.id, onVisible, scrollRoot]);

  const hasRq = section.kind === 'rq' && researchQuestions.length > 0;
  const hasCharts = section.kind === 'quant' && !!analytics?.charts?.length;
  // 기업 매출 grouped bar — competitive 섹션(부모에서 스코프) + 제목 매칭 + 값 존재.
  const hasRevenue =
    section.kind === 'competitive' &&
    isRevenueSection(section.title) &&
    revenueSeries.length > 0;

  return (
    <article
      ref={ref}
      id={section.id}
      className="overflow-hidden rounded-sm border-[3px] border-ink bg-paper shadow-memphis-lg"
    >
      {/* eslint-disable-next-line react/forbid-elements -- CD §F4 Desk 섹션 헤드는 border-b-2 ink·kind별 파스텔 tint 밴드의 collapsible 헤더 chrome 으로 Button primitive variant 와 형태 불일치. appendix 접기/펼치기 토글. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2.5 border-b-2 border-ink px-4 py-3 text-left ${visual.headBg}`}
      >
        <span
          aria-hidden
          className={`h-[9px] w-[9px] shrink-0 rounded-full border-[1.5px] border-ink ${visual.dot}`}
        />
        <span aria-hidden className="text-lg leading-none">
          {visual.icon}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-xl font-extrabold text-ink"
          style={{ fontFamily: 'var(--font-outfit), var(--font-sans)' }}
        >
          {section.title}
        </span>
        <span aria-hidden className="text-sm text-mute-soft">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="px-4 py-4">
          {/* 기업 매출 grouped bar — 표/프로즈보다 위(구조화 DART 값). */}
          {hasRevenue && (
            <div className="mb-4">
              <RevenueChart series={revenueSeries} tDesk={tDesk} />
            </div>
          )}
          {hasRq ? (
            <div className="flex flex-col gap-3">
              {researchQuestions.map((rq) => (
                <RQCard
                  key={rq.id}
                  rq={rq}
                  answer={rqById.get(rq.id)}
                  t={t}
                  tDesk={tDesk}
                />
              ))}
            </div>
          ) : section.kind === 'quant' ? (
            <>
              {/* 정량 분석 차트(재사용 DeskAnalyticsPanel) — 있을 때만. */}
              {hasCharts && analytics && (
                <div className="mb-3">
                  <DeskAnalyticsPanel analytics={analytics} />
                </div>
              )}
              {quantClaims.length > 0 ? (
                <QuantTable claims={quantClaims} t={t} />
              ) : (
                section.body && (
                  <div className="text-md leading-[1.65] text-ink-2">
                    <DeskMarkdownBody source={section.body} compact />
                  </div>
                )
              )}
            </>
          ) : (
            section.body && (
              <div className="text-md leading-[1.65] text-ink-2">
                <DeskMarkdownBody
                  source={section.body}
                  compact={section.emphasis !== 'large'}
                />
              </div>
            )
          )}
          {/* findings/competitive 토픽 — 프로즈 뒤 서브 카드. */}
          {section.topics.length > 0 && (
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              {section.topics.map((topic) => (
                <div
                  key={topic.id}
                  className="rounded-[var(--fv-radius-card)] border-2 border-ink bg-paper p-3.5 shadow-memphis-sm-faint"
                >
                  {topic.title && (
                    <div className="mb-1.5 text-md font-bold text-ink">
                      {topic.title}
                    </div>
                  )}
                  <div className="text-sm leading-[1.6] text-ink-2">
                    <DeskMarkdownBody source={topic.body} compact />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

// ── RQ 카드(§F4: border-2 ink · radius-card(11) · shadow-memphis-sm-faint) ──
function RQCard({
  rq,
  answer,
  t,
  tDesk,
}: {
  rq: NonNullable<DeskJob['research_questions']>[number];
  answer: NonNullable<DeskJob['rq_answers']>[number] | undefined;
  t: ReturnType<typeof useTranslations>;
  tDesk: TDesk;
}) {
  const conf = answer ? CONFIDENCE_VISUAL[answer.confidence] : null;
  return (
    <div className="rounded-[var(--fv-radius-card)] border-2 border-ink p-3.5 shadow-memphis-sm-faint">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono-label text-xs font-extrabold tracking-[0.05em] text-mute-soft">
          {rq.id} · {rq.category} · {tDesk('importance')} {rq.importance}/5
        </span>
        {conf && answer && (
          <span
            className={`ml-auto inline-flex items-center gap-1 rounded-pill border-[1.4px] px-2.5 py-[2px] text-sm font-bold ${conf.border} ${conf.text}`}
          >
            <span aria-hidden>{conf.dot}</span>
            {answer.confidence}
          </span>
        )}
      </div>
      <div className="mb-1.5 text-lg font-bold leading-[1.5] text-ink">
        {rq.question}
      </div>
      {answer?.answer_md && (
        <div className="mb-2.5 text-md leading-[1.6] text-ink-2">
          <DeskMarkdownBody source={answer.answer_md} compact />
        </div>
      )}
      {/* "To explore" 노트(§F4: warning-bg · warning-line-amber · warning-text). */}
      {answer && answer.missing_data.length > 0 && (
        <div className="flex items-start gap-2 rounded-[var(--fv-radius-field)] border-[1.3px] border-warning-line-amber bg-warning-bg px-3 py-2">
          <span aria-hidden className="text-sm leading-none">
            🔎
          </span>
          <div className="text-sm leading-[1.45] text-warning-text">
            <b>{t('toExplore')}</b> {answer.missing_data.join(' · ')}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Quant 표(§F4: mono 헤더 · value amore-deep · tier T1-3 색) ───────────────
function QuantTable({
  claims,
  t,
}: {
  claims: Extract<DeskClaim, { kind: 'quant' }>[];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-md">
        <thead>
          <tr>
            {(['subject', 'value', 'source', 'tier'] as const).map((col) => (
              <th
                key={col}
                className={`border-b-[1.5px] border-line px-2 py-1.5 font-mono-label text-xs font-bold uppercase tracking-[0.05em] text-mute-soft ${
                  col === 'value'
                    ? 'text-right'
                    : col === 'tier'
                      ? 'text-center'
                      : 'text-left'
                }`}
              >
                {t(`quantCol.${col}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {claims.slice(0, 30).map((c, i) => (
            <tr key={`${c.article_url}-${i}`} className="border-b border-line-soft">
              <td className="px-2 py-2 align-top text-ink-2">{c.subject}</td>
              <td className="px-2 py-2 text-right align-top font-mono-label font-extrabold text-amore-deep">
                {c.value}
                {c.unit ? ` ${c.unit}` : ''}
              </td>
              <td className="px-2 py-2 align-top text-mute">
                {sourceDomain(c.article_url)}
              </td>
              <td
                className={`px-2 py-2 text-center align-top font-mono-label text-sm font-extrabold ${tierColor(
                  c.tier,
                )}`}
              >
                {c.tier}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── export 버튼(§09: border 1.5 ink · radius-panel · memphis-sm) ────────────
function ExportButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: ReactNode;
}) {
  return (
    // eslint-disable-next-line react/forbid-elements -- CD §09 export 는 border-1.5 ink·radius-panel(12)·memphis-sm 전용 chrome 으로 Button primitive 의 고정 radius variant 와 불일치(§7.11). 셸 조각(CSV/close ✕)과 동일 선례.
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-[var(--fv-radius-panel)] border-[1.5px] border-ink bg-paper px-3.5 py-2 text-md font-bold text-ink shadow-memphis-sm"
    >
      {label}
    </button>
  );
}
