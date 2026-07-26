'use client';

/* ────────────────────────────────────────────────────────────────────
   JourneyIntakeBand — 저니 2탭화(#579)로 탭②(명단)이 제거되면서, 그 탭이
   소유하던 **유입 3종**(응답연동 카운트🔒 · CSV/Excel 업로드 · Google Sheets
   연동)을 탭①(응답)으로 이관한 접이식 "명단 소스" 밴드.

   이식(재구현 금지): 업로드/시트 인제스트·재동기화/재연결·연동됨 카드·에러
   노출 계약은 옛 journey-candidates-tab.tsx 의 소스 3-up 로직을 그대로 옮겼다
   (POST /batches/[inbox]/upload 10MB 가드·POST /import-sheet·OAuth bounce
   share=1). 명단 조율(로스터/그룹/슬롯)은 578 로 탭③(일정)이 흡수했으므로
   여기엔 표/벌크/그룹 없음 — 순수 유입 창구만.

   배치(writer 결정): 탭① 폼 셀렉터/뷰 토글 툴바 **아래**, 가로 스크롤 영역
   **밖**(568 폭 봉쇄 — 테이블 폭과 무관하게 항상 프레임 안). 기본 접힘. 단
   ⓐ 시트 연동 시 접혀도 연동됨 요약 1줄(시트명·동기화·재동기화) 노출,
   ⓑ 명단 0명이면 첫 유입 유도로 기본 펼침.

   유입 성공 시: 토스트 + 로컬 refetch(밴드 자신의 연동됨 요약/카운트 갱신).
   탭③(일정)은 조건부 마운트라 다음 진입 시 fresh fetch 로 최신 명단을 노출
   — 탭 이동 강제 없음(spec §1).
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { useToast } from '@/components/toast-provider';

type IntakeProject = {
  id: string;
  source_sheet_url: string | null;
  source_sheet_title: string | null;
  source_sheet_synced_at: string | null;
};

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function JourneyIntakeBand({ formId }: { formId: string | null }) {
  const t = useTranslations('RecruitingScheduling');
  const tj = useTranslations('Recruiting.journey');
  const toast = useToast();
  const notifyOk = (msg: string) => toast.push(msg, { tone: 'info' });
  const notifyErr = (msg: string) => toast.push(msg, { tone: 'warn' });

  // --- Journey anchor (form → project + inbox batch + roster count) -------
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<IntakeProject | null>(null);
  const [inboxBatchId, setInboxBatchId] = useState<string | null>(null);
  const [bridgedCount, setBridgedCount] = useState(0);
  const [rosterCount, setRosterCount] = useState(0);

  const load = useCallback(async () => {
    if (!formId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/scheduling/journey/candidates?form_id=${encodeURIComponent(formId)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) return;
      const json = (await res.json()) as {
        project: IntakeProject | null;
        candidates: { source: string | null }[];
        inbox_batch_id: string | null;
      };
      const rows = json.candidates ?? [];
      setProject(json.project ?? null);
      setInboxBatchId(json.inbox_batch_id ?? null);
      setRosterCount(rows.length);
      setBridgedCount(rows.filter((c) => c.source === 'bridge').length);
    } catch {
      // Band degrades to the collapsed toggle; intake retries on next action.
    } finally {
      setLoading(false);
    }
  }, [formId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- form-anchored fetch-on-mount (load() sets loading/data); re-fetch also runs from handlers
    void load();
  }, [load]);

  // --- Collapse (접힘 기본, 명단 0명이면 자동 펼침) -----------------------
  const [sourceOpen, setSourceOpen] = useState(false);
  // Re-seed the auto-expand once per form after its first successful load.
  const [seedForm, setSeedForm] = useState<string | null>(null);
  const [seededForm, setSeededForm] = useState<string | null>(null);
  if (formId !== seedForm) {
    // form switched → allow a fresh auto-seed for the new form's roster.
    setSeedForm(formId);
    setSeededForm(null);
  }
  if (!loading && formId && seededForm !== formId) {
    // First settled load for this form: default-expand only when 명단 0명.
    setSeededForm(formId);
    setSourceOpen(rosterCount === 0);
  }

  // --- Intake state (ported) --------------------------------------------
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const [showSheetInput, setShowSheetInput] = useState(false);

  async function uploadFile(file: File) {
    if (!inboxBatchId || uploading) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/scheduling/batches/${inboxBatchId}/upload`, {
        method: 'POST',
        body,
      });
      const json = (await res.json().catch(() => ({}))) as {
        upserted?: number;
        error?: string;
        code?: string | null;
        detail?: string | null;
      };
      if (!res.ok) {
        if (json.error === 'no_candidates') {
          notifyErr(t('noCandidates'));
          return;
        }
        const reason = json.code
          ? `${json.error ?? 'error'} (${json.code}${json.detail ? `: ${json.detail}` : ''})`
          : (json.error ?? String(res.status));
        notifyErr(t('uploadFailedReason', { error: reason }));
        return;
      }
      notifyOk(t('uploaded', { count: json.upserted ?? 0 }));
      await load();
    } finally {
      setUploading(false);
    }
  }

  async function importSheet(url: string) {
    const target = url.trim();
    if (!target || !inboxBatchId || importing) return;
    setImporting(true);
    try {
      const res = await fetch(
        `/api/scheduling/batches/${inboxBatchId}/import-sheet`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sheetUrl: target }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        upserted?: number;
        error?: string;
      };
      if (
        res.status === 412 ||
        json.error === 'google_not_connected' ||
        json.error === 'reconsent_required'
      ) {
        notifyOk(t('sheetsConnectPrompt'));
        window.location.href = '/api/recruiting/google/start?share=1';
        return;
      }
      if (!res.ok) {
        notifyErr(sheetErrorMessage(json.error));
        return;
      }
      notifyOk(t('uploaded', { count: json.upserted ?? 0 }));
      setSheetUrl('');
      setShowSheetInput(false);
      await load();
    } finally {
      setImporting(false);
    }
  }

  function sheetErrorMessage(code: string | undefined): string {
    switch (code) {
      case 'invalid_sheet_url':
        return t('sheetsInvalidUrl');
      case 'no_candidates':
        return t('noCandidates');
      case 'sheet_read_failed':
        return t('sheetsReadFailed');
      default:
        return t('sheetsImportFailed');
    }
  }

  function resyncSheet() {
    if (project?.source_sheet_url) void importSheet(project.source_sheet_url);
  }
  function reconnectSheet() {
    window.location.href = '/api/recruiting/google/start?share=1';
  }

  // formId 없으면 밴드 자체를 숨긴다(응답 탭의 no-form 안내가 상위에서 담당).
  if (!formId) return null;

  const sheetLinked = !!project?.source_sheet_url;

  return (
    <div className="shrink-0 border-b-2 border-line-soft bg-paper px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* eslint-disable-next-line react/forbid-elements -- 인라인 접기 토글(mono 라벨 + 셰브론) — Button primitive 의 border/radius chrome 과 불일치(§7.11). 저니 셸 접기 조각과 동일 선례. */}
        <button
          type="button"
          onClick={() => setSourceOpen((v) => !v)}
          aria-expanded={sourceOpen}
          className="flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-wider text-mute-soft transition-colors hover:text-ink"
        >
          <span aria-hidden className="text-xs leading-none">
            {sourceOpen ? '▼' : '▶'}
          </span>
          {tj('intakeBandTitle')}
        </button>

        {/* 접힌 상태에서도 시트가 연동돼 있으면 요약 1줄 + 재동기화 노출(spec ⓐ). */}
        {!sourceOpen && sheetLinked && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
            <span className="shrink-0" aria-hidden>
              📗
            </span>
            <span
              className="min-w-0 max-w-[220px] truncate font-bold text-ink"
              title={project?.source_sheet_title ?? undefined}
            >
              {project?.source_sheet_title || tj('sheetLinkedFallback')}
            </span>
            {project?.source_sheet_synced_at && (
              <span className="shrink-0 font-mono text-mute-soft">
                {tj('sheetSyncedAt', {
                  time: new Date(
                    project.source_sheet_synced_at,
                  ).toLocaleString(),
                })}
              </span>
            )}
            <Button
              variant="link"
              size="xs"
              onClick={resyncSheet}
              disabled={importing}
            >
              {importing ? t('sheetsImporting') : tj('sheetResync')}
            </Button>
          </div>
        )}
      </div>

      {sourceOpen && (
        <div className="mt-3 grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {/* 1. 응답에서 연동 — read-only 카운트(브리지는 이 응답 탭 판단표에서 선택). */}
          <div className="flex flex-col gap-2 rounded-sm border-2 border-ink bg-success-bg p-4 shadow-memphis-sm">
            <div className="flex items-center gap-2">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xs border-2 border-ink bg-paper text-base"
                aria-hidden
              >
                🧲
              </span>
              <span
                className="text-md font-extrabold text-ink"
                style={{ fontFamily: 'var(--font-outfit), var(--font-sans)' }}
              >
                {tj('bridgeCardTitle')}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-mute">
              {tj('bridgeCardHelper')}
            </p>
            <span className="inline-flex items-center gap-1.5 self-start rounded-pill border border-success bg-paper px-2.5 py-0.5 text-xs font-bold text-success-text">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full bg-success"
              />
              {tj('bridgeLinkedCount', { count: bridgedCount })}
            </span>
          </div>

          {/* 2. CSV·Excel 업로드 — plaintext dropzone(10MB 가드). */}
          <FileDropZone
            accept=".csv,.xlsx"
            maxSizeBytes={MAX_UPLOAD_BYTES}
            disabled={uploading || !inboxBatchId}
            onFiles={(files) => {
              if (files[0]) void uploadFile(files[0]);
            }}
            onError={() => notifyErr(t('fileTooLarge'))}
            label={uploading ? t('uploading') : t('uploadLabel')}
            helperText={t('uploadHelper')}
            className="px-6 py-8"
          />

          {/* 3. Google Sheets — R9 연동됨 카드(linked) vs url input(empty). */}
          <div className="flex flex-col gap-3 rounded-sm border-2 border-ink bg-paper px-5 py-4 shadow-memphis-sm">
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xs border-2 border-ink bg-mint text-base"
                aria-hidden
              >
                📗
              </span>
              <p
                className="text-md font-extrabold text-ink"
                style={{ fontFamily: 'var(--font-outfit), var(--font-sans)' }}
              >
                {t('sheetsTitle')}
              </p>
            </div>

            {sheetLinked && !showSheetInput ? (
              <>
                <div className="flex flex-col gap-0.5 rounded-xs border border-success-line bg-success-bg px-3 py-2">
                  <span
                    className="truncate text-sm font-bold text-ink"
                    title={project?.source_sheet_title ?? undefined}
                  >
                    {project?.source_sheet_title || tj('sheetLinkedFallback')}
                  </span>
                  {project?.source_sheet_synced_at && (
                    <span className="font-mono text-xs text-mute-soft">
                      {tj('sheetSyncedAt', {
                        time: new Date(
                          project.source_sheet_synced_at,
                        ).toLocaleString(),
                      })}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={resyncSheet}
                    disabled={importing}
                  >
                    {importing ? t('sheetsImporting') : tj('sheetResync')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={reconnectSheet}>
                    {tj('sheetReconnect')}
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => setShowSheetInput(true)}
                  >
                    {tj('sheetChange')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                {!sheetLinked && (
                  <p className="text-sm leading-relaxed text-mute">
                    {t('sheetsHelper')}
                  </p>
                )}
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      aria-label={t('sheetsUrlLabel')}
                      placeholder={t('sheetsUrlPlaceholder')}
                      value={sheetUrl}
                      onChange={(e) => setSheetUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void importSheet(sheetUrl);
                      }}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => void importSheet(sheetUrl)}
                    disabled={importing || !sheetUrl.trim() || !inboxBatchId}
                  >
                    {importing ? t('sheetsImporting') : t('sheetsImport')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
