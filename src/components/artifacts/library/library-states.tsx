'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { FEATURE_ICON, FEATURE_ORDER, FEATURE_OPEN_HREF, FEATURE_TONE_BG } from './constants';
import { Pressable } from './pressable';

const OUTFIT = { fontFamily: 'var(--font-outfit), var(--font-sans)' } as const;

// Six skeleton rows, opacity laddering 1 → 0.32, keeping the row rhythm
// (34px tile · two text lines · badge · date · action) so nothing jumps on
// load (A5a / GEOMETRY: row height must match).
const SKELETON = [
  { op: 1, w1: '52%', w2: '30%' },
  { op: 0.92, w1: '44%', w2: '26%' },
  { op: 0.82, w1: '61%', w2: '34%' },
  { op: 0.68, w1: '38%', w2: '22%' },
  { op: 0.5, w1: '55%', w2: '31%' },
  { op: 0.32, w1: '47%', w2: '25%' },
];

export function LibrarySkeleton() {
  return (
    <div className="flex flex-col gap-2.5 p-4" aria-hidden>
      {SKELETON.map((s, i) => (
        <div key={i} className="flex items-center gap-[11px]" style={{ opacity: s.op }}>
          <div className="h-[34px] w-[34px] shrink-0 rounded-icon bg-surface-disabled" />
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="h-[11px] rounded-xs bg-surface-disabled" style={{ width: s.w1 }} />
            <div className="h-[9px] rounded-xs bg-paper-soft" style={{ width: s.w2 }} />
          </div>
          <div className="h-5 w-[74px] shrink-0 rounded-pill bg-surface-disabled" />
          <div className="h-[9px] w-[60px] shrink-0 rounded-xs bg-paper-soft" />
          <div className="h-[26px] w-16 shrink-0 rounded-pill bg-surface-disabled" />
        </div>
      ))}
    </div>
  );
}

export function LibraryEmpty() {
  const t = useTranslations('Library');
  const router = useRouter();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3.5 p-8 text-center">
      <div className="flex h-[66px] w-[66px] items-center justify-center rounded-modal border-[3px] border-ink bg-paper-soft text-display shadow-memphis-md">
        📥
      </div>
      <div className="text-3xl font-extrabold text-ink" style={OUTFIT}>
        {t('empty.title')}
      </div>
      <p className="max-w-[400px] text-md leading-relaxed text-mute">{t('empty.body')}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {FEATURE_ORDER.map((f) => (
          <Pressable
            key={f}
            onPress={() => router.push(FEATURE_OPEN_HREF[f])}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-pill border-2 border-ink px-3.5 py-[7px] text-md font-bold text-ink shadow-memphis-sm ${FEATURE_TONE_BG[f]}`}
          >
            {FEATURE_ICON[f]} {t(`empty.cta.${f}`)}
          </Pressable>
        ))}
      </div>
    </div>
  );
}

export function LibraryFilteredEmpty({
  total,
  chips,
  onClear,
}: {
  total: number;
  chips: { key: string; label: string; onRemove: () => void }[];
  onClear: () => void;
}) {
  const t = useTranslations('Library');
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-[58px] w-[58px] items-center justify-center rounded-panel-lg border-[2.5px] border-dashed border-line-empty bg-surface-canvas text-2xl">
        🔍
      </div>
      <div className="text-2xl font-extrabold text-ink" style={OUTFIT}>
        {t('filteredEmpty.title')}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap justify-center gap-[7px]">
          {chips.map((c) => (
            <Pressable
              key={c.key}
              onPress={c.onRemove}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-pill border-[1.4px] border-amore bg-amore-bg/40 px-2.5 py-[3px] text-sm font-bold text-amore-deep"
              ariaLabel={c.label}
            >
              {c.label} ✕
            </Pressable>
          ))}
        </div>
      )}
      <p className="max-w-[380px] text-md leading-relaxed text-mute">
        {t('filteredEmpty.body', { total })}
      </p>
      <Pressable
        onPress={onClear}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-pill border-2 border-ink bg-paper px-4 py-2 text-md font-extrabold text-ink shadow-memphis-sm"
      >
        ↺ {t('filteredEmpty.clear')}
      </Pressable>
    </div>
  );
}

export function LibraryError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('Library');
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3.5 p-8 text-center">
      <div className="flex h-[62px] w-[62px] items-center justify-center rounded-modal border-[3px] border-ink bg-error-bg text-display shadow-memphis-md-error">
        ⚠️
      </div>
      <div className="text-3xl font-extrabold text-ink" style={OUTFIT}>
        {t('error.title')}
      </div>
      <p className="max-w-[400px] text-md leading-relaxed text-mute">{t('error.body')}</p>
      <div className="flex gap-2.5">
        <Pressable
          onPress={onRetry}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-pill border-2 border-ink bg-ink px-[18px] py-2 text-md font-extrabold text-paper shadow-memphis-md"
        >
          ↻ {t('error.retry')}
        </Pressable>
        <span className="inline-flex items-center gap-1.5 rounded-pill border-[1.5px] border-ink/20 bg-paper px-4 py-2 text-md font-semibold text-mute">
          {t('error.support')}
        </span>
      </div>
    </div>
  );
}
