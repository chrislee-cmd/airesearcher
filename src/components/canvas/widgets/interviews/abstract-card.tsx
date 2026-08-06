'use client';

import { useTranslations } from 'next-intl';
import DuotoneIcon from '@/components/ui/icons/duotone-icon';
import type { ToplineAbstract } from '@/lib/interview-v2/topline-abstract';
import type { InterviewDocument } from '@/hooks/use-interview-v2-documents';
import { MonoChip } from './card-parts';
import { FileRow } from './file-row';

// "2026-08-05 14:22" — 로컬 타임 yyyy-MM-dd HH:mm (client 컴포넌트).
function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ─── abstract 카드 (BUILD-SPEC §1.1, S1 1e) — 완료 요약 hero ─────────────────
// 헤더 스트립(rose-bg) + 제목/요약/키포인트(✦) + 푸터 메타 칩 + 전체보기 링크.
export function AbstractCard({
  abstract,
  generatedAt,
  model,
  outputLang,
  blockCount,
  docCount,
  onOpenFullview,
}: {
  abstract: ToplineAbstract;
  generatedAt: string | null;
  model: string | null;
  outputLang: string | null;
  blockCount: number;
  docCount: number;
  onOpenFullview: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const lang = (outputLang ?? 'ko').toUpperCase();
  const stamp = generatedAt ? formatStamp(generatedAt) : '';
  const metaRight = [stamp, model].filter(Boolean).join(' · ');

  return (
    <div
      className="overflow-hidden rounded-sm bg-paper shadow-memphis-md-faint"
      style={{ border: '2px solid var(--color-ink)' }}
    >
      {/* 헤더 스트립 */}
      <div
        className="flex items-center gap-2 bg-rose-bg"
        style={{ padding: '10px 16px', borderBottom: '1.5px solid var(--color-line)' }}
      >
        <span
          className="font-mono-label font-extrabold uppercase text-amore-deep"
          style={{ fontSize: 10, letterSpacing: '0.14em' }}
        >
          {t('toplineExecSummaryLabel')}
        </span>
        {metaRight && (
          <span
            className="ml-auto truncate font-mono-label text-mute-soft"
            style={{ fontSize: 10 }}
          >
            {metaRight}
          </span>
        )}
      </div>

      {/* 본문 */}
      <div className="flex flex-col gap-3" style={{ padding: 16 }}>
        <div
          className="font-extrabold text-ink"
          style={{ fontSize: 15.5, lineHeight: 1.4 }}
        >
          {abstract.title}
        </div>
        <p
          className="whitespace-pre-wrap text-mute"
          style={{ fontSize: 12.5, lineHeight: 1.75 }}
        >
          {abstract.summary}
        </p>
        {abstract.keyPoints.length > 0 && (
          <div className="flex flex-col gap-1.5" style={{ paddingTop: 2 }}>
            {abstract.keyPoints.slice(0, 4).map((point, i) => (
              <div key={i} className="flex items-start gap-2">
                <span
                  aria-hidden
                  className="text-amore-deep"
                  style={{ fontSize: 12, lineHeight: 1.6 }}
                >
                  ✦
                </span>
                <span className="text-ink" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                  {point}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 푸터 메타 */}
      <div
        className="flex items-center gap-2.5 bg-paper-soft"
        style={{ padding: '11px 16px', borderTop: '1.5px solid var(--color-line)' }}
      >
        <MonoChip>{t('metaFiles', { count: docCount })}</MonoChip>
        <MonoChip>{t('metaBlocks', { count: blockCount })}</MonoChip>
        <MonoChip>
          <DuotoneIcon name="language" size={13} />
          {lang}
        </MonoChip>
        <span
          role="button"
          tabIndex={0}
          onClick={onOpenFullview}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpenFullview();
            }
          }}
          className="ml-auto cursor-pointer font-extrabold text-amore-deep"
          style={{ fontSize: 12.5 }}
        >
          {t('cardAbstractViewAll')} →
        </span>
      </div>
    </div>
  );
}

// ─── 파일 접기 토글 (abstract 모드 — 파일 목록 접근 보존) ─────────────────────
// native <details>/<summary> 는 forbid-elements(button/input/textarea) 밖이라 허용.
export function FilesCollapse({
  documents,
}: {
  documents: InterviewDocument[];
}) {
  const t = useTranslations('InterviewsV2');
  const allDone = documents.every((d) => d.index_status === 'done');
  return (
    <details className="group">
      <summary
        className="flex cursor-pointer list-none items-center gap-2.5 rounded-card bg-paper [&::-webkit-details-marker]:hidden"
        style={{ padding: '11px 14px', border: '1.5px solid var(--color-line)' }}
      >
        <span
          aria-hidden
          className="text-mute transition-transform duration-[var(--dur-fast)] group-open:rotate-90 motion-reduce:transition-none"
          style={{ fontSize: 9 }}
        >
          ▸
        </span>
        <span className="font-bold text-ink" style={{ fontSize: 12.5 }}>
          {t('cardFilesUsed', { count: documents.length })}
        </span>
        <span
          className="ml-auto font-mono-label text-faint"
          style={{ fontSize: 10.5 }}
        >
          {allDone ? t('cardFilesAllIndexed') : t('cardFilesCount', { count: documents.length })}
        </span>
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {documents.map((d) => (
          <FileRow key={d.id} doc={d} />
        ))}
      </div>
    </details>
  );
}
