'use client';

/* ────────────────────────────────────────────────────────────────────
   RecruitingJudgedTable — 풀뷰 V2 Recruiting 우측 "부합도 요약" 탭 (CD state 08).
   design-handoff/FULLVIEW-SHELL.md §F4 · Widget Fullview Comps.dc.html.

   fresh 신규 빌드 — 레거시 recruiting/judged-list-table.tsx 는 supersede
   (편집·재사용 금지). 판단 fetch 로직·정렬·RespondentDrawer·persona-fit
   타입만 재사용해 CD 대로 다시 그린다.

   fit 3단 (CD §F4): High = success · Medium = amore-deep(text)/amore(dot·border)
   · Low = mute-soft. Flag 배지 = warning-text · warning-bg · warning-line-amber.
   상단 fit 칩(전체/높음/중간/낮음, active = bg-ink white), 하단 요약 footer.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Banner } from '../../shell/banner';
import { track as trackEvent } from '@/lib/analytics/events';
import type { FormColumn, FormResponseRow } from '@/lib/google-forms';
import type {
  PersonaFit,
  ResponseJudgment,
} from '@/lib/recruiting/persona-fit';
import { RespondentDrawer } from '../../widgets/recruiting/respondent-drawer';

// ─── fit 배지 (CD §F4 — 레거시 대비 medium 을 amore-deep 로 교정) ──────────
const FIT_META: Record<
  PersonaFit,
  { label: string; dot: string; text: string; border: string; bg: string }
> = {
  high: {
    label: '높음',
    dot: 'bg-success',
    text: 'text-success',
    border: 'border-success',
    bg: 'bg-success/10',
  },
  medium: {
    label: '중간',
    dot: 'bg-amore',
    text: 'text-amore-deep',
    border: 'border-amore',
    bg: 'bg-amore/10',
  },
  low: {
    label: '낮음',
    dot: 'bg-mute-soft',
    text: 'text-mute-soft',
    border: 'border-line',
    bg: 'bg-paper-soft',
  },
};

function FitBadge({ fit }: { fit: PersonaFit | null }) {
  if (!fit) {
    return (
      <span
        className="text-xs-soft text-mute-soft"
        title="참여자 조건이 설정되지 않아 부합도를 판단하지 않았습니다."
      >
        —
      </span>
    );
  }
  const m = FIT_META[fit];
  return (
    <span
      className={`inline-flex items-center gap-1.5 self-start rounded-pill border ${m.border} ${m.bg} px-2.5 py-0.5 text-sm font-bold ${m.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} aria-hidden="true" />
      {m.label}
    </span>
  );
}

// flag 원문(모델 자유 태그)을 얕게 한글 매핑, 매핑 없으면 원문 그대로.
function flagLabel(flag: string): string {
  const f = flag.toLowerCase();
  if (f.includes('duplicate') || f.includes('중복')) return '중복 응답';
  if (f.includes('short') || f.includes('한 글자') || f.includes('한글자'))
    return '단답 의심';
  if (f.includes('contradict') || f.includes('모순')) return '모순 응답';
  if (f.includes('nonsense') || f.includes('무의미')) return '무의미 응답';
  return flag;
}

const FIT_RANK: Record<PersonaFit, number> = { high: 0, medium: 1, low: 2 };
const fitRank = (f: PersonaFit | null) => (f ? FIT_RANK[f] : 3);

type FitFilter = 'all' | PersonaFit;
const FILTER_CHIPS: { key: FitFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'high', label: '높음' },
  { key: 'medium', label: '중간' },
  { key: 'low', label: '낮음' },
];

type JudgmentsPayload = {
  judgments: ResponseJudgment[];
  total: number;
  judged: number;
  cached: number;
};

export function RecruitingJudgedTable({
  formId,
  responseData,
  refreshSignal,
}: {
  formId: string | null;
  responseData: { columns: FormColumn[]; rows: FormResponseRow[] } | null;
  refreshSignal: number;
}) {
  const [payload, setPayload] = useState<JudgmentsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fitFilter, setFitFilter] = useState<FitFilter>('all');
  const [openPos, setOpenPos] = useState<number | null>(null);

  const loadJudgments = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setOpenPos(null);
    try {
      const res = await fetch(
        `/api/recruiting/google/forms/${encodeURIComponent(id)}/judgments`,
      );
      const j = (await res.json().catch(() => ({}))) as
        | JudgmentsPayload
        | { error?: string };
      if (!res.ok) {
        throw new Error(
          ('error' in j && j.error) || `judgments_failed: ${res.statusText}`,
        );
      }
      const loaded = j as JudgmentsPayload;
      setPayload(loaded);
      if (loaded.judged > 0) {
        trackEvent('widget_action', {
          widget: 'recruiting',
          action: 'extraction_completed',
          metadata: { form_id: id, total: loaded.total, judged: loaded.judged },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'judgments_failed');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // 폼 전환 시 render-phase 리셋 (레거시 prevFormId 패턴 미러).
  const [prevFormId, setPrevFormId] = useState(formId);
  if (formId !== prevFormId) {
    setPrevFormId(formId);
    setPayload(null);
    setFitFilter('all');
  }

  useEffect(() => {
    if (!formId) return;
    void (async () => {
      await loadJudgments(formId);
    })();
  }, [formId, loadJudgments]);

  useEffect(() => {
    if (refreshSignal === 0 || !formId) return;
    void (async () => {
      await loadJudgments(formId);
    })();
  }, [refreshSignal, formId, loadJudgments]);

  const rowByKey = useMemo(() => {
    const m = new Map<string, FormResponseRow>();
    for (const r of responseData?.rows ?? []) m.set(r.responseId, r);
    return m;
  }, [responseData]);

  const drawerColumns = responseData?.columns ?? [];

  const displayItems = useMemo(() => {
    const withNum = (payload?.judgments ?? []).map((j, i) => ({ j, num: i + 1 }));
    const filtered =
      fitFilter === 'all'
        ? withNum
        : withNum.filter((x) => x.j.fit === fitFilter);
    return filtered
      .map((x, idx) => ({ ...x, idx }))
      .sort((a, b) => {
        const r = fitRank(a.j.fit) - fitRank(b.j.fit);
        return r !== 0 ? r : a.idx - b.idx;
      });
  }, [payload, fitFilter]);

  const openRow = useCallback((pos: number) => {
    setOpenPos(pos);
    trackEvent('widget_action', {
      widget: 'recruiting',
      action: 'judged_drawer_open',
    });
  }, []);

  const fitCounts = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0 } as Record<PersonaFit, number>;
    for (const j of payload?.judgments ?? []) if (j.fit) c[j.fit] += 1;
    return c;
  }, [payload]);

  const noForm = !formId;
  const showSkeleton = loading && !payload;
  const open = openPos != null && displayItems[openPos] != null;
  const active = open ? displayItems[openPos] : null;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* fit 칩 바 (CD state 08) — active = bg-ink white pill */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ink/10 px-5 py-[11px]">
        {FILTER_CHIPS.map((chip) => {
          const activeChip = fitFilter === chip.key;
          const count =
            chip.key === 'all'
              ? (payload?.judgments.length ?? 0)
              : fitCounts[chip.key];
          return (
            // eslint-disable-next-line react/forbid-elements -- CD state 08 fit 칩은 bg-ink·white·radius-pill 전용 chrome 으로 Button primitive 의 radius/variant 와 불일치(§7.11 className radius override 불가). 헤더 조각과 동일 선례.
            <button
              key={chip.key}
              type="button"
              aria-pressed={activeChip}
              onClick={() => setFitFilter(chip.key)}
              className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-[5px] text-sm transition-colors ${
                activeChip
                  ? 'border-ink bg-ink font-bold text-white'
                  : 'border-line bg-paper font-semibold text-mute hover:bg-paper-soft'
              }`}
            >
              {chip.label}
              {payload && (
                <span className="font-mono-label text-xs-soft tabular-nums">
                  {count}
                </span>
              )}
            </button>
          );
        })}
        {loading && payload && (
          <span className="ml-auto text-xs-soft text-mute-soft">판단 갱신 중…</span>
        )}
      </div>

      {/* 본문 */}
      <div className="min-h-0 flex-1 overflow-auto bg-paper">
        {noForm ? (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              tone="subtle"
              title="발행된 설문을 선택하세요"
              description="응답이 있는 설문을 고르면 응답자별 부합도 판단이 여기에 표시됩니다."
            />
          </div>
        ) : error ? (
          <div className="p-5">
            <Banner tone="warning" divider="none">
              부합도 판단을 불러오지 못했어요: {error}
            </Banner>
            <div className="mt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => formId && void loadJudgments(formId)}
              >
                다시 시도
              </Button>
            </div>
          </div>
        ) : showSkeleton ? (
          <JudgingSkeleton />
        ) : !payload || payload.judgments.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              tone="subtle"
              title="아직 판단할 응답이 없습니다"
              description="설문 링크를 공유해 응답이 들어오면 응답자별 부합도 판단이 표시됩니다."
            />
          </div>
        ) : displayItems.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              tone="subtle"
              title="해당 부합도의 응답이 없습니다"
              description="필터를 '전체' 로 바꾸면 모든 응답자가 다시 표시됩니다."
            />
          </div>
        ) : (
          <table className="w-full border-collapse text-md">
            <thead className="sticky top-0 z-table-sticky bg-paper-soft text-left">
              <tr>
                {['응답자', '성별', '연령', '거주지', '부합도 · 근거'].map((h) => (
                  <th
                    key={h}
                    className="border-b border-line px-4 py-2.5 font-mono-label text-xs-soft uppercase tracking-[0.05em] text-mute-soft"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayItems.map((item, pos) => {
                const { j, num } = item;
                return (
                  <tr
                    key={j.response_key}
                    onClick={() => openRow(pos)}
                    className="cursor-pointer border-b border-ink/[0.08] last:border-b-0 hover:bg-paper-soft"
                  >
                    <td className="whitespace-nowrap px-4 py-[11px] align-top">
                      <span className="flex items-center gap-1.5 font-mono-label font-extrabold tabular-nums text-ink-2">
                        #{num}
                        {j.flags.length > 0 && (
                          <span
                            title={j.flags.map(flagLabel).join(', ')}
                            className="rounded-pill border border-warning-line-amber bg-warning-bg px-1.5 text-xs-soft font-extrabold text-warning-text"
                          >
                            ⚠ {j.flags.length}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-[11px] align-top text-md text-ink-2">
                      {j.gender ?? <span className="text-mute-soft">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-[11px] align-top text-md text-ink-2">
                      {j.age_group ?? <span className="text-mute-soft">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-[11px] align-top text-md text-ink-2">
                      {j.region ?? <span className="text-mute-soft">—</span>}
                    </td>
                    <td className="px-4 py-[11px] align-top">
                      <div className="flex flex-col gap-1">
                        <FitBadge fit={j.fit} />
                        {j.fit_reason ? (
                          <span className="line-clamp-2 break-words text-sm leading-[1.5] text-mute">
                            {j.fit_reason}
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* footer = 응답자 수 요약 (CD state 08) */}
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-ink/10 bg-paper-soft px-5 py-2.5 font-mono-label text-xs-soft text-mute-soft">
        <span className="tabular-nums">
          {payload
            ? fitFilter === 'all'
              ? `${payload.judgments.length} 응답 · 높음 ${fitCounts.high} · 중간 ${fitCounts.medium} · 낮음 ${fitCounts.low} · 이름·전화 제외`
              : `${displayItems.length} / ${payload.judgments.length} 응답 표시`
            : '이름·전화 등 개인정보는 판단에 반영되나 표시되지 않습니다.'}
        </span>
      </footer>

      <RespondentDrawer
        open={open}
        label={active ? `#${active.num}` : ''}
        judgment={active?.j ?? null}
        columns={drawerColumns}
        row={active ? (rowByKey.get(active.j.response_key) ?? null) : null}
        onClose={() => setOpenPos(null)}
        onPrev={() => setOpenPos((p) => (p != null && p > 0 ? p - 1 : p))}
        onNext={() =>
          setOpenPos((p) =>
            p != null && p < displayItems.length - 1 ? p + 1 : p,
          )
        }
        hasPrev={openPos != null && openPos > 0}
        hasNext={openPos != null && openPos < displayItems.length - 1}
      />
    </div>
  );
}

function JudgingSkeleton() {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-5 py-3 text-sm text-mute-soft">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
        응답자별 부합도를 판단하는 중…
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-line px-5 py-3"
        >
          <Skeleton variant="text" width={32} />
          <Skeleton variant="text" width={48} />
          <Skeleton variant="text" width={48} />
          <Skeleton variant="text" width={48} />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton variant="text" width={64} height={16} />
            <Skeleton variant="text" className="w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
