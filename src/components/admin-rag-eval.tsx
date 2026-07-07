'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import type { EvalMetrics, RagEvalRun } from '@/lib/interview-eval/types';

export type EvalProject = { id: string; name: string };

type Props = { projects: EvalProject[] };

type RunResponse = {
  run: RagEvalRun;
  previous: RagEvalRun | null;
  notes: string[];
};

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

// delta = 현재 비율 - 이전 비율. 개선(+)은 amore, 악화(-)는 warning.
function Delta({ cur, prev }: { cur: number | null; prev: number | null }) {
  if (cur === null || prev === null) return null;
  const d = cur - prev;
  if (Math.abs(d) < 0.0005) {
    return <span className="text-md text-mute">±0.0%</span>;
  }
  const up = d > 0;
  return (
    <span className={up ? 'text-md text-amore' : 'text-md text-warning'}>
      {up ? '▲' : '▼'} {pct(Math.abs(d))}
    </span>
  );
}

function MetricCard({
  title,
  hint,
  value,
  detail,
  cur,
  prev,
}: {
  title: string;
  hint: string;
  value: string;
  detail: string;
  cur: number | null;
  prev: number | null;
}) {
  return (
    <div className="border border-line rounded-sm bg-paper p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-md font-medium text-ink">{title}</span>
        <Delta cur={cur} prev={prev} />
      </div>
      <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
      <div className="mt-1 text-md text-mute">{detail}</div>
      <div className="mt-2 text-md text-mute-soft">{hint}</div>
    </div>
  );
}

export function AdminRagEval({ projects }: Props) {
  const t = useTranslations('AdminRagEval');
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [sampleSize, setSampleSize] = useState('50');
  const [k, setK] = useState('10');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RunResponse | null>(null);

  async function run() {
    if (!projectId) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/rag-eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          sample_size: Number(sampleSize) || undefined,
          k: Number(k) || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData((await res.json()) as RunResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'run_failed');
    } finally {
      setRunning(false);
    }
  }

  const cur: EvalMetrics | null = data?.run.metrics ?? null;
  const prev: EvalMetrics | null = data?.previous?.metrics ?? null;

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-ink">{t('title')}</h1>
      <p className="mt-2 text-md text-mute">{t('subtitle')}</p>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <Select
            label={t('project')}
            size="sm"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder={t('projectPlaceholder')}
            options={projects.map((p) => ({
              value: p.id,
              label: p.name || p.id,
            }))}
          />
        </div>
        <div className="w-28">
          <Input
            label={t('sampleSize')}
            size="sm"
            type="number"
            min={1}
            max={100}
            value={sampleSize}
            onChange={(e) => setSampleSize(e.target.value)}
          />
        </div>
        <div className="w-20">
          <Input
            label="K"
            size="sm"
            type="number"
            min={1}
            max={50}
            value={k}
            onChange={(e) => setK(e.target.value)}
          />
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={run}
          disabled={running || !projectId}
        >
          {running ? t('running') : t('run')}
        </Button>
      </div>

      {error ? (
        <p className="mt-4 text-md text-warning">
          {t('error')}: {error}
        </p>
      ) : null}

      {running ? (
        <p className="mt-6 text-md text-mute">{t('runningHint')}</p>
      ) : null}

      {data ? (
        <div className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-md text-mute">
              {t('runMeta', {
                model: data.run.model,
                sha: data.run.git_sha.slice(0, 7),
                sample: data.run.sample_size,
                k: data.run.k,
              })}
            </span>
            {data.previous ? (
              <span className="text-md text-mute-soft">{t('vsPrevious')}</span>
            ) : (
              <span className="text-md text-mute-soft">{t('noPrevious')}</span>
            )}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MetricCard
              title={t('recall')}
              hint={t('recallHint')}
              value={cur?.recall ? pct(cur.recall.recall_at_k) : '—'}
              detail={
                cur?.recall
                  ? t('recallDetail', {
                      hits: cur.recall.hits,
                      sampled: cur.recall.sampled,
                      mrr: cur.recall.mrr.toFixed(2),
                    })
                  : t('unavailable')
              }
              cur={cur?.recall?.recall_at_k ?? null}
              prev={prev?.recall?.recall_at_k ?? null}
            />
            <MetricCard
              title={t('coverage')}
              hint={t('coverageHint')}
              value={cur?.coverage ? pct(cur.coverage.coverage) : '—'}
              detail={
                cur?.coverage
                  ? t('coverageDetail', {
                      cited: cur.coverage.cited_docs,
                      total: cur.coverage.total_docs,
                    })
                  : t('unavailable')
              }
              cur={cur?.coverage?.coverage ?? null}
              prev={prev?.coverage?.coverage ?? null}
            />
            <MetricCard
              title={t('faithfulness')}
              hint={t('faithfulnessHint')}
              value={cur?.faithfulness ? pct(cur.faithfulness.faithfulness) : '—'}
              detail={
                cur?.faithfulness
                  ? t('faithfulnessDetail', {
                      supported: cur.faithfulness.supported,
                      claims: cur.faithfulness.claims,
                    })
                  : t('unavailable')
              }
              cur={cur?.faithfulness?.faithfulness ?? null}
              prev={prev?.faithfulness?.faithfulness ?? null}
            />
            <MetricCard
              title={t('citation')}
              hint={t('citationHint')}
              value={cur?.citation ? pct(cur.citation.validity) : '—'}
              detail={
                cur?.citation
                  ? t('citationDetail', {
                      valid: cur.citation.valid,
                      total: cur.citation.citations,
                    })
                  : t('unavailable')
              }
              cur={cur?.citation?.validity ?? null}
              prev={prev?.citation?.validity ?? null}
            />
          </div>

          {data.notes.length > 0 ? (
            <ul className="mt-4 space-y-1">
              {data.notes.map((n, i) => (
                <li key={i} className="text-md text-mute-soft">
                  · {n}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
