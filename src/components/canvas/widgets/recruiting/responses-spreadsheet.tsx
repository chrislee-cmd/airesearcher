'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { MochiLoader } from '@/components/ui/mochi-loader';
import { Select } from '@/components/ui/select';
import {
  isContactColumnTitle,
  isPrivacyConsentColumnTitle,
} from '@/lib/recruiting/contact-filter';
import type { FormColumn, FormResponseRow } from '@/lib/google-forms';

// fullview 응답 spreadsheet — 발행된 리크루팅 폼들의 응답을 인앱 표로
// 렌더한다. 데이터는 기존 Forms-API 기반 엔드포인트를 그대로 재사용:
//   GET /api/recruiting/google/forms/list           → 발행 폼 목록
//   GET /api/recruiting/google/forms/[id]/responses → 컬럼 + 행
// (별도 Sheets-API pull 을 새로 만들지 않는 이유: 위 responses 엔드포인트가
//  이미 소유권 검증 + admin-proxy 토큰 라우팅 + 연락처/동의 컬럼 server-side
//  strip 을 수행한다. Sheets values.get 으로 raw 시트를 직접 읽으면 그
//  개인정보 필터를 우회하게 됨 — privacy 회귀.)

// row 가 매우 많을 때 (1000+) 가상화 없이 전부 그리면 fullview 가 버벅인다.
// 이번 PR scope 는 첫 200 행으로 cap — 가상화는 후속 spec.
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
  total?: number;
  consented?: number;
};

// 서버가 이미 연락처/동의 컬럼을 strip 하지만, 미래 서버 변경이 하나라도
// 놓쳤을 때를 대비해 동일 술어를 client 에서도 재적용한다 (attendee-review
// 모달과 같은 방어).
function visibleColumns(columns: FormColumn[]): FormColumn[] {
  return columns.filter(
    (c) =>
      !isContactColumnTitle(c.title) && !isPrivacyConsentColumnTitle(c.title),
  );
}

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
  const [forms, setForms] = useState<FormSummary[] | null>(null);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);

  const [data, setData] = useState<ResponsesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // 2) 선택된 폼의 응답 로드.
  const loadResponses = useCallback(async (formId: string) => {
    setLoading(true);
    setError(null);
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

  const columns = useMemo(
    () => (data ? visibleColumns(data.columns) : []),
    [data],
  );
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
              description="설문 링크를 공유한 뒤 응답이 들어오면 여기서 확인할 수 있어요. 전화번호·이메일은 표시되지 않습니다."
            />
          </div>
        ) : (
          <ResponseTable columns={columns} rows={cappedRows} />
        )}
      </div>

      {/* Footer */}
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line-soft bg-paper-soft px-5 py-2 text-xs-soft text-mute-soft">
        <span className="tabular-nums">
          {data && totalRows > 0
            ? totalRows > ROW_CAP
              ? `총 ${totalRows} 응답 · 처음 ${ROW_CAP}개 표시`
              : `총 ${totalRows} 응답`
            : '개인정보 보호를 위해 전화번호·이메일은 표에서 제외됩니다.'}
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

function ResponseTable({
  columns,
  rows,
}: {
  columns: FormColumn[];
  rows: FormResponseRow[];
}) {
  return (
    <table className="w-full border-collapse text-md">
      <thead className="sticky top-0 z-table-sticky bg-paper-soft text-left">
        <tr>
          <th className="border-b border-line-soft px-3 py-2 text-xs-soft uppercase tracking-[0.04em] text-mute-soft">
            응답 시각
          </th>
          {columns.map((c) => (
            <th
              key={c.questionId}
              className="border-b border-line-soft px-3 py-2 text-xs-soft uppercase tracking-[0.04em] text-mute-soft"
            >
              {c.title}
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
            <td className="px-3 py-2 align-top tabular-nums text-mute">
              {formatSubmittedAt(r.lastSubmittedTime || r.createTime)}
            </td>
            {columns.map((c) => (
              <td key={c.questionId} className="px-3 py-2 align-top text-ink-2">
                {r.answers[c.questionId] || (
                  <span className="text-mute-soft">—</span>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
