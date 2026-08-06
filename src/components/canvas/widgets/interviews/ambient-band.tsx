'use client';

import { useTranslations } from 'next-intl';
import { useCountUp } from '@/hooks/use-count-up';

// ─── Ambient progress 밴드 (BUILD-SPEC §1.1, S1 1c) ─────────────────────────
// 팝업(전체보기) 밖에서도 탑라인 생성 진행률이 카드에 상시 보이게 하는 shrink-0
// 밴드. bg = rose 헤더 톤(var(--widget-tone) — 🎨 리컬러도 따라감) · border-t 2px
// ink · 진행바 h8 radius-full fill ink. DECISIONS #2: **ETA("약 N분") 미표시 —
// 진행률만.** map(문서 순회) → reduce(블록 스트리밍) 2단계.
export function AmbientProgressBand({
  mapTotal,
  mapDone,
  blockCount,
}: {
  mapTotal: number | null;
  mapDone: number | null;
  blockCount: number;
}) {
  const t = useTranslations('InterviewsV2');
  const total = mapTotal ?? 0;
  const rawDone = total > 0 ? Math.max(0, Math.min(mapDone ?? 0, total)) : 0;
  const displayDone = useCountUp(rawDone);
  // map 이 끝나면 reduce(보고서 작성) — streamObject 가 블록을 증분 스트리밍.
  const inReduce = total > 0 && rawDone >= total;
  const pct = total > 0 ? Math.round((rawDone / total) * 100) : 0;

  return (
    <div
      className="flex shrink-0 flex-col gap-2.5"
      style={{
        padding: '13px 22px',
        borderTop: '2px solid var(--color-ink)',
        background: 'var(--widget-tone)',
      }}
    >
      <div className="flex items-center gap-2.5">
        {/* map 단계 = 정적 도트, reduce 단계 = 펄스(진행률 미지 → 라이브 신호).
            prefers-reduced-motion 에서 펄스 무력화(§제약3). */}
        <span
          className={`inline-block rounded-full bg-amore-deep ${
            inReduce ? 'animate-pulse motion-reduce:animate-none' : ''
          }`}
          style={{ width: 8, height: 8 }}
        />
        <span className="font-extrabold text-ink" style={{ fontSize: 12.5 }}>
          {t('ambientTitle')} ·{' '}
          {inReduce ? t('ambientReducePhase') : t('ambientMapPhase')}
        </span>
        <span
          className="ml-auto font-mono-label font-extrabold text-ink"
          style={{ fontSize: 11 }}
        >
          {inReduce
            ? t('ambientReduceCount', { count: blockCount })
            : total > 0
              ? t('ambientMapCount', { done: displayDone, total })
              : t('ambientPreparing')}
        </span>
      </div>
      <div
        className="overflow-hidden rounded-full"
        style={{ height: 8, background: 'var(--color-line-strong)' }}
      >
        <div
          className="h-full rounded-full bg-ink transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${inReduce ? 100 : pct}%` }}
        />
      </div>
      <div className="text-mute" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
        {t('ambientNote')}
      </div>
    </div>
  );
}
