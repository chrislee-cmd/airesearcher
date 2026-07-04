'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { MochiLoader } from '@/components/ui/mochi-loader';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/toast-provider';
import { isPiiColumn, PII_MASK } from '@/lib/recruiting-pii';
import { track as trackEvent } from '@/lib/analytics/events';
import type { FormColumn, FormResponseRow } from '@/lib/google-forms';
import {
  buildFilterableQuestions,
  rowMatchesFilter,
  type FilterableQuestion,
  type RecruitingFilter,
} from '@/lib/recruiting/distribution';
import type { RecruitingBrief } from '@/lib/recruiting-schema';

type Criterion = RecruitingBrief['criteria'][number];

// fullview 응답 spreadsheet — 발행된 리크루팅 폼들의 응답을 인앱 표로
// 렌더한다. 데이터는 기존 Forms-API 기반 엔드포인트를 그대로 재사용:
//   GET /api/recruiting/google/forms/list           → 발행 폼 목록
//   GET /api/recruiting/google/forms/[id]/responses → 컬럼 + 행
//
// 개인정보(PII) 컬럼(이름/전화)은 좌측으로 일괄 정렬되고 **항상** 마스킹된다.
// responses 엔드포인트가 PII 컬럼의 *값*을 서버에서 blank 처리해 보내므로
// 브라우저 payload 로는 마스킹 전 원본 PII 가 절대 흐르지 않는다 — 유저 뷰엔
// 어떤 경우에도 연락처가 노출되지 않는다 (옛 크레딧 잠금-해제 흐름은 폐기).
//
// 대신 각 응답자 row 좌측에 초대 대상 체크박스를 두고, 상단 CTA 로 여러 명을
// 한 번에 골라 초대 요청(POST /api/recruiting/invitations)을 넣는다. 요청은
// 무료 — super admin 이 out-of-band 로 실제 초대를 대행한다.
const ROW_CAP = 200;

export type FormSummary = {
  formId: string;
  title: string | null;
  responderUri: string | null;
  editUri: string | null;
  sheetUrl: string | null;
  // 발행 시 저장된 대상자 조건/요약 (migration 20260703060414). 옛 폼이나
  // 마이그 미적용 환경에서는 null — 이때 호스트 카드가 wizard 의 실시간
  // state 로 fallback 한다.
  criteria: Criterion[] | null;
  summary: string | null;
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

export function ResponsesSpreadsheet({
  onSelectedFormChange,
  onFormsLoadingChange,
  onRegisterRefresh,
  activeFilter = null,
  onFilterableQuestionsChange,
}: {
  // Surfaces the currently-selected form (with its stored 조건/요약) to the
  // host card so the fullview 조건 panel mirrors *this* form, not just the
  // wizard's last-analysed brief.
  onSelectedFormChange?: (form: FormSummary | null) => void;
  // Reports whether the published-forms list is still loading, so the host can
  // tell the 분포 위젯 to show a loader (not "발행 설문 없음") while formId is
  // still null on first paint. spreadsheet 이 폼 selector 의 SSOT 라 로딩 상태도
  // 여기서 lift 한다.
  onFormsLoadingChange?: (loading: boolean) => void;
  // Hands this table's refresh up to the fullview host so the shared 상단
  // "새로고침" 버튼이 분포와 함께 응답 spreadsheet 도 refetch 한다. 옛
  // spreadsheet-내부 새로고침 버튼을 대체한다 (spec B).
  onRegisterRefresh?: (fn: () => void) => void;
  // Crossfilter (2026-07-04): host 가 보유한 활성 필터(분포 셀 or 질문 필터).
  // null = 전체 응답. spreadsheet 은 이 필터로 보이는 행을 좁힌다.
  activeFilter?: RecruitingFilter | null;
  // 로드된 응답 컬럼에서 파생한 객관식 질문 목록(+답변 옵션)을 host 로 올려
  // 분포 패널의 질문 필터 dropdown 이 쓰게 한다.
  onFilterableQuestionsChange?: (questions: FilterableQuestion[]) => void;
} = {}) {
  const { push: pushToast } = useToast();
  const [forms, setForms] = useState<FormSummary[] | null>(null);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);

  const [data, setData] = useState<ResponsesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 초대 대상으로 체크된 응답 row 들 (responseId set). 폼을 바꾸거나 응답을
  // 다시 로드하면 리셋된다 — 다른 폼의 응답을 잘못 초대하지 않도록.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [inviteConfirmOpen, setInviteConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

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

  // 2) 선택된 폼의 응답 로드. 폼을 바꾸면 초대 선택 상태를 리셋한다.
  const loadResponses = useCallback(async (formId: string) => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
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

  const selectedForm = useMemo(
    () => forms?.find((f) => f.formId === selectedFormId) ?? null,
    [forms, selectedFormId],
  );

  // Mirror the selected form (and its stored 조건) up to the host card.
  useEffect(() => {
    onSelectedFormChange?.(selectedForm);
  }, [selectedForm, onSelectedFormChange]);

  // Mirror forms-list loading state up (forms === null 이면 아직 로딩 중).
  useEffect(() => {
    onFormsLoadingChange?.(forms === null);
  }, [forms, onFormsLoadingChange]);

  // 현재 선택 폼의 응답을 refetch — 옛 spreadsheet-내부 새로고침 버튼과 동일한
  // 동작(폼 목록 재조회는 안 함, 최소 회귀). fullview 상단 통합 버튼이 호출.
  useEffect(() => {
    onRegisterRefresh?.(() => {
      if (selectedFormId) void loadResponses(selectedFormId);
    });
  }, [onRegisterRefresh, selectedFormId, loadResponses]);

  const columns = useMemo(() => (data ? data.columns : []), [data]);
  const piiQids = useMemo(() => {
    const fromServer = data?.piiQuestionIds ?? [];
    const set = new Set(fromServer);
    // 서버 목록을 신뢰하되, title 기반으로도 한 번 더 판정(방어).
    for (const c of columns) if (isPiiColumn(c.title)) set.add(c.questionId);
    return set;
  }, [data, columns]);

  // 객관식 질문 목록(+답변 옵션)을 host 로 lift → 분포 패널 질문 필터 dropdown.
  const filterableQuestions = useMemo(
    () => (data ? buildFilterableQuestions(data.columns, data.rows) : []),
    [data],
  );
  useEffect(() => {
    onFilterableQuestionsChange?.(filterableQuestions);
  }, [filterableQuestions, onFilterableQuestionsChange]);

  const totalRows = data?.rows.length ?? 0;
  const cappedRows = useMemo(
    () => (data ? data.rows.slice(0, ROW_CAP) : []),
    [data],
  );
  // 활성 필터(분포 셀 or 질문 답변)로 보이는 행을 좁힌다. 필터 없으면 전체.
  // nowYear 는 분포 crosstab 이 셀을 만들 때 쓴 것과 동일한 연도라 셀 클릭이
  // 정확히 그 셀을 만든 행에 매칭된다.
  const displayRows = useMemo(() => {
    if (!activeFilter) return cappedRows;
    const nowYear = new Date().getFullYear();
    return cappedRows.filter((r) =>
      rowMatchesFilter(r, activeFilter, columns, nowYear),
    );
  }, [cappedRows, activeFilter, columns]);
  const filteredOut = activeFilter != null;

  // ── 초대 선택 파생값 ──
  // 현재 화면에 보이는(필터 적용된) 행들의 id — 전체 선택 체크박스의 대상.
  const visibleIds = useMemo(
    () => displayRows.map((r) => r.responseId),
    [displayRows],
  );

  const toggleRow = useCallback((rowId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  // 전체 선택 = 현재 보이는 행 전부 선택, 해제 = 전부 해제. 필터 중이면 화면에
  // 안 보이는 행까지 선택되는 혼란을 피해 visibleIds 만 대상으로 한다.
  const toggleAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(visibleIds) : new Set());
    },
    [visibleIds],
  );

  const sendInvitations = useCallback(async () => {
    if (!selectedFormId || selected.size === 0) return;
    setSending(true);
    try {
      const res = await fetch('/api/recruiting/invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          form_id: selectedFormId,
          // FormSummary 엔 project_id 가 없어 항상 null 로 보낸다 (스펙의
          // selectedForm.project_id 는 이 payload 에 존재하지 않는 필드 —
          // 가장 보수적으로 null 처리). API 는 nullable 이라 안전.
          project_id: null,
          response_ids: Array.from(selected),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        pushToast(`초대 요청 실패: ${j.error ?? res.status}`, { tone: 'warn' });
        return;
      }
      const j = (await res.json().catch(() => ({}))) as { count?: number };
      const count = j.count ?? selected.size;
      trackEvent('widget_action', {
        widget: 'recruiting',
        action: 'invitation_request',
        metadata: { count },
      });
      pushToast(`${count}명 초대 요청 완료. 관리자가 처리합니다.`, {
        tone: 'amore',
      });
      setSelected(new Set());
      setInviteConfirmOpen(false);
    } catch {
      pushToast('초대 요청 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.', {
        tone: 'warn',
      });
    } finally {
      setSending(false);
    }
  }, [selectedFormId, selected, pushToast]);

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
      {/* Form selector + 초대 CTA */}
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
        {/* 새로고침 버튼은 fullview 상단 통합 버튼으로 이동 (spec B). 최소 1명
            선택 시 초대 요청 CTA 활성 — confirm modal 을 연다. */}
        {selected.size > 0 && (
          <Button
            variant="primary"
            size="sm"
            className="ml-auto"
            onClick={() => setInviteConfirmOpen(true)}
          >
            📧 초대 보내기 ({selected.size}명)
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
              description="설문 링크를 공유한 뒤 응답이 들어오면 여기서 확인할 수 있어요. 연락처 등 개인정보는 항상 가려진 상태로 표시됩니다."
            />
          </div>
        ) : filteredOut && displayRows.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              tone="subtle"
              title="조건에 맞는 응답이 없습니다"
              description="분포 셀 또는 질문 필터 조건에 해당하는 응답이 없어요. 상단 분포 패널에서 필터를 초기화하면 전체 응답이 다시 표시됩니다."
            />
          </div>
        ) : (
          <ResponseTable
            columns={columns}
            piiQids={piiQids}
            rows={displayRows}
            selected={selected}
            onToggleRow={toggleRow}
            onToggleAll={toggleAll}
          />
        )}
      </div>

      {/* Footer */}
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line-soft bg-paper-soft px-5 py-2 text-xs-soft text-mute-soft">
        <span className="tabular-nums">
          {data && totalRows > 0
            ? filteredOut
              ? `필터 적용 · ${displayRows.length} / ${totalRows} 응답 표시`
              : totalRows > ROW_CAP
                ? `총 ${totalRows} 응답 · 처음 ${ROW_CAP}개 표시`
                : `총 ${totalRows} 응답`
            : '연락처 등 개인정보는 항상 가려집니다.'}
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

      {/* 초대 요청 확인 modal — 크레딧 차감 없음(무료), super admin 이 대행. */}
      <Modal
        open={inviteConfirmOpen}
        onClose={() => !sending && setInviteConfirmOpen(false)}
        size="sm"
        title="초대 요청 보내기"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={sending}
              onClick={() => setInviteConfirmOpen(false)}
            >
              취소
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={sending}
              onClick={() => void sendInvitations()}
            >
              {sending ? '요청 중…' : `${selected.size}명 초대 요청`}
            </Button>
          </>
        }
      >
        <p className="text-md leading-[1.65] text-ink-2">
          선택한 응답자 <span className="font-semibold">{selected.size}명</span>{' '}
          에게 초대를 보내달라고 요청합니다.
        </p>
        <p className="mt-3 text-xs-soft text-mute-soft">
          크레딧이 차감되지 않으며, 실제 초대 발송은 관리자가 연락처를 확인해
          대행합니다.
        </p>
      </Modal>
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

// 렌더 컬럼 모델 — 맨 앞에 초대 대상 체크박스, 그 다음 PII(항상 마스킹)를 좌측
// 으로 몰고, 그 다음 '응답 시각', 그 다음 나머지.
type RenderCol =
  | { kind: 'select' }
  | { kind: 'time' }
  | { kind: 'field'; col: FormColumn; pii: boolean };

// 전체 선택 헤더 체크박스 — Checkbox primitive 은 native <input> 이라
// indeterminate 를 prop 으로 못 받는다 (DOM 프로퍼티라 ref 로만 설정). 일부만
// 선택된 상태를 시각적으로 나타내려면 여기서 ref 로 직접 세팅한다.
function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
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
      aria-label="전체 선택"
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

function ResponseTable({
  columns,
  piiQids,
  rows,
  selected,
  onToggleRow,
  onToggleAll,
}: {
  columns: FormColumn[];
  piiQids: Set<string>;
  rows: FormResponseRow[];
  selected: Set<string>;
  onToggleRow: (rowId: string) => void;
  onToggleAll: (checked: boolean) => void;
}) {
  const piiCols = columns.filter((c) => piiQids.has(c.questionId));
  const nonPiiCols = columns.filter((c) => !piiQids.has(c.questionId));

  const renderCols: RenderCol[] = [
    { kind: 'select' } as const,
    ...piiCols.map((col) => ({ kind: 'field', col, pii: true }) as const),
    { kind: 'time' } as const,
    ...nonPiiCols.map((col) => ({ kind: 'field', col, pii: false }) as const),
  ];

  // 컬럼별 최소 폭 — 긴 질문 헤더(20+자)가 wrap 되지 않도록 field 는 180px,
  // 선택(체크박스) 열은 좁게, 응답 시각은 nowrap 으로 자연 폭 유지.
  const colWidthClass = (rc: RenderCol) =>
    rc.kind === 'select'
      ? 'w-10'
      : rc.kind === 'time'
        ? 'whitespace-nowrap'
        : 'min-w-[180px]';

  const visibleSelectedCount = rows.filter((r) =>
    selected.has(r.responseId),
  ).length;
  const allSelected = rows.length > 0 && visibleSelectedCount === rows.length;
  const someSelected =
    visibleSelectedCount > 0 && visibleSelectedCount < rows.length;

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
              {rc.kind === 'select' ? (
                <SelectAllCheckbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={onToggleAll}
                />
              ) : rc.kind === 'time' ? (
                '응답 시각'
              ) : (
                rc.col.title
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.responseId}
            className="border-b border-line-soft last:border-b-0"
          >
            {renderCols.map((rc, i) => {
              if (rc.kind === 'select') {
                return (
                  <td key={`select-${i}`} className="w-10 px-3 py-2 align-top">
                    <Checkbox
                      checked={selected.has(r.responseId)}
                      aria-label="초대 대상 선택"
                      onChange={() => onToggleRow(r.responseId)}
                    />
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
                // PII 컬럼은 어떤 경우에도 마스킹 — 유저 뷰에 연락처 노출 X.
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
                  {r.answers[qid] || <span className="text-mute-soft">—</span>}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
