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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Banner } from '../../shell/banner';
import { track as trackEvent } from '@/lib/analytics/events';
import type { FormColumn, FormResponseRow } from '@/lib/google-forms';
import type {
  PersonaFit,
  ResponseJudgment,
} from '@/lib/recruiting/persona-fit';
import { RespondentDrawer } from '../../widgets/recruiting/respondent-drawer';

// ─── fit 배지 (CD §F4 — 레거시 대비 medium 을 amore-deep 로 교정) ──────────
// 색만 코드 소유(토큰), 라벨은 i18n 키(fitHigh/fitMedium/fitLow).
const FIT_STYLE: Record<
  PersonaFit,
  { labelKey: string; dot: string; text: string; border: string; bg: string }
> = {
  high: {
    labelKey: 'fitHigh',
    dot: 'bg-success',
    text: 'text-success',
    border: 'border-success',
    bg: 'bg-success/10',
  },
  medium: {
    labelKey: 'fitMedium',
    dot: 'bg-amore',
    text: 'text-amore-deep',
    border: 'border-amore',
    bg: 'bg-amore/10',
  },
  low: {
    labelKey: 'fitLow',
    dot: 'bg-mute-soft',
    text: 'text-mute-soft',
    border: 'border-line',
    bg: 'bg-paper-soft',
  },
};

function FitBadge({
  fit,
  t,
}: {
  fit: PersonaFit | null;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!fit) {
    return (
      <span className="text-xs-soft text-mute-soft" title={t('fitNoneTitle')}>
        —
      </span>
    );
  }
  const m = FIT_STYLE[fit];
  return (
    <span
      className={`inline-flex items-center gap-1.5 self-start rounded-pill border ${m.border} ${m.bg} px-2.5 py-0.5 text-sm font-bold ${m.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} aria-hidden="true" />
      {t(m.labelKey)}
    </span>
  );
}

// flag 원문(모델 자유 태그)을 얕게 매핑해 i18n 라벨로. 매칭 키워드는 응답
// 콘텐츠/모델 태그 대조용(표시 아님)이라 한글 리터럴 허용.
function flagText(flag: string, t: ReturnType<typeof useTranslations>): string {
  const f = flag.toLowerCase();
  // i18n-allow-korean -- flag 매칭 키워드(모델 태그/응답 콘텐츠 대조, 표시 아님)
  if (f.includes('duplicate') || f.includes('중복')) return t('flagDuplicate');
  // i18n-allow-korean -- flag 매칭 키워드(모델 태그/응답 콘텐츠 대조, 표시 아님)
  if (f.includes('short') || f.includes('한 글자') || f.includes('한글자'))
    return t('flagShort');
  // i18n-allow-korean -- flag 매칭 키워드(모델 태그/응답 콘텐츠 대조, 표시 아님)
  if (f.includes('contradict') || f.includes('모순')) return t('flagContradict');
  // i18n-allow-korean -- flag 매칭 키워드(모델 태그/응답 콘텐츠 대조, 표시 아님)
  if (f.includes('nonsense') || f.includes('무의미')) return t('flagNonsense');
  return flag;
}

const FIT_RANK: Record<PersonaFit, number> = { high: 0, medium: 1, low: 2 };
const fitRank = (f: PersonaFit | null) => (f ? FIT_RANK[f] : 3);

type FitFilter = 'all' | PersonaFit;
const FILTER_CHIPS: { key: FitFilter; labelKey: string }[] = [
  { key: 'all', labelKey: 'filterAll' },
  { key: 'high', labelKey: 'fitHigh' },
  { key: 'medium', labelKey: 'fitMedium' },
  { key: 'low', labelKey: 'fitLow' },
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
  selected,
  onToggleRow,
  onToggleAll,
  onJudgmentsChange,
}: {
  formId: string | null;
  responseData: { columns: FormColumn[]; rows: FormResponseRow[] } | null;
  refreshSignal: number;
  // 브리지 선택 — 호스트가 SSOT(요약/raw 두 뷰가 공유하는 responseId 집합).
  // key = response_key (= responseId = invitations response_id).
  selected: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: (ids: string[], checked: boolean) => void;
  // 판단 로드 시 호스트로 lift → 브리지 모달이 선택 응답자 서술자(fit/demo)를 빌드.
  onJudgmentsChange: (judgments: ResponseJudgment[]) => void;
}) {
  const t = useTranslations('Recruiting.fv');
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

  // 판단 목록을 호스트로 lift → 브리지 모달 서술자 빌드(응답 없으면 빈 배열).
  useEffect(() => {
    onJudgmentsChange(payload?.judgments ?? []);
  }, [payload, onJudgmentsChange]);

  // 전체 선택 대상 = 현재 fit 필터로 보이는 행들(displayItems)의 response_key.
  const visibleIds = useMemo(
    () => displayItems.map((x) => x.j.response_key),
    [displayItems],
  );
  const visibleSelectedCount = useMemo(
    () => visibleIds.filter((id) => selected.has(id)).length,
    [visibleIds, selected],
  );
  const allSelected =
    visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
  const someSelected =
    visibleSelectedCount > 0 && visibleSelectedCount < visibleIds.length;

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
    // min-w-0 = 폭 봉쇄 체인의 리프(round-2 feedback #1). 요약 탭 본문이
    // 판단테이블 intrinsic 폭으로 팽창해 상위 min-w-0 를 뚫는 케이스 차단 —
    // 가로 스크롤은 아래 overflow-auto 본문 한 겹에만.
    <div className="relative flex h-full min-h-0 min-w-0 flex-col">
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
              {t(chip.labelKey)}
              {payload && (
                <span className="font-mono-label text-xs-soft tabular-nums">
                  {count}
                </span>
              )}
            </button>
          );
        })}
        {loading && payload && (
          <span className="ml-auto text-xs-soft text-mute-soft">
            {t('judgingUpdating')}
          </span>
        )}
      </div>

      {/* 본문 — min-w-0 로 테이블 intrinsic 폭을 이 래퍼 안에 가둔다(가로 스크롤 복원). */}
      <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-paper">
        {noForm ? (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              tone="subtle"
              title={t('noFormSelectTitle')}
              description={t('noFormSelectDesc')}
            />
          </div>
        ) : error ? (
          <div className="p-5">
            <Banner tone="warning" divider="none">
              {t('judgeError', { error })}
            </Banner>
            <div className="mt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => formId && void loadJudgments(formId)}
              >
                {t('retry')}
              </Button>
            </div>
          </div>
        ) : showSkeleton ? (
          <JudgingSkeleton t={t} />
        ) : !payload || payload.judgments.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              tone="subtle"
              title={t('noJudgeTitle')}
              description={t('noJudgeDesc')}
            />
          </div>
        ) : displayItems.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              tone="subtle"
              title={t('noFilterMatchTitle')}
              description={t('noFilterMatchDesc')}
            />
          </div>
        ) : (
          <table className="w-full border-collapse text-md">
            <thead className="sticky top-0 z-table-sticky bg-paper-soft text-left">
              <tr>
                {/* 브리지 선택 열 — 전체선택(현재 fit 필터로 보이는 행 대상). */}
                <th className="w-10 border-b border-line px-4 py-2.5">
                  <SelectAllCheckbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    ariaLabel={t('selectAllAria')}
                    onChange={(checked) => onToggleAll(visibleIds, checked)}
                  />
                </th>
                {[
                  t('colRespondent'),
                  t('colGender'),
                  t('colAge'),
                  t('colRegion'),
                  t('colFitReason'),
                ].map((h) => (
                  // whitespace-nowrap = 헤더 컬럼명 줄바꿈 금지(round-2 feedback
                  // #1: RESPONDENT → RESPONDEN/T wrap). 좁은 폭에서도 라벨 한 줄 유지.
                  <th
                    key={h}
                    className="whitespace-nowrap border-b border-line px-4 py-2.5 font-mono-label text-xs-soft uppercase tracking-[0.05em] text-mute-soft"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayItems.map((item, pos) => {
                const { j, num } = item;
                const isSelected = selected.has(j.response_key);
                return (
                  <tr
                    key={j.response_key}
                    onClick={() => openRow(pos)}
                    className={`cursor-pointer border-b border-ink/[0.08] last:border-b-0 ${
                      // 선택행 = mint 틴트(#f4fbf6 = success-bg). 미선택 hover 만.
                      isSelected ? 'bg-success-bg' : 'hover:bg-paper-soft'
                    }`}
                  >
                    {/* 체크박스 셀 — 클릭이 드로어를 열지 않도록 stopPropagation. */}
                    <td
                      className="w-10 px-4 py-[11px] align-top"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={isSelected}
                        aria-label={t('selectRowAria')}
                        onChange={() => onToggleRow(j.response_key)}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-[11px] align-top">
                      <span className="flex items-center gap-1.5 font-mono-label font-extrabold tabular-nums text-ink-2">
                        #{num}
                        {j.flags.length > 0 && (
                          <span
                            title={j.flags
                              .map((f) => flagText(f, t))
                              .join(', ')}
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
                        <FitBadge fit={j.fit} t={t} />
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
              ? t('footerAll', {
                  count: payload.judgments.length,
                  high: fitCounts.high,
                  medium: fitCounts.medium,
                  low: fitCounts.low,
                })
              : t('footerFiltered', {
                  shown: displayItems.length,
                  total: payload.judgments.length,
                })
            : t('footerEmpty')}
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

// 전체 선택 헤더 체크박스 — Checkbox primitive 은 native <input> 이라
// indeterminate 를 prop 으로 못 받는다(DOM 프로퍼티). 일부만 선택된 상태를
// ref 로 직접 세팅(responses-spreadsheet 선례 미러).
function SelectAllCheckbox({
  checked,
  indeterminate,
  ariaLabel,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  ariaLabel: string;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <Checkbox
      ref={ref}
      checked={checked}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

function JudgingSkeleton({
  t,
}: {
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-5 py-3 text-sm text-mute-soft">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
        {t('judgingLabel')}
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
