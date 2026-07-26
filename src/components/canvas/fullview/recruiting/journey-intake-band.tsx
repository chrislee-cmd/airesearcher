'use client';

/* ────────────────────────────────────────────────────────────────────
   JourneyIntakeBand — 명단 소스(LIST SOURCES) 컴팩트 유틸리티 스트립.

   위치(#587, CD LEFT-PANEL-SPEC): ①응답 탭 좌패널(400px 컬럼) **최상단 카드**
   — 순서 LIST SOURCES → 참여자 조건 → 분포. (579 가 뒀던 툴바 아래 full-width
   접이식 밴드에서 이관. 접힘/펼침·자동펼침·응답연동(bridge) 행은 CD 컴팩트
   설계에 따라 제거 — bridge 는 판단테이블 CTA 로 존재하므로 소스 목록에서만
   제외, 기능 삭제 아님.)

   형태(CD §①): 카드가 아니라 유틸리티 스트립(높이 ≈110px). 헤드 = LIST SOURCES
   라벨 + 우측 `N명 등록됨` 상태. 바디 2행 = 업로드(1.5px dashed ink · 찾아보기)
   · Google Sheets(1.5px solid line · Import ink-fill · 서브라인 = 연동 시트명
   mono truncate, 미연동 시 URL 입력). 카드 셸은 좌패널 3카드 공통 규격
   (border-2 ink · rounded-[var(--fv-radius-panel)](12) · paper ·
   shadow-memphis-sm-faint) — 형제 recruiting-criteria-panel 과 동일.

   이식(재구현 금지): 업로드/시트 인제스트·재동기화·에러 노출 계약을 그대로
   옮겼다 (POST /batches/[inbox]/upload 10MB 가드 · POST /import-sheet ·
   412/reconsent 시 OAuth bounce share=1). 명단 조율(로스터/그룹/슬롯)은 578 로
   탭③(일정)이 흡수 — 여기엔 표/벌크 없음, 순수 유입 창구만.

   앵커: 폼(formId) 우선, 없으면 pill 프로젝트(projectId, form-free intake 583).
   폼 미발행이어도 스트립은 정상 동작 — "폼 발행하세요" 류 차단/배너 없음.
   유입 성공 시 토스트 + 로컬 refetch(연동 시트명/카운트 갱신).
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/toast-provider';

type IntakeProject = {
  id: string;
  source_sheet_url: string | null;
  source_sheet_title: string | null;
  source_sheet_synced_at: string | null;
};

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function JourneyIntakeBand({
  formId,
  projectId = null,
  onChanged,
}: {
  formId: string | null;
  // Pill (interview_projects) id — the form-free intake anchor (card 583). When
  // no form is published the strip still works on the pill project so CSV/Sheets
  // intake works; when both are present the server converges them on one project.
  projectId?: string | null;
  // Called after a successful upload/import (card 588) so the host can refetch
  // the ①응답 "업로드 명단" segment — new intake rows appear immediately.
  onChanged?: () => void;
}) {
  const t = useTranslations('RecruitingScheduling');
  const tj = useTranslations('Recruiting.journey');
  const toast = useToast();
  const notifyOk = (msg: string) => toast.push(msg, { tone: 'info' });
  const notifyErr = (msg: string) => toast.push(msg, { tone: 'warn' });

  // --- Journey anchor (form → project + inbox batch + roster count) -------
  const [project, setProject] = useState<IntakeProject | null>(null);
  const [inboxBatchId, setInboxBatchId] = useState<string | null>(null);
  const [rosterCount, setRosterCount] = useState(0);

  const load = useCallback(async () => {
    if (!formId && !projectId) return;
    try {
      // Pass whichever anchors we have — both when known so the server converges
      // the form + pill axes on one project (card 583).
      const params = new URLSearchParams();
      if (formId) params.set('form_id', formId);
      if (projectId) params.set('project_id', projectId);
      const res = await fetch(
        `/api/scheduling/journey/candidates?${params.toString()}`,
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
    } catch {
      // Strip degrades to disabled controls; intake retries on next action.
    }
  }, [formId, projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- anchor-scoped fetch-on-mount (load() sets project/inbox/count); re-fetch also runs from upload/import handlers
    void load();
  }, [load]);

  // --- Intake state (ported) --------------------------------------------
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      onChanged?.();
    } finally {
      setUploading(false);
    }
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so re-selecting the same file re-fires onChange.
    e.target.value = '';
    if (!file) return;
    // 10MB guard (ported from FileDropZone maxSizeBytes).
    if (file.size > MAX_UPLOAD_BYTES) {
      notifyErr(t('fileTooLarge'));
      return;
    }
    void uploadFile(file);
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
      await load();
      onChanged?.();
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

  // Import button: linked → re-import the same URL (resync); else import the
  // pasted URL. Single CD "Import" affordance either way (§① compact strip).
  function onSheetImport() {
    if (sheetLinked && project?.source_sheet_url) {
      void importSheet(project.source_sheet_url);
    } else {
      void importSheet(sheetUrl);
    }
  }

  // 앵커(폼·pill) 둘 다 없으면 스트립 자체를 숨긴다(상위 no-form 안내가 담당).
  // pill 만 있어도(폼 미발행) 스트립은 뜬다 — form-free intake(583)의 핵심.
  if (!formId && !projectId) return null;

  const sheetLinked = !!project?.source_sheet_url;
  const importDisabled =
    importing || (!sheetLinked && (!sheetUrl.trim() || !inboxBatchId));

  return (
    <section className="shrink-0 rounded-[var(--fv-radius-panel)] border-2 border-ink bg-paper shadow-memphis-sm-faint">
      {/* Head — LIST SOURCES 라벨 + 우측 등록 카운트(0명이어도 노출). */}
      <header className="flex items-center gap-2 border-b-[1.5px] border-ink/12 px-[13px] py-2">
        <span className="font-mono-label text-xs font-bold uppercase tracking-[0.12em] text-mute-soft">
          {tj('listSources')}
        </span>
        <span className="ml-auto text-xs-soft text-mute-soft">
          {tj('registeredCount', { count: rosterCount })}
        </span>
      </header>

      {/* Body — 2 sources only (upload · Google Sheets). */}
      <div className="flex flex-col gap-[7px] px-[11px] py-[9px]">
        {/* Upload row — 1.5px dashed ink · 찾아보기 → hidden file input. */}
        <div className="flex items-center gap-2 rounded-[var(--fv-radius-strip-row)] border-[1.5px] border-dashed border-ink px-2.5 py-[7px]">
          <span aria-hidden className="shrink-0 text-md">
            📄
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-md font-bold text-ink">
              {t('uploadLabel')}
            </div>
            <div className="truncate text-xs text-mute-soft">
              {uploading ? t('uploading') : tj('uploadSub')}
            </div>
          </div>
          {/* eslint-disable-next-line react/forbid-elements -- 숨김 file picker; native <input type=file> 는 Input primitive(텍스트 전용)로 대체 불가. 찾아보기 버튼이 트리거. */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            onChange={onFilePicked}
          />
          {/* eslint-disable-next-line react/forbid-elements -- CD §① 찾아보기 버튼: border-1.4px ink · radius 7 · 10.5px 전용 chrome 으로 Button primitive 의 radius/size 와 불일치(§7.11). 좌패널 CD 조각 선례. */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !inboxBatchId}
            className="shrink-0 rounded-[var(--fv-radius-strip-btn)] border-[1.4px] border-ink bg-paper px-[9px] py-[3px] text-xs-soft font-bold text-ink transition-colors hover:bg-paper-soft disabled:cursor-not-allowed disabled:opacity-40"
          >
            {tj('browse')}
          </button>
        </div>

        {/* Sheets row — 1.5px solid line · 서브라인=연동 시트명(mono truncate)
            또는 URL 입력 · Import(ink fill). */}
        <div className="flex items-center gap-2 rounded-[var(--fv-radius-strip-row)] border-[1.5px] border-line px-2.5 py-[7px]">
          <span aria-hidden className="shrink-0 text-md">
            📗
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-md font-bold text-ink">
              {t('sheetsTitle')}
            </div>
            {sheetLinked ? (
              <div
                className="truncate font-mono text-xs text-faint"
                title={project?.source_sheet_title ?? undefined}
              >
                {project?.source_sheet_title || tj('sheetLinkedFallback')}
              </div>
            ) : (
              // eslint-disable-next-line react/forbid-elements -- CD §① 서브라인 인라인 URL 입력(borderless mono 서브텍스트). Input primitive 의 border/height chrome 은 스트립 서브라인 높이(≈110px 계약)를 깨뜨림.
              <input
                type="url"
                inputMode="url"
                aria-label={t('sheetsUrlLabel')}
                placeholder={t('sheetsUrlPlaceholder')}
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void importSheet(sheetUrl);
                }}
                className="w-full truncate bg-transparent font-mono text-xs text-ink placeholder:text-faint focus:outline-none"
              />
            )}
          </div>
          {/* eslint-disable-next-line react/forbid-elements -- CD §① Import 버튼: bg-ink·white·radius 7·10.5px ink-fill 전용 chrome 으로 Button primitive 의 radius/variant 와 불일치(§7.11). 좌패널 CD 조각 선례. */}
          <button
            type="button"
            onClick={onSheetImport}
            disabled={importDisabled}
            className="shrink-0 rounded-[var(--fv-radius-strip-btn)] bg-ink px-2.5 py-[3px] text-xs-soft font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {importing ? t('sheetsImporting') : t('sheetsImport')}
          </button>
        </div>
      </div>
    </section>
  );
}
