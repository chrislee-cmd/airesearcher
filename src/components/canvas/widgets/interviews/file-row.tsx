'use client';

import { useTranslations } from 'next-intl';
import DuotoneIcon from '@/components/ui/icons/duotone-icon';
import type { InterviewDocument } from '@/hooks/use-interview-v2-documents';
import { fileIconName } from './file-icon';

const INK = 'var(--color-ink)';

// ─── 상태 mono 칩 (READY / 인덱싱 / QUEUE / FAIL) ────────────────────────────
function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: 'ready' | 'indexing' | 'queue' | 'fail';
}) {
  const cls = {
    ready: 'bg-success-bg border-success-line text-success-text',
    indexing: 'bg-paper border-lav-line text-lav-text',
    queue: 'bg-paper-soft border-line-strong text-mute-soft',
    fail: 'bg-paper border-error-line text-error-text',
  }[tone];
  return (
    <span
      className={`shrink-0 rounded-chip border font-mono-label font-extrabold ${cls}`}
      style={{ fontSize: 10, padding: '2px 8px', borderWidth: '1.4px' }}
    >
      {label}
    </span>
  );
}

// ─── 인덱싱 4단 타임라인 (BUILD-SPEC §1.1 · GEOMETRY §A1) ─────────────────────
// index_status 는 coarse(indexing) 이라, 관측 가능한 embedding(processed/total)
// 을 현재 단계로 두고 앞 3단(업로드/파싱/청킹)은 done 으로 표기 — 기존 카드
// 해석 유지(회귀 0). 노드 20px · 연결선 2px · done=success ✓ / 현재=processing.
function IndexingTimeline() {
  const tProcess = useTranslations('Process');
  const steps = [
    { key: 'uploading', state: 'done' as const },
    { key: 'parsing', state: 'done' as const },
    { key: 'chunking', state: 'done' as const },
    { key: 'embedding', state: 'current' as const },
  ];
  return (
    <div className="flex items-center">
      {steps.map((s, i) => (
        <div key={s.key} className="flex flex-1 items-center">
          <div className="flex flex-1 flex-col items-center gap-1.5">
            <span
              className={`inline-flex items-center justify-center rounded-full font-extrabold ${
                s.state === 'done'
                  ? 'bg-success text-paper'
                  : 'bg-processing text-paper'
              }`}
              style={{ width: 20, height: 20, fontSize: 10 }}
            >
              {s.state === 'done' ? '✓' : i + 1}
            </span>
            <span
              className={`font-bold ${
                s.state === 'done' ? 'text-success-text' : 'text-lav-text'
              }`}
              style={{ fontSize: 10 }}
            >
              {tProcess(`interviews.${s.key}` as never)}
            </span>
          </div>
          {i < steps.length - 1 && (
            <span
              className={steps[i + 1].state === 'done' ? 'bg-success' : 'bg-processing'}
              style={{ height: 2, flex: '0 0 20px' }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── 파일 행 (4상태) — BUILD-SPEC §1.1 ───────────────────────────────────────
export function FileRow({ doc }: { doc: InterviewDocument }) {
  const t = useTranslations('InterviewsV2');
  const icon = fileIconName(doc.mime, doc.filename);
  const hasProg = doc.total_chunks != null && doc.total_chunks > 0;

  if (doc.index_status === 'indexing') {
    return (
      <div
        className="flex flex-col gap-2 rounded-card bg-lav-bg"
        style={{ padding: '11px 13px', border: '1.5px solid var(--color-lav-line)' }}
      >
        <div className="flex items-center gap-2.5">
          <DuotoneIcon name={icon} size={17} />
          <div className="min-w-0 flex-1">
            <div
              className="truncate font-bold text-ink"
              style={{ fontSize: 12.5 }}
              title={doc.filename}
            >
              {doc.filename}
            </div>
            <div
              className="font-mono-label text-lav-text"
              style={{ fontSize: 10, marginTop: 2 }}
            >
              {hasProg
                ? t('fileMetaIndexing', {
                    done: doc.processed_chunks,
                    total: doc.total_chunks ?? 0,
                  })
                : t('fileMetaIndexingStart')}
            </div>
          </div>
          <StatusChip label={t('fileChipIndexing')} tone="indexing" />
        </div>
        <IndexingTimeline />
      </div>
    );
  }

  if (doc.index_status === 'error') {
    return (
      <div
        className="flex items-center gap-2.5 rounded-card bg-error-bg"
        style={{ padding: '11px 13px', border: '1.5px solid var(--color-error-line)' }}
      >
        <DuotoneIcon name={icon} size={17} />
        <div className="min-w-0 flex-1">
          <div
            className="truncate font-bold text-ink"
            style={{ fontSize: 12.5 }}
            title={doc.filename}
          >
            {doc.filename}
          </div>
          <div className="text-error-text" style={{ fontSize: 10.5, marginTop: 2 }}>
            {t('fileMetaFail')}
          </div>
        </div>
        <StatusChip label={t('fileChipFail')} tone="fail" />
      </div>
    );
  }

  if (doc.index_status === 'pending') {
    return (
      <div
        className="flex items-center gap-2.5 rounded-card bg-paper opacity-75"
        style={{ padding: '11px 13px', border: `1.5px solid var(--color-line)` }}
      >
        <DuotoneIcon name={icon} size={17} />
        <div className="min-w-0 flex-1">
          <div
            className="truncate font-bold text-mute"
            style={{ fontSize: 12.5 }}
            title={doc.filename}
          >
            {doc.filename}
          </div>
          <div className="font-mono-label text-faint" style={{ fontSize: 10, marginTop: 2 }}>
            {t('fileMetaQueue')}
          </div>
        </div>
        <StatusChip label={t('fileChipQueue')} tone="queue" />
      </div>
    );
  }

  // done → READY
  return (
    <div
      className="flex items-center gap-2.5 rounded-card bg-paper shadow-memphis-sm-faint"
      style={{ padding: '11px 13px', border: `2px solid ${INK}` }}
    >
      <DuotoneIcon name={icon} size={17} />
      <div className="min-w-0 flex-1">
        <div
          className="truncate font-bold text-ink"
          style={{ fontSize: 12.5 }}
          title={doc.filename}
        >
          {doc.filename}
        </div>
        <div className="font-mono-label text-faint" style={{ fontSize: 10, marginTop: 2 }}>
          {hasProg
            ? t('fileMetaReady', { count: doc.total_chunks ?? 0 })
            : t('fileMetaReadyPlain')}
        </div>
      </div>
      <StatusChip label={t('fileChipReady')} tone="ready" />
    </div>
  );
}

// ─── 컴팩트 파일 요약 카드 (analyze-prompt 1d · 2열 그리드) ───────────────────
export function FileSummaryCard({ doc }: { doc: InterviewDocument }) {
  const t = useTranslations('InterviewsV2');
  const icon = fileIconName(doc.mime, doc.filename);
  const hasProg = doc.total_chunks != null && doc.total_chunks > 0;
  return (
    <div
      className="flex items-center gap-2.5 rounded-card bg-paper"
      style={{ padding: '10px 12px', border: '1.5px solid var(--color-line)' }}
    >
      <DuotoneIcon name={icon} size={15} />
      <div className="min-w-0">
        <div
          className="truncate font-bold text-ink"
          style={{ fontSize: 12 }}
          title={doc.filename}
        >
          {doc.filename}
        </div>
        <div className="font-mono-label text-faint" style={{ fontSize: 9.5 }}>
          {hasProg
            ? t('fileMetaChunks', { count: doc.total_chunks ?? 0 })
            : t('fileMetaReadyPlain')}
        </div>
      </div>
    </div>
  );
}
