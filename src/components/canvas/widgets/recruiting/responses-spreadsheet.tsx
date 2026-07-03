'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { MochiLoader } from '@/components/ui/mochi-loader';
import { Select } from '@/components/ui/select';
import { usePaywall } from '@/components/paywall-provider';
import { isPiiColumn, PII_MASK } from '@/lib/recruiting-pii';
import { track as trackEvent } from '@/lib/analytics/events';
import type { FormColumn, FormResponseRow } from '@/lib/google-forms';

// fullview 응답 spreadsheet — 발행된 리크루팅 폼들의 응답을 인앱 표로
// 렌더한다. 데이터는 기존 Forms-API 기반 엔드포인트를 그대로 재사용:
//   GET /api/recruiting/google/forms/list           → 발행 폼 목록
//   GET /api/recruiting/google/forms/[id]/responses → 컬럼 + 행
//
// 개인정보(PII) 컬럼(이름/전화/이메일/주소/생년월일/나이)은 좌측으로 일괄
// 정렬되고 기본적으로 마스킹된다. responses 엔드포인트는 PII 컬럼의 *값*을
// 서버에서 blank 처리해 보내므로, 실제 값은 오직 크레딧 잠금 해제
// (POST /api/recruiting/fullview/unlock, 5💎/row) 를 통해서만 서버에서
// 내려온다 — 브라우저 payload 로는 마스킹 전 원본 PII 가 흐르지 않는다.
const ROW_CAP = 200;

type FormSummary = {
  formId: string;
  title: string | null;
  responderUri: string | null;
  editUri: string | null;
  sheetUrl: string | null;
  createdAt: string;
};

type ResponsesPayload = {
  formId: string;
  title: string;
  columns: FormColumn[];
  rows: FormResponseRow[];
  piiQuestionIds?: string[];
  total?: number;
  consented?: number;
};

function formatPublishedAt(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function formatSubmittedAt(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function selectorLabel(f: FormSummary): string {
  const title = f.title?.trim() || '제목 없는 설문';
  const date = formatPublishedAt(f.createdAt);
  return date ? `${title} (${date})` : title;
}

export function ResponsesSpreadsheet() {
  const { refresh: refreshCredits } = usePaywall();
  const [forms, setForms] = useState<FormSummary[] | null>(null);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);

  const [data, setData] = useState<ResponsesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Unlock state is intentionally in-memory (not localStorage): closing the
  // tab or navigating away re-locks every row, minimising PII leak surface
  // and re-triggering the paywall on revisit (spec: 세션 종료 시 리셋).
  const [unlockedRows, setUnlockedRows] = useState<Set<string>>(new Set());
  const [unlockingRows, setUnlockingRows] = useState<Set<string>>(new Set());
  const [unlockedAnswers, setUnlockedAnswers] = useState<
    Record<string, Record<string, string>>
  >({});

  // 1) 발행 폼 목록 로드 — 가장 최근 발행 폼을 default 선택.
  const loadForms = useCallback(async () => {
    setFormsError(null);
    try {
      const res = await fetch('/api/recruiting/google/forms/list');
      const j = (await res.json().catch(() => ({}))) as
        | { forms?: FormSummary[] }
        | { error?: string };
      if (!res.ok) {
        throw new Error(
          ('error' in j && j.error) || `forms_list_failed: ${res.statusText}`,
        );
      }
      const list = ('forms' in j && j.forms ? j.forms : []) as FormSummary[];
      setForms(list);
      setSelectedFormId((prev) => prev ?? list[0]?.formId ?? null);
    } catch (e) {
      setFormsError(e instanceof Error ? e.message : 'forms_list_failed');
      setForms([]);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await loadForms();
    })();
  }, [loadForms]);

  // 2) 선택된 폼의 응답 로드. 폼을 바꾸면 잠금 상태도 리셋.
  const loadResponses = useCallback(async (formId: string) => {
    setLoading(true);
    setError(null);
    setUnlockedRows(new Set());
    setUnlockingRows(new Set());
    setUnlockedAnswers({});
    try {
      const res = await fetch(
        `/api/recruiting/google/forms/${encodeURIComponent(formId)}/responses`,
      );
      const j = (await res.json().catch(() => ({}))) as
        | ResponsesPayload
        | { error?: string };
      if (!res.ok) {
        throw new Error(
          ('error' in j && j.error) || `responses_failed: ${res.statusText}`,
        );
      }
      setData(j as ResponsesPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'responses_failed');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedFormId) return;
    void (async () => {
      await loadResponses(selectedFormId);
    })();
  }, [selectedFormId, loadResponses]);

  const unlockRow = useCallback(
    async (rowId: string) => {
      if (!selectedFormId) return;
      if (unlockedRows.has(rowId) || unlockingRows.has(rowId)) return;
      setUnlockingRows((prev) => new Set(prev).add(rowId));
      try {
        // 402 → PaywallProvider 의 전역 fetch interceptor 가 결제 modal 을
        // 자동으로 연다. 여기선 성공 시 값 반영 + 잔액 갱신만.
        const res = await fetch('/api/recruiting/fullview/unlock', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ formId: selectedFormId, rowId }),
        });
        if (!res.ok) return;
        const j = (await res.json().catch(() => ({}))) as {
          answers?: Record<string, string>;
        };
        setUnlockedAnswers((prev) => ({ ...prev, [rowId]: j.answers ?? {} }));
        setUnlockedRows((prev) => new Set(prev).add(rowId));
        trackEvent('widget_action', {
          widget: 'recruiting',
          action: 'response_unlock',
          metadata: { row_id: rowId },
        });
        void refreshCredits();
      } finally {
        setUnlockingRows((prev) => {
          const next = new Set(prev);
          next.delete(rowId);
          return next;
        });
      }
    },
    [selectedFormId, unlockedRows, unlockingRows, refreshCredits],
  );

  const selectedForm = useMemo(
    () => forms?.find((f) => f.formId === selectedFormId) ?? null,
    [forms, selectedFormId],
  );

  const columns = useMemo(() => (data ? data.columns : []), [data]);
  const piiQids = useMemo(() => {
    const fromServer = data?.piiQuestionIds ?? [];
    const set = new Set(fromServer);
    // 서버 목록을 신뢰하되, title 기반으로도 한 번 더 판정(방어).
    for (const c of columns) if (isPiiColumn(c.title)) set.add(c.questionId);
    return set;
  }, [data, columns]);

  const totalRows = data?.rows.length ?? 0;
  const cappedRows = useMemo(
    () => (data ? data.rows.slice(0, ROW_CAP) : []),
    [data],
  );

  // Google 미연동 / 재동의 필요는 responses 엔드포인트가 412 + 명시
  // 에러코드로 알려준다. 그 경우 일반 에러 배너 대신 연동 안내를 띄운다.
  const needsGoogle =
    error === 'google_not_connected' || error === 'reconsent_required';

  // ── 폼 목록 자체 로딩 중 ──
  if (forms === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <MochiLoader size={36} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Form selector */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3">
        {forms.length > 0 ? (
          <Select
            size="sm"
            fullWidth={false}
            aria-label="설문 선택"
            className="min-w-[280px]"
            value={selectedFormId ?? ''}
            onChange={(e) => setSelectedFormId(e.target.value || null)}
            options={forms.map((f) => ({
              value: f.formId,
              label: selectorLabel(f),
            }))}
          />
        ) : (
          <span className="text-sm text-mute-soft">발행된 설문 없음</span>
        )}
        {selectedFormId && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadResponses(selectedFormId)}
            disabled={loading}
          >
            {loading ? '갱신 중…' : '새로고침'}
          </Button>
        )}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto bg-paper">
        {formsError ? (
          <div className="p-5">
            <ErrorBanner message={`설문 목록을 불러오지 못했어요: ${formsError}`} />
          </div>
        ) : forms.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              tone="subtle"
              title="아직 발행된 설문이 없습니다"
              description="카드 본문에서 새 설문을 만들고 발행하면 여기서 응답을 확인할 수 있어요."
            />
          </div>
        ) : loading && !data ? (
          <div className="flex h-full items-center justify-center">
            <MochiLoader size={36} />
          </div>
        ) : needsGoogle ? (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              tone="subtle"
              title="Google 계정 연동이 필요합니다"
              description="응답 시트를 읽으려면 Google 연동(응답 읽기 권한)이 필요해요. 카드 본문에서 Google 연동을 마친 뒤 다시 시도해 주세요."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    selectedFormId && void loadResponses(selectedFormId)
                  }
                >
                  다시 시도
                </Button>
              }
            />
          </div>
        ) : error ? (
          <div className="p-5">
            <ErrorBanner message={`응답을 불러오지 못했어요: ${error}`} />
            <div className="mt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  selectedFormId && void loadResponses(selectedFormId)
                }
              >
                다시 시도
              </Button>
            </div>
          </div>
        ) : !data || totalRows === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              tone="subtle"
              title="아직 응답이 없습니다"
              description="설문 링크를 공유한 뒤 응답이 들어오면 여기서 확인할 수 있어요. 개인정보는 기본 잠금 상태로 표시됩니다."
            />
          </div>
        ) : (
          <ResponseTable
            columns={columns}
            piiQids={piiQids}
            rows={cappedRows}
            unlockedRows={unlockedRows}
            unlockingRows={unlockingRows}
            unlockedAnswers={unlockedAnswers}
            onUnlock={(rowId) => void unlockRow(rowId)}
          />
        )}
      </div>

      {/* Footer */}
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line-soft bg-paper-soft px-5 py-2 text-xs-soft text-mute-soft">
        <span className="tabular-nums">
          {data && totalRows > 0
            ? totalRows > ROW_CAP
              ? `총 ${totalRows} 응답 · 처음 ${ROW_CAP}개 표시`
              : `총 ${totalRows} 응답`
            : '개인정보는 기본 잠금 상태이며, 해제 시 5크레딧이 차감됩니다.'}
        </span>
        {selectedForm?.sheetUrl ? (
          <a
            href={selectedForm.sheetUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-amore underline-offset-2 hover:underline"
          >
            ↗ Google Sheets 에서 열기
          </a>
        ) : selectedForm?.responderUri ? (
          <a
            href={selectedForm.responderUri}
            target="_blank"
            rel="noreferrer noopener"
            className="text-amore underline-offset-2 hover:underline"
          >
            ↗ 설문 폼 열기
          </a>
        ) : null}
      </footer>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-sm border-[2px] border-warning-line bg-warning-bg p-3 text-md text-ink-2 shadow-[2px_2px_0_var(--color-warning)]">
      {message}
    </div>
  );
}

// 렌더 컬럼 모델 — PII 를 좌측으로 몰고, 그 다음 '응답 시각', 그 다음 나머지.
// PII 가 하나라도 있으면 맨 앞에 잠금 해제 액션 열을 둔다.
type RenderCol =
  | { kind: 'action' }
  | { kind: 'time' }
  | { kind: 'field'; col: FormColumn; pii: boolean };

function ResponseTable({
  columns,
  piiQids,
  rows,
  unlockedRows,
  unlockingRows,
  unlockedAnswers,
  onUnlock,
}: {
  columns: FormColumn[];
  piiQids: Set<string>;
  rows: FormResponseRow[];
  unlockedRows: Set<string>;
  unlockingRows: Set<string>;
  unlockedAnswers: Record<string, Record<string, string>>;
  onUnlock: (rowId: string) => void;
}) {
  const piiCols = columns.filter((c) => piiQids.has(c.questionId));
  const nonPiiCols = columns.filter((c) => !piiQids.has(c.questionId));
  const hasPii = piiCols.length > 0;

  const renderCols: RenderCol[] = [
    ...(hasPii ? [{ kind: 'action' } as const] : []),
    ...piiCols.map((col) => ({ kind: 'field', col, pii: true }) as const),
    { kind: 'time' } as const,
    ...nonPiiCols.map((col) => ({ kind: 'field', col, pii: false }) as const),
  ];

  // 컬럼별 최소 폭 — 긴 질문 헤더(20+자)가 wrap 되지 않도록 field 는 180px,
  // 액션(잠금 해제 버튼) 은 140px, 응답 시각은 nowrap 으로 자연 폭 유지.
  // min-w-max table 과 결합해 좁은 화면에서 부모의 overflow-x 로 수평 스크롤.
  const colWidthClass = (rc: RenderCol) =>
    rc.kind === 'action'
      ? 'min-w-[140px]'
      : rc.kind === 'time'
        ? 'whitespace-nowrap'
        : 'min-w-[180px]';

  return (
    <table className="min-w-max border-collapse text-md">
      <thead className="sticky top-0 z-table-sticky bg-paper-soft text-left">
        <tr>
          {renderCols.map((rc, i) => (
            <th
              key={
                rc.kind === 'field' ? rc.col.questionId : `${rc.kind}-${i}`
              }
              className={`whitespace-nowrap border-b border-line-soft px-3 py-2 text-xs-soft uppercase tracking-[0.04em] text-mute-soft ${colWidthClass(rc)}`}
            >
              {rc.kind === 'action'
                ? '개인정보'
                : rc.kind === 'time'
                  ? '응답 시각'
                  : rc.col.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const unlocked = unlockedRows.has(r.responseId);
          const unlocking = unlockingRows.has(r.responseId);
          const revealed = unlockedAnswers[r.responseId];
          return (
            <tr
              key={r.responseId}
              className="border-b border-line-soft last:border-b-0"
            >
              {renderCols.map((rc, i) => {
                if (rc.kind === 'action') {
                  return (
                    <td
                      key={`action-${i}`}
                      className="min-w-[140px] px-3 py-2 align-top"
                    >
                      {unlocked ? (
                        <span className="whitespace-nowrap text-xs-soft text-mute-soft">
                          ✓ 해제됨
                        </span>
                      ) : (
                        <Button
                          variant="secondary"
                          size="xs"
                          disabled={unlocking}
                          onClick={() => onUnlock(r.responseId)}
                        >
                          {unlocking ? '해제 중…' : '🔒 해제 (5💎)'}
                        </Button>
                      )}
                    </td>
                  );
                }
                if (rc.kind === 'time') {
                  return (
                    <td
                      key={`time-${i}`}
                      className="whitespace-nowrap px-3 py-2 align-top tabular-nums text-mute"
                    >
                      {formatSubmittedAt(r.lastSubmittedTime || r.createTime)}
                    </td>
                  );
                }
                const qid = rc.col.questionId;
                if (rc.pii) {
                  if (unlocked) {
                    const val = revealed?.[qid];
                    return (
                      <td
                        key={qid}
                        className="min-w-[180px] px-3 py-2 align-top text-ink-2"
                      >
                        {val || <span className="text-mute-soft">—</span>}
                      </td>
                    );
                  }
                  return (
                    <td
                      key={qid}
                      className="min-w-[180px] px-3 py-2 align-top tracking-[0.12em] text-mute-soft"
                    >
                      {PII_MASK}
                    </td>
                  );
                }
                return (
                  <td
                    key={qid}
                    className="min-w-[180px] px-3 py-2 align-top text-ink-2"
                  >
                    {r.answers[qid] || (
                      <span className="text-mute-soft">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
