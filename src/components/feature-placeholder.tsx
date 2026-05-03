'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { track } from './mixpanel-provider';
import { useRequireAuth } from './auth-provider';
import type { FeatureKey } from '@/lib/features';

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
    <div className="mx-auto max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t(`${feature}.title`)}</h1>
          <p className="mt-1 text-sm text-neutral-500">{t(`${feature}.description`)}</p>
        </div>
        <span className="rounded-md bg-neutral-100 px-2 py-1 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
          {t(`${feature}.cost`)}
        </span>
      </div>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={10}
        placeholder="..."
        className="mt-6 w-full rounded-lg border border-neutral-200 bg-white p-3 text-sm focus:border-neutral-400 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900"
      />

      <div className="mt-3 flex justify-end">
        <button
          onClick={onClickRun}
          disabled={running || !input.trim()}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
        >
          {running ? tCommon('loading') : tCommon('generate')}
        </button>
      </div>

      {result && (
        <pre className="mt-6 whitespace-pre-wrap rounded-lg border border-neutral-200 bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
          {result}
        </pre>
      )}
    </div>
  );
}
