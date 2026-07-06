'use client';

/* ────────────────────────────────────────────────────────────────────
   JudgedListTable — 리크루팅 fullview 의 default 응답 뷰. raw 스프레드시트
   대신 응답자별 **종합 판단 요약**을 리스트로 보여준다.

   데이터 = GET /api/recruiting/google/forms/[formId]/judgments
     → { judgments: ResponseJudgment[], total, judged, cached }
   각 판단 = 익명 응답자 + demographics(성별/연령/거주지) + 부합도(high/
   medium/low) + 근거 한 줄 + 불성실 flags. (백엔드 스펙
   pr-recruiting-persona-fit-judgment-backend — 이미 main 머지됨.)

   - 부합도 높음 우선 정렬 default + fit 필터 칩(전체/높음/중간/낮음).
   - 판단 API 는 콜드 스타트 시 LLM 배치를 동기로 돌려(최대 300s) 응답이
     늦을 수 있어, 로딩 중엔 skeleton row + "판단 중" 상태를 보여준다.
   - 행 클릭 = RespondentDrawer 로 그 응답자의 전 문항 Q→A 한 장 열람.
     Q→A 원본은 host 가 lift 해 넘겨준 responseData(컬럼+행)에서 파생하고,
     judgment.response_key === row.responseId 로 매칭한다.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Banner } from '../../shell/banner';
import { track as trackEvent } from '@/lib/analytics/events';
import type { FormColumn, FormResponseRow } from '@/lib/google-forms';
import type {
  PersonaFit,
  ResponseJudgment,
} from '@/lib/recruiting/persona-fit';
import { RespondentDrawer } from './respondent-drawer';

// ─── fit 배지 (drawer 와 공유) ───────────────────────────────────────────
// 단일 amore 액센트 + signal 토큰만 사용. high=success(초록), medium=amore,
// low=중성(mute). 임의 hex 없음 — 모두 정의된 색 토큰.
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
    text: 'text-amore',
    border: 'border-amore',
    bg: 'bg-amore/10',
  },
  low: {
    label: '낮음',
    dot: 'bg-mute',
    text: 'text-mute',
    border: 'border-line',
    bg: 'bg-paper-soft',
  },
};

export function FitBadge({ fit }: { fit: PersonaFit | null }) {
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
      className={`inline-flex items-center gap-1.5 rounded-full border ${m.border} ${m.bg} px-2 py-0.5 text-xs-soft font-semibold ${m.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} aria-hidden="true" />
      {m.label}
    </span>
  );
}

// flag 원문(모델이 자유 태그)을 그대로 노출하되, 흔한 영어 키워드는 한글로
// 얕게 매핑. 매핑 없으면 원문 그대로 — 정보 손실 없이 방어적으로.
export function FLAG_LABEL(flag: string): string {
  const f = flag.toLowerCase();
  if (f.includes('duplicate') || f.includes('중복')) return '중복 응답';
  if (f.includes('short') || f.includes('한 글자') || f.includes('한글자'))
    return '단답 의심';
  if (f.includes('contradict') || f.includes('모순')) return '모순 응답';
  if (f.includes('nonsense') || f.includes('무의미')) return '무의미 응답';
  return flag;
}

// ─── 정렬/필터 ────────────────────────────────────────────────────────────
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

export function JudgedListTable({
  formId,
  responseData,
  refreshSignal,
}: {
  formId: string | null;
  // host 가 lift 한 응답(컬럼+행) — drawer 의 Q→A 원본. null = 아직 로드 전.
  responseData: { columns: FormColumn[]; rows: FormResponseRow[] } | null;
  // host 상단 "새로고침" 이 눌릴 때마다 증가 — 판단도 다시 불러온다.
  refreshSignal: number;
}) {
  const [payload, setPayload] = useState<JudgmentsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fitFilter, setFitFilter] = useState<FitFilter>('all');
  // 열린 drawer 의 위치(정렬·필터가 적용된 displayItems 기준 인덱스). null = 닫힘.
  const [openPos, setOpenPos] = useState<number | null>(null);

  const loadJudgments = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    // (재)로드 시작 시 열린 drawer 는 닫는다 — 정렬/필터가 바뀌면 openPos 가
    // 다른 응답자를 가리킬 수 있으므로. (콜백 안 setState 라 effect 동기
    // setState 룰에 걸리지 않음 — responses-spreadsheet 의 loadResponses 동일.)
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
      setPayload(j as JudgmentsPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'judgments_failed');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // 폼이 바뀌면 이전 판단/필터를 즉시 리셋 — effect 동기 setState 대신
  // render-phase 조정(React 권장, recruiting-card 의 prevFormId 패턴과 동일).
  // 이렇게 하면 폼 전환이 한 커밋 안에서 리셋과 함께 반영되고, 옛 폼 판단이
  // 잠깐 깜빡이지 않는다. openPos(drawer) 리셋은 loadJudgments 가 담당.
  const [prevFormId, setPrevFormId] = useState(formId);
  if (formId !== prevFormId) {
    setPrevFormId(formId);
    setPayload(null);
    setFitFilter('all');
  }

  // 폼이 바뀌면 새 폼의 판단을 로드. (async IIFE 래핑 — responses-spreadsheet
  // 의 loadResponses effect 와 동일 패턴, effect 동기 setState 룰 회피.)
  useEffect(() => {
    if (!formId) return;
    void (async () => {
      await loadJudgments(formId);
    })();
  }, [formId, loadJudgments]);

  // 상단 통합 새로고침 — 신규 응답이 들어왔을 수 있으니 판단을 재조회
  // (증분 판단이라 새 row 만 LLM 을 태운다). 초기 마운트(refreshSignal=0)엔
  // 위 폼 로드 effect 가 이미 돌므로 중복 호출을 피한다.
  useEffect(() => {
    if (refreshSignal === 0 || !formId) return;
    void (async () => {
      await loadJudgments(formId);
    })();
  }, [refreshSignal, formId, loadJudgments]);

  // 응답 row 를 responseId 로 인덱싱 — drawer Q→A 매칭 (judgment.response_key).
  const rowByKey = useMemo(() => {
    const m = new Map<string, FormResponseRow>();
    for (const r of responseData?.rows ?? []) m.set(r.responseId, r);
    return m;
  }, [responseData]);

  // Q→A 에 쓸 컬럼 — PII 컬럼도 포함해 "전 문항" 을 보이되 값은 drawer 가
  // 잠금 처리(값 자체는 서버에서 이미 마스킹). 여기선 순서만 유지.
  const drawerColumns = responseData?.columns ?? [];

  // 응답 순서 기준 고정 번호(#N)를 부여한 뒤 필터+정렬. 라벨은 정렬과 무관하게
  // 원래 순서에 고정된다.
  const displayItems = useMemo(() => {
    const withNum = (payload?.judgments ?? []).map((j, i) => ({
      j,
      num: i + 1,
    }));
    const filtered =
      fitFilter === 'all'
        ? withNum
        : withNum.filter((x) => x.j.fit === fitFilter);
    // 안정 정렬: 부합도 높음 우선, 동급이면 원래 응답 순서 유지.
    return filtered
      .map((x, idx) => ({ ...x, idx }))
      .sort((a, b) => {
        const r = fitRank(a.j.fit) - fitRank(b.j.fit);
        return r !== 0 ? r : a.idx - b.idx;
      });
  }, [payload, fitFilter]);

  const openRow = useCallback(
    (pos: number) => {
      setOpenPos(pos);
      trackEvent('widget_action', {
        widget: 'recruiting',
        action: 'judged_drawer_open',
      });
    },
    [],
  );

  const fitCounts = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0 } as Record<PersonaFit, number>;
    for (const j of payload?.judgments ?? []) if (j.fit) c[j.fit] += 1;
    return c;
  }, [payload]);

  // ── 렌더 ──
  const noForm = !formId;
  const showSkeleton = loading && !payload;

  const open = openPos != null && displayItems[openPos] != null;
  const active = open ? displayItems[openPos] : null;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* 필터 칩 바 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-soft px-5 py-2.5">
        {FILTER_CHIPS.map((chip) => {
          const activeChip = fitFilter === chip.key;
          const count =
            chip.key === 'all'
              ? (payload?.judgments.length ?? 0)
              : fitCounts[chip.key];
          return (
            <Button
              key={chip.key}
              variant={activeChip ? 'primary' : 'ghost'}
              size="xs"
              aria-pressed={activeChip}
              onClick={() => setFitFilter(chip.key)}
            >
              {chip.label}
              {payload ? ` ${count}` : ''}
            </Button>
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
                {['응답자', '성별', '연령', '거주지', '부합도 · 근거'].map(
                  (h) => (
                    <th
                      key={h}
                      className="border-b border-line-soft px-3 py-2 text-xs-soft uppercase tracking-[0.04em] text-mute-soft"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {displayItems.map((item, pos) => {
                const { j, num } = item;
                return (
                  <tr
                    key={j.response_key}
                    onClick={() => openRow(pos)}
                    className="cursor-pointer border-b border-line-soft last:border-b-0 hover:bg-paper-soft"
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 align-top">
                      <span className="flex items-center gap-1.5 font-semibold tabular-nums text-ink-2">
                        #{num}
                        {j.flags.length > 0 && (
                          <span
                            title={j.flags.map(FLAG_LABEL).join(', ')}
                            className="rounded-full border border-warning-line bg-warning-bg px-1.5 text-xs-soft font-semibold text-ink-2"
                          >
                            ⚠ {j.flags.length}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-top text-ink-2">
                      {j.gender ?? <span className="text-mute-soft">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-top text-ink-2">
                      {j.age_group ?? <span className="text-mute-soft">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-top text-ink-2">
                      {j.region ?? <span className="text-mute-soft">—</span>}
                    </td>
                    <td className="px-3 py-2.5 align-top">
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

      {/* 푸터 = 응답자 수 요약 */}
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-line-soft bg-paper-soft px-5 py-2 text-xs-soft text-mute-soft">
        <span className="tabular-nums">
          {payload
            ? fitFilter === 'all'
              ? `총 ${payload.judgments.length} 응답 · 높음 ${fitCounts.high} · 중간 ${fitCounts.medium} · 낮음 ${fitCounts.low}`
              : `${displayItems.length} / ${payload.judgments.length} 응답 표시`
            : '이름·전화 등 개인정보는 판단에 반영되나 표시되지 않습니다.'}
        </span>
      </footer>

      <RespondentDrawer
        open={open}
        label={active ? `#${active.num}` : ''}
        judgment={active?.j ?? null}
        columns={drawerColumns}
        row={
          active ? (rowByKey.get(active.j.response_key) ?? null) : null
        }
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

// 판단 로딩(콜드 스타트 시 LLM 배치 대기) 동안의 skeleton — "판단 중" 신호.
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
          className="flex items-center gap-4 border-b border-line-soft px-5 py-3"
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
