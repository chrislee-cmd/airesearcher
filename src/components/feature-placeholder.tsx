'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { track } from './mixpanel-provider';
import { useRequireAuth } from './auth-provider';
import { useWorkspace } from './workspace-provider';
import type { FeatureKey } from '@/lib/features';
import { prefillKey } from '@/lib/workspace';

export function FeaturePlaceholder({ feature }: { feature: FeatureKey }) {
  const t = useTranslations('Features');
  const tCommon = useTranslations('Common');
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const requireAuth = useRequireAuth();
  const workspace = useWorkspace();

  useEffect(() => {
    try {
      const k = prefillKey(feature);
      const pre = sessionStorage.getItem(k);
      if (pre) {
        setInput(pre);
        sessionStorage.removeItem(k);
      }
    } catch {}
  }, [feature]);

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
        const title = `${t(`${feature}.title`)} · ${new Date().toLocaleString()}`;
        workspace.addArtifact({
          featureKey: feature,
          title,
          content:
            typeof json.output === 'string'
              ? json.output
              : JSON.stringify(json.output, null, 2),
        });
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-8">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink">
          {t(`${feature}.title`)}
        </h1>
        <span className="shrink-0 text-[11.5px] tabular-nums text-mute-soft">
          {t(`${feature}.cost`)}
        </span>
      </div>
      <p className="mt-3 max-w-[820px] text-[12.5px] leading-[1.75] text-mute">
        {t(`${feature}.description`)}
      </p>

      <div className="mt-8">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={12}
          placeholder="원시 인터뷰 텍스트를 붙여넣으세요…"
          className="w-full border border-line bg-paper p-4 text-[13px] leading-[1.7] text-ink-2 placeholder:text-mute-soft focus:border-amore focus:outline-none [border-radius:4px]"
        />
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        <span className="text-[11px] tabular-nums text-mute-soft">
          {input.length.toLocaleString()} chars
        </span>
        <button
          onClick={onClickRun}
          disabled={running || !input.trim()}
          className="border border-ink bg-ink px-5 py-2 text-[12px] font-semibold text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
        >
          {running ? tCommon('loading') : tCommon('generate')}
        </button>
      </div>

      {result && (
        <div className="mt-10">
          <h2 className="border-b border-line pb-3 text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
            결과
          </h2>
          <pre className="mt-4 whitespace-pre-wrap border border-line bg-paper p-5 text-[13px] leading-[1.75] text-ink-2 [border-radius:4px]">
            {result}
          </pre>
        </div>
      )}
    </div>
  );
}
