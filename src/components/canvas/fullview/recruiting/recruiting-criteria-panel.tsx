'use client';

/* ────────────────────────────────────────────────────────────────────
   RecruitingCriteriaPanel — 풀뷰 V2 Recruiting 좌측 상단 패널 (CD state 08).
   design-handoff/FULLVIEW-SHELL.md §F4 Recruiting · Widget Fullview Comps.dc.html.

   fresh 신규 빌드 — 레거시 recruiting/conditions-panel.tsx 는 supersede
   (편집·재사용 금지). 데이터(EditableBrief.criteria/summary)만 재사용한다.

   패널 카드: border-2 ink · rounded-[var(--fv-radius-panel)](12) · paper ·
   shadow-memphis-sm-faint. Required chip = border-amore + "필수" text-amore.
   비필수 chip = border-line. cat = mono-label uppercase mute-soft.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import type { EditableBrief } from '@/components/recruiting-wizard/draft-storage';

export function RecruitingCriteriaPanel({
  brief,
}: {
  brief: EditableBrief | null;
}) {
  const t = useTranslations('Recruiting.fv');
  const criteria = brief?.criteria ?? [];
  const summary = brief?.summary?.trim() ?? '';

  return (
    <section className="rounded-[var(--fv-radius-panel)] border-2 border-ink bg-paper shadow-memphis-sm-faint">
      <header className="flex items-center gap-2 border-b-[1.5px] border-ink/12 px-[14px] py-[11px]">
        <span aria-hidden className="text-md">
          🎯
        </span>
        <span className="text-md font-bold text-ink">{t('criteriaTitle')}</span>
        {criteria.length > 0 && (
          <span className="font-mono-label text-sm tabular-nums text-mute-soft">
            {t('criteriaCount', { count: criteria.length })}
          </span>
        )}
      </header>

      <div className="px-[14px] py-[13px]">
        {criteria.length === 0 ? (
          <p className="text-sm leading-[1.6] text-mute-soft">
            {t('criteriaEmpty')}
          </p>
        ) : (
          <>
            {summary && (
              <p className="mb-[11px] text-sm leading-[1.6] text-mute">
                {summary}
              </p>
            )}
            <ul className="flex flex-wrap gap-[7px]">
              {criteria.map((c, i) => (
                <li
                  key={i}
                  title={c.detail || undefined}
                  className={`inline-flex items-center gap-1.5 rounded-pill border-[1.4px] bg-paper px-2.5 py-[5px] text-sm ${
                    c.required ? 'border-amore' : 'border-line'
                  }`}
                >
                  <span className="font-mono-label text-xs uppercase tracking-[0.12em] text-mute-soft">
                    {c.category}
                  </span>
                  <span className="font-semibold text-ink">{c.label}</span>
                  {c.required && (
                    <span className="text-xs font-bold text-amore">
                      {t('required')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
