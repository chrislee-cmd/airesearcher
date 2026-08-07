'use client';

import type { RefObject } from 'react';
import { useTranslations } from 'next-intl';
import DuotoneIcon from '@/components/ui/icons/duotone-icon';
import type { InterviewDocument } from '@/hooks/use-interview-v2-documents';
import { FileRow } from './file-row';

// ─── 완료 상태 hero (BUILD-SPEC §1.1, S1 1e) — 전사록 생성기 `TG_done` 패턴 ────
// abstract 요약 카드(rose 헤더 스트립 + 요약/키포인트/메타 칩)를 대체(superseded).
// 공유 done 레이아웃 미러 (참조 구현 = quotes-card-body done hero): 중앙 정렬 ·
// success 착색 완료 타일(✓) + 제목 + 부연(규모) + ink pill CTA + 되돌아가기 링크.
// 별도 요약 박스·메타 칩 없음 — 규모는 부연 문장(과 셀 푸터 노트)에만.
export function AbstractDoneHero({
  docCount,
  blockCount,
  onOpenFullview,
  onBackToFiles,
}: {
  docCount: number;
  blockCount: number;
  onOpenFullview: () => void;
  onBackToFiles: () => void;
}) {
  const t = useTranslations('InterviewsV2');

  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto text-center"
      style={{ padding: 20 }}
    >
      {/* 완료 타일 — 64×64 · border2 ink · success 연초록 틴트 + success memphis
          그림자. radius 는 CD 16 근접 rounded-sm(14) (공유 done hero 선례 · 임의값
          회피). */}
      <div className="flex h-16 w-16 items-center justify-center rounded-sm border-2 border-ink bg-success-bg text-display font-extrabold text-success shadow-memphis-md-success">
        ✓
      </div>
      <div className="text-3xl font-extrabold text-ink">{t('cardDoneTitle')}</div>
      <p className="max-w-[300px] text-lg leading-relaxed text-mute">
        {t('cardDoneSubtitle', { docCount, blockCount })}
      </p>
      {/* 본문 CTA — ink pill (fullview 진입). native <button> 금지(forbid-elements)
          → role=button span (card-parts 관례). */}
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
        className="inline-flex cursor-pointer select-none items-center gap-2 rounded-pill bg-ink font-bold text-paper shadow-memphis-sm-faint"
        style={{ fontSize: 14, padding: '12px 22px', border: '1.4px solid var(--color-ink)' }}
      >
        <DuotoneIcon name="fullview" size={16} mono />
        {t('cardDoneOpenFullview')}
      </span>
      {/* 되돌아가기 — 밑줄 텍스트 링크(버튼 아님). 아래 파일 목록을 펼쳐 노출. */}
      <span
        role="button"
        tabIndex={0}
        onClick={onBackToFiles}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onBackToFiles();
          }
        }}
        className="cursor-pointer select-none font-semibold text-mute-soft"
        style={{ fontSize: 12.5, borderBottom: '1.5px solid var(--color-line-strong)', paddingBottom: 1 }}
      >
        {t('cardDoneBackToFiles')}
      </span>
    </div>
  );
}

// ─── 파일 접기 토글 (abstract 모드 — 파일 목록 접근 보존) ─────────────────────
// native <details>/<summary> 는 forbid-elements(button/input/textarea) 밖이라 허용.
export function FilesCollapse({
  documents,
  detailsRef,
}: {
  documents: InterviewDocument[];
  // 되돌아가기 링크가 이 <details> 를 열고 스크롤하기 위한 참조(선택).
  detailsRef?: RefObject<HTMLDetailsElement | null>;
}) {
  const t = useTranslations('InterviewsV2');
  const allDone = documents.every((d) => d.index_status === 'done');
  return (
    <details ref={detailsRef} className="group">
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
