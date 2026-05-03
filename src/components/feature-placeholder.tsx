'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { track } from './mixpanel-provider';
import { useRequireAuth } from './auth-provider';
import { ChapterHeader } from './editorial';
import type { FeatureKey } from '@/lib/features';

const CHAPTER_NUM: Record<FeatureKey, number> = {
  quotes: 1,
  transcripts: 2,
  interviews: 3,
  reports: 4,
};

export function FeaturePlaceholder({ feature }: { feature: FeatureKey }) {
  const t = useTranslations('Features');
  const tCommon = useTranslations('Common');
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const requireAuth = useRequireAuth();

  function onClickRun() {
    requireAuth(() => void doRun());
  }

  async function doRun() {
    setRunning(true);
    setResult(null);
    track('generate_clicked', { feature });
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feature, input }),
      });
      const json = await res.json();
      if (!res.ok) {
        setResult(`Error: ${json.error ?? res.statusText}`);
      } else {
        setResult(json.output);
        track('generate_success', { feature });
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-6">
      <ChapterHeader
        num={CHAPTER_NUM[feature]}
        eyebrow={feature.toUpperCase()}
        title={t(`${feature}.title`)}
        description={t(`${feature}.description`)}
      />

      <div className="mt-2 flex items-center gap-2 text-[10.5px] uppercase tracking-[0.22em] text-mute-soft">
        <span>Cost</span>
        <span className="h-px w-3 bg-line" />
        <span className="text-amore">{t(`${feature}.cost`)}</span>
      </div>

      <div className="mt-6">
        <div className="eyebrow-mute mb-2">Input</div>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={12}
          placeholder="원시 인터뷰 텍스트를 붙여넣으세요…"
          className="w-full border border-line bg-paper p-4 text-[13px] leading-[1.7] text-ink-2 placeholder:text-mute-soft focus:border-amore focus:outline-none [border-radius:4px]"
        />
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        <span className="text-[10.5px] uppercase tracking-[0.18em] text-mute-soft">
          {input.length.toLocaleString()} chars
        </span>
        <button
          onClick={onClickRun}
          disabled={running || !input.trim()}
          className="border border-ink bg-ink px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
        >
          {running ? tCommon('loading') : tCommon('generate')}
        </button>
      </div>

      {result && (
        <div className="mt-10">
          <div className="flex items-center gap-2.5">
            <span className="accent-line" />
            <span className="eyebrow">Output</span>
          </div>
          <pre className="mt-3 whitespace-pre-wrap border border-line bg-paper p-5 text-[13px] leading-[1.75] text-ink-2 [border-radius:4px]">
            {result}
          </pre>
        </div>
      )}
    </div>
  );
}
