'use client';

import { useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import DuotoneIcon from '@/components/ui/icons/duotone-icon';
import type { InterviewDocument } from '@/hooks/use-interview-v2-documents';
import {
  CardScroll,
  CardFooter,
  CardFooterCta,
  CardEyebrow,
} from './card-parts';
import { FileRow, FileSummaryCard } from './file-row';
import { AmbientProgressBand } from './ambient-band';
import { AbstractDoneHero, FilesCollapse } from './abstract-card';

// ════════════════════════════════════════════════════════════════════════
// S1 5모드 본문 (fresh, BUILD-SPEC §1.1). 각 body = 스크롤 영역 + (밴드) + 푸터.
// 컨트롤바(1b–1e)는 컨테이너(interviews-card)가 상단에 렌더. 모두 dumb — 데이터/
// 콜백만 받는다.
// ════════════════════════════════════════════════════════════════════════

// ─── 1a idle · 프로젝트 미선택 ───────────────────────────────────────────────
export function IdleModeBody({
  projectSelect,
  dropzone,
}: {
  // ProjectSelectControl(variant=field) — 셀렉트 + "＋ 새 프로젝트" 링크.
  projectSelect: ReactNode;
  // InterviewDropzone(disabled) — "먼저 프로젝트를 선택하세요".
  dropzone: ReactNode;
}) {
  const t = useTranslations('InterviewsV2');
  return (
    <>
      <CardScroll gap={18}>
        <div className="flex flex-col gap-2.5">
          <CardEyebrow>{t('idleProjectSection')}</CardEyebrow>
          {projectSelect}
        </div>
        <div className="flex flex-col gap-2.5">
          <CardEyebrow>{t('idleFilesSection')}</CardEyebrow>
          {dropzone}
        </div>
        <div
          className="flex items-start gap-2.5 rounded-panel bg-paper"
          style={{ padding: '13px 15px', border: '1.5px solid var(--color-line)' }}
        >
          <span aria-hidden style={{ fontSize: 15 }}>
            ✦
          </span>
          <div className="text-mute" style={{ fontSize: 12, lineHeight: 1.65 }}>
            {t('idleInfo')}
          </div>
        </div>
      </CardScroll>
      <CardFooter
        note={t('idleFooterNote')}
        cta={<CardFooterCta label={t('cardAnalyze')} trailing="→" disabled />}
      />
    </>
  );
}

// ─── 업로드 4단 안내 프리뷰 (1b) — 전부 비활성 노드 ──────────────────────────
function StepPreview() {
  const t = useTranslations('InterviewsV2');
  const tProcess = useTranslations('Process');
  const steps = ['uploading', 'parsing', 'chunking', 'embedding'] as const;
  return (
    <div className="flex flex-col gap-2" style={{ marginTop: 'auto', paddingTop: 22 }}>
      <CardEyebrow>{t('emptyStepsTitle')}</CardEyebrow>
      <div className="flex items-center">
        {steps.map((s, i) => (
          <div key={s} className="flex flex-1 items-center">
            <div className="flex flex-1 flex-col items-center gap-1.5">
              <span
                className="inline-flex items-center justify-center rounded-full font-extrabold text-faint"
                style={{ width: 22, height: 22, fontSize: 10.5, background: 'var(--color-line-soft)' }}
              >
                {i + 1}
              </span>
              <span className="font-bold text-faint" style={{ fontSize: 11 }}>
                {tProcess(`interviews.${s}` as never)}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span style={{ height: 2, flex: '0 0 26px', background: 'var(--color-line)' }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 1b empty · 프로젝트 선택됨 · 파일 0 ─────────────────────────────────────
export function EmptyModeBody({
  dropzone,
  uploadProgress,
}: {
  dropzone: ReactNode;
  // 업로드 진행 중이면 상단에 기존 진행 아티팩트를 유지(§제약4 · 발명 금지).
  uploadProgress?: ReactNode;
}) {
  const t = useTranslations('InterviewsV2');
  return (
    <>
      <CardScroll gap={0} className="justify-between">
        {uploadProgress}
        {dropzone}
        <StepPreview />
      </CardScroll>
      <CardFooter
        note={t('cardFilesCount', { count: 0 })}
        cta={<CardFooterCta label={t('cardAnalyze')} trailing="→" disabled />}
      />
    </>
  );
}

// ─── 1c generating · 인덱싱 + 탑라인 생성 (파일 목록 뷰) ──────────────────────
// generating(탑라인 생성 중) · 파일 인덱싱 중 · 보고서-있으나-요약불가 세 케이스를
// 공용으로 렌더한다. ambient 밴드는 showBand(=탑라인 generating)일 때만.
export function GeneratingModeBody({
  documents,
  mapTotal,
  mapDone,
  blockCount,
  showBand,
  footerNote,
  footerLabel,
  footerTrailing,
  onFooterCta,
  footerDisabled = false,
  uploadProgress,
}: {
  documents: InterviewDocument[];
  mapTotal: number | null;
  mapDone: number | null;
  blockCount: number;
  showBand: boolean;
  footerNote: ReactNode;
  footerLabel: ReactNode;
  footerTrailing?: ReactNode;
  onFooterCta?: () => void;
  footerDisabled?: boolean;
  uploadProgress?: ReactNode;
}) {
  const t = useTranslations('InterviewsV2');
  const doneCount = documents.filter((d) => d.index_status === 'done').length;
  const activeCount = documents.filter(
    (d) => d.index_status === 'indexing' || d.index_status === 'pending',
  ).length;
  return (
    <>
      <CardScroll>
        {uploadProgress}
        <div className="flex items-center gap-2">
          <CardEyebrow>{t('filesUploadedHeader', { count: documents.length })}</CardEyebrow>
          {activeCount > 0 && (
            <span
              className="ml-auto inline-flex items-center gap-1.5 rounded-chip border border-lav-line bg-lav-bg font-mono-label font-extrabold text-lav-text"
              style={{ fontSize: 10.5, padding: '2px 8px' }}
            >
              <span className="inline-block rounded-full bg-processing" style={{ width: 5, height: 5 }} />
              {t('indexingCountChip', { done: doneCount, total: documents.length })}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {documents.map((d) => (
            <FileRow key={d.id} doc={d} />
          ))}
        </div>
      </CardScroll>
      {showBand && (
        <AmbientProgressBand mapTotal={mapTotal} mapDone={mapDone} blockCount={blockCount} />
      )}
      <CardFooter
        note={footerNote}
        cta={
          <CardFooterCta
            label={footerLabel}
            trailing={footerTrailing}
            onClick={onFooterCta}
            disabled={footerDisabled}
          />
        }
      />
    </>
  );
}

// ─── 1d analyze-prompt · 파일 준비됨 · 보고서 없음 ───────────────────────────
export function AnalyzePromptModeBody({
  documents,
  creditCost,
  canAnalyze,
  onAnalyze,
}: {
  documents: InterviewDocument[];
  creditCost: number;
  canAnalyze: boolean;
  onAnalyze: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const shown = documents.slice(0, 4);
  const more = documents.length - shown.length;
  return (
    <>
      <CardScroll>
        {/* rose-bg 프롬프트 박스 */}
        <div
          className="flex flex-col gap-2.5 rounded-sm bg-rose-bg shadow-memphis-md-faint"
          style={{ padding: 20, border: '2px solid var(--color-ink)' }}
        >
          <CardEyebrow tone="crimson">{t('analyzeNoReport')}</CardEyebrow>
          <div className="font-extrabold text-ink" style={{ fontSize: 16, lineHeight: 1.4 }}>
            {t('analyzeReadyTitle', { count: documents.length })}
          </div>
          <p className="text-mute" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
            {t('analyzeReadyBody', { count: documents.length })}
          </p>
          <div className="flex items-center gap-2.5" style={{ marginTop: 2 }}>
            <span
              className="inline-flex items-center gap-1.5 rounded-pill bg-paper font-bold text-ink shadow-memphis-sm-faint"
              style={{ padding: '8px 14px', fontSize: 12.5, border: '1.5px solid var(--color-ink)' }}
            >
              <DuotoneIcon name="language" size={15} />
              {t('analyzeLangDefault')}
              <span aria-hidden style={{ fontSize: 8 }}>
                ▼
              </span>
            </span>
            <span className="text-mute-soft" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
              {t('analyzeLangHint')}
            </span>
          </div>
        </div>

        {/* 파일 요약 그리드 */}
        <div className="flex items-center gap-2">
          <CardEyebrow>{t('filesUploadedHeader', { count: documents.length })}</CardEyebrow>
          <span
            className="rounded-chip border border-success-line bg-success-bg font-mono-label font-extrabold text-success-text"
            style={{ fontSize: 10, padding: '2px 8px' }}
          >
            {t('filesAllReady')}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {shown.map((d) => (
            <FileSummaryCard key={d.id} doc={d} />
          ))}
        </div>
        {more > 0 && (
          <div className="text-mute-soft" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
            {t('filesMore', { count: more })}
          </div>
        )}
      </CardScroll>
      <CardFooter
        note={t('creditDeductNote', { cost: creditCost })}
        cta={
          <CardFooterCta
            label={t('cardAnalyze')}
            trailing="→"
            onClick={onAnalyze}
            disabled={!canAnalyze}
          />
        }
      />
    </>
  );
}

// ─── 1e done · 완료 상태 (전사록 `TG_done` 패턴) ──────────────────────────────
// abstract 요약 카드 대체(#684): 중앙 정렬 done hero(✓ 타일 + CTA) + 접힌 파일
// 목록 밴드 + 푸터. 로직(abstract 파생 → 이 모드 진입 · 풀뷰 열기)은 그대로.
export function AbstractModeBody({
  documents,
  blockCount,
  onOpenFullview,
}: {
  documents: InterviewDocument[];
  blockCount: number;
  onOpenFullview: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const filesRef = useRef<HTMLDetailsElement>(null);
  // 되돌아가기 → 파일 목록 펼침 + 스크롤(회귀 0: 모드/상태 전환 없이 카드 내부에서
  // 파일 접근만 노출).
  const handleBackToFiles = () => {
    const el = filesRef.current;
    if (!el) return;
    el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  return (
    <>
      <AbstractDoneHero
        docCount={documents.length}
        blockCount={blockCount}
        onOpenFullview={onOpenFullview}
        onBackToFiles={handleBackToFiles}
      />
      <div className="shrink-0" style={{ padding: '0 22px 18px' }}>
        <FilesCollapse documents={documents} detailsRef={filesRef} />
      </div>
      <CardFooter
        note={t('reportReadyNote')}
        cta={
          <CardFooterCta
            label={t('openReport')}
            trailing="⤢"
            onClick={onOpenFullview}
          />
        }
      />
    </>
  );
}
