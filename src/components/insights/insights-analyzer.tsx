'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { QuoteSearchPanel } from '@/components/insights/quote-search-panel';
import { ClusterView } from '@/components/insights/cluster-view';
import {
  loadClustersForJob,
  type ClusterWithQuotes,
} from '@/lib/insights-clusters-load';
import { createClient } from '@/lib/supabase/client';
import { useCreditDeduction } from '@/components/credit-deduction-provider';
import { FEATURE_COSTS } from '@/lib/features';

// Union of the two legacy tabs' accept lists. Browsers vary on whether
// they classify a .docx by MIME or extension — we list both forms so the
// picker accepts the file regardless of how Safari/Chrome tags it.
const ACCEPT = [
  'audio/*',
  'video/*',
  'text/plain',
  'text/markdown',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.json',
  '.log',
  '.docx',
  '.pdf',
  '.xlsx',
  '.xls',
].join(',');

const MAX_FILES = 25;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
// Concurrent /files calls. 3 keeps total time bounded on big batches
// while staying well under Anthropic/OpenAI per-minute rate limits for a
// single user.
const CONCURRENCY = 3;

type FilePhase = 'queued' | 'uploading' | 'done' | 'failed';
type FileRow = {
  id: string;
  file: File;
  phase: FilePhase;
  quoteCount?: number;
  error?: string;
};

type JobStatus = 'pending' | 'converting' | 'extracting' | 'analyzing' | 'ready' | 'failed';

type JobSnapshot = {
  id: string;
  status: JobStatus;
  quote_count: number;
  participant_count: number;
  file_count: number;
  failure_reason: string | null;
};

// Server-fetched list of past ready jobs the org has access to. Shape
// is intentionally close to JobSnapshot — we hydrate the ready state
// directly from this row on click without a second round trip.
export type PastJob = {
  id: string;
  title: string | null;
  status: 'ready';
  file_count: number;
  participant_count: number;
  quote_count: number;
  failure_reason: string | null;
  created_at: string;
};

const ACTIVE_JOB_KEY = 'insights_analyzer:active_job_id';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

export function InsightsAnalyzer({
  pastJobs = [],
  initialJob,
  initialClusters,
}: {
  pastJobs?: PastJob[];
  // When present, hydrate ready state from this server-fetched row and
  // skip the idle/upload flow. Used by /insights-analyzer/[jobId]/page.
  initialJob?: PastJob;
  // Server-fetched clusters from the /[jobId] route. When absent (root
  // URL or fresh-upload completion) the component fetches client-side
  // once phase becomes 'ready'.
  initialClusters?: ClusterWithQuotes[];
}) {
  const router = useRouter();
  const { notify: notifyDeduction } = useCreditDeduction();
  const [files, setFiles] = useState<FileRow[]>([]);
  const [jobId, setJobId] = useState<string | null>(initialJob?.id ?? null);
  const [job, setJob] = useState<JobSnapshot | null>(
    initialJob
      ? {
          id: initialJob.id,
          status: 'ready',
          quote_count: initialJob.quote_count,
          participant_count: initialJob.participant_count,
          file_count: initialJob.file_count,
          failure_reason: initialJob.failure_reason,
        }
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // Mirrors job.status during the active run so we can keep the UI in
  // "running" mode even before the first Realtime tick arrives.
  const [phase, setPhase] = useState<JobStatus | 'idle'>(
    initialJob ? 'ready' : 'idle',
  );
  // Server-supplied clusters take precedence; null = "haven't fetched
  // yet for this jobId" (triggers the client-side load below).
  const [clusters, setClusters] = useState<ClusterWithQuotes[] | null>(
    initialClusters ?? null,
  );

  const supabase = useMemo(() => createClient(), []);

  // Client-side cluster fetch for the root URL flow (no initialClusters):
  //   1) localStorage resume of a ready job
  //   2) fresh upload completion where onStart() flipped phase=ready
  // The [jobId] route hydrates initialClusters server-side, so this
  // effect bails out there. Errors fall through as empty array — the
  // ClusterView graceful-empty message is correct UX either way.
  useEffect(() => {
    if (initialClusters !== undefined) return;
    if (phase !== 'ready' || !jobId) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await loadClustersForJob(supabase, jobId);
        if (!cancelled) setClusters(rows);
      } catch {
        if (!cancelled) setClusters([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialClusters, phase, jobId, supabase]);

  // Resume a previously-started job on refresh. Skipped when the page
  // already passed an initialJob via URL — that takes precedence over
  // whatever the last tab put in localStorage.
  useEffect(() => {
    if (initialJob) return;
    const stored =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(ACTIVE_JOB_KEY)
        : null;
    if (!stored) return;
    void (async () => {
      const { data } = await supabase
        .from('insights_jobs')
        .select('id, status, quote_count, participant_count, file_count, failure_reason')
        .eq('id', stored)
        .single();
      if (data) {
        setJobId(data.id);
        setJob(data as JobSnapshot);
        setPhase(data.status as JobStatus);
      } else {
        window.localStorage.removeItem(ACTIVE_JOB_KEY);
      }
    })();
  }, [supabase]);

  // Realtime: a single channel scoped to the active jobId watches the
  // insights_jobs row. We also poll insights_quotes count on each tick so
  // the progress pill ("12개 인용구 수집됨") moves between status flips.
  useEffect(() => {
    if (!jobId) return;
    const ch = supabase
      .channel(`insights-job-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'insights_jobs',
          filter: `id=eq.${jobId}`,
        },
        (payload) => {
          const next = payload.new as JobSnapshot;
          setJob(next);
          setPhase(next.status);
          if (next.status === 'ready' || next.status === 'failed') {
            try {
              window.localStorage.removeItem(ACTIVE_JOB_KEY);
            } catch {}
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supabase, jobId]);

  // Poll quote count while extracting — Realtime on insights_quotes would
  // fire one event per INSERTed row (potentially 100+/file) which is more
  // noise than useful. A 2s poll gives a smooth ticker without flooding.
  const [liveQuoteCount, setLiveQuoteCount] = useState<number | null>(null);
  useEffect(() => {
    if (!jobId || phase === 'ready' || phase === 'failed' || phase === 'idle') {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const { count } = await supabase
        .from('insights_quotes')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', jobId);
      if (!cancelled) setLiveQuoteCount(count ?? 0);
    };
    void tick();
    const interval = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [supabase, jobId, phase]);

  const isRunning = phase !== 'idle' && phase !== 'ready' && phase !== 'failed';

  const onFiles = useCallback((picked: File[]) => {
    setError(null);
    setFiles((cur) => {
      const next: FileRow[] = [...cur];
      for (const f of picked) {
        if (next.length >= MAX_FILES) break;
        if (next.some((r) => r.file.name === f.name && r.file.size === f.size)) {
          continue;
        }
        next.push({
          id: `${f.name}-${f.size}-${f.lastModified}`,
          file: f,
          phase: 'queued',
        });
      }
      return next;
    });
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((cur) => cur.filter((r) => r.id !== id));
  }, []);

  // Mutable shadow of the files state for the run loop — React state
  // updates are batched, so we need a ref to know whether a file is
  // already in flight while spinning up concurrent uploads.
  const filesRef = useRef<FileRow[]>([]);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  async function uploadOne(jid: string, row: FileRow): Promise<void> {
    setFiles((cur) =>
      cur.map((r) => (r.id === row.id ? { ...r, phase: 'uploading' } : r)),
    );
    const fd = new FormData();
    fd.append('jobId', jid);
    fd.append('file', row.file);
    try {
      const res = await fetch('/api/insights/files', {
        method: 'POST',
        body: fd,
      });
      const json: { quote_count?: number; error?: string; detail?: string } =
        await res.json();
      if (!res.ok) {
        setFiles((cur) =>
          cur.map((r) =>
            r.id === row.id
              ? {
                  ...r,
                  phase: 'failed',
                  error: json.error ?? `http_${res.status}`,
                }
              : r,
          ),
        );
        return;
      }
      setFiles((cur) =>
        cur.map((r) =>
          r.id === row.id
            ? { ...r, phase: 'done', quoteCount: json.quote_count ?? 0 }
            : r,
        ),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'network_error';
      setFiles((cur) =>
        cur.map((r) =>
          r.id === row.id ? { ...r, phase: 'failed', error: msg } : r,
        ),
      );
    }
  }

  async function runBatch(jid: string, batch: FileRow[]): Promise<void> {
    let i = 0;
    async function next(): Promise<void> {
      const idx = i++;
      if (idx >= batch.length) return;
      await uploadOne(jid, batch[idx]);
      return next();
    }
    const workers: Promise<void>[] = [];
    for (let w = 0; w < Math.min(CONCURRENCY, batch.length); w++) {
      workers.push(next());
    }
    await Promise.all(workers);
  }

  async function onStart() {
    if (files.length === 0 || starting || isRunning) return;
    setError(null);
    setStarting(true);
    try {
      const metadata = files.map((r) => ({
        filename: r.file.name,
        size: r.file.size,
        mime: r.file.type || undefined,
      }));
      const startRes = await fetch('/api/insights/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ files: metadata }),
      });
      const startJson: { jobId?: string; error?: string } = await startRes.json();
      if (!startRes.ok || !startJson.jobId) {
        setError(startJson.error ?? 'start_failed');
        setStarting(false);
        return;
      }
      const jid = startJson.jobId;
      try {
        window.localStorage.setItem(ACTIVE_JOB_KEY, jid);
      } catch {}
      setJobId(jid);
      setPhase('pending');
      // 차감 broadcast — 위젯 헤더 -N + topbar pulse.
      notifyDeduction('insights_analyzer', FEATURE_COSTS.insights_analyzer);

      await runBatch(jid, filesRef.current);

      // Finalize regardless of per-file outcomes — the route applies the
      // 50% threshold and either marks ready or refunds.
      const finalRes = await fetch(
        `/api/insights/finalize?jobId=${encodeURIComponent(jid)}`,
        { method: 'POST' },
      );
      const finalJson: { status?: JobStatus; error?: string } = await finalRes.json();
      if (!finalRes.ok) {
        setError(finalJson.error ?? 'finalize_failed');
      } else if (finalJson.status === 'ready') {
        // Hand off to the [jobId] page so the URL is shareable and the
        // server-rendered initialJob/initialClusters hydrate the ready
        // state without a second round trip. Mirrors loadPastJob().
        router.push(`/insights-analyzer/${jid}`);
      } else if (finalJson.status) {
        setPhase(finalJson.status);
      }
    } finally {
      setStarting(false);
    }
  }

  function onReset() {
    setFiles([]);
    setJobId(null);
    setJob(null);
    setPhase('idle');
    setError(null);
    setLiveQuoteCount(null);
    try {
      window.localStorage.removeItem(ACTIVE_JOB_KEY);
    } catch {}
    // If we landed via /insights-analyzer/[jobId], pop back to the list
    // route so the past-jobs section becomes visible again. On root we
    // already are at the list URL — router.refresh keeps the server-
    // rendered list fresh after a just-completed analysis.
    if (initialJob) {
      router.push('/insights-analyzer');
    } else {
      router.refresh();
    }
  }

  // Open an existing ready job from the past-jobs list. URL-addressable
  // route so the user can share / bookmark / use browser back. Local
  // state reset isn't needed — the [jobId] page hydrates initialJob
  // and the component re-mounts.
  function loadPastJob(past: PastJob) {
    try {
      window.localStorage.setItem(ACTIVE_JOB_KEY, past.id);
    } catch {}
    router.push(`/insights-analyzer/${past.id}`);
  }

  const succeededCount = files.filter((r) => r.phase === 'done').length;
  const failedCount = files.filter((r) => r.phase === 'failed').length;

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-8">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <h1 className="text-3xl font-bold tracking-[-0.02em] text-ink">
          인사이트 분석기
        </h1>
        <span className="shrink-0 text-sm tabular-nums text-mute-soft">
          30크레딧 / 배치
        </span>
      </div>

      {phase === 'idle' && (
        <div className="mt-8">
          <FileDropZone
            accept={ACCEPT}
            multiple
            maxSizeBytes={MAX_FILE_BYTES}
            onFiles={onFiles}
            onError={(msg) => setError(msg)}
            disabled={starting}
            label={
              <span>
                인터뷰 녹취·리포트·노트 파일을 드롭하거나 클릭해서 선택
              </span>
            }
            helperText={
              <span>
                최대 {MAX_FILES}개 · 파일당 25MB · audio/video, docx, pdf,
                txt/md/csv/json/log, xlsx
              </span>
            }
            className="px-6 py-12"
          />

          {files.length > 0 && (
            <div className="mt-6 border border-line bg-paper p-4 rounded-sm">
              <div className="mb-2 flex items-center justify-between text-sm text-mute-soft">
                <span>
                  업로드 대기 {files.length} / {MAX_FILES}
                </span>
                <Button
                  variant="link"
                  size="xs"
                  onClick={onReset}
                  disabled={starting}
                >
                  전체 비우기
                </Button>
              </div>
              <ul className="divide-y divide-line-soft">
                {files.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 py-2 text-md text-ink-2"
                  >
                    <span className="truncate">{r.file.name}</span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="text-mute-soft tabular-nums">
                        {formatBytes(r.file.size)}
                      </span>
                      <Button
                        variant="destructive-link"
                        size="xs"
                        onClick={() => removeFile(r.id)}
                        disabled={starting}
                      >
                        제거
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6 flex items-center justify-end gap-3">
            {error && (
              <span className="text-sm text-warning">{error}</span>
            )}
            <Button
              variant="primary"
              size="lg"
              onClick={onStart}
              disabled={files.length === 0 || starting}
              loading={starting}
              loadingLabel="시작 중…"
            >
              분석 시작
            </Button>
          </div>

          {pastJobs.length > 0 && (
            <div className="mt-10">
              <div className="mb-3 flex items-baseline justify-between">
                <div className="eyebrow-mute">이전 분석</div>
                <div className="text-sm text-mute-soft tabular-nums">
                  최근 {pastJobs.length}개
                </div>
              </div>
              <ul className="divide-y divide-line-soft border border-line bg-paper rounded-sm">
                {pastJobs.map((past) => (
                  <li
                    key={past.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => loadPastJob(past)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        loadPastJob(past);
                      }
                    }}
                    className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 transition-colors duration-[120ms] hover:bg-paper-soft focus:bg-paper-soft focus:outline-none"
                  >
                    <span className="min-w-0 flex-1 truncate text-left text-lg font-medium text-ink-2">
                      {past.title ?? formatDate(past.created_at)}
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-sm tabular-nums text-mute-soft">
                      <span>파일 {past.file_count}</span>
                      <span>·</span>
                      <span>참여자 {past.participant_count}</span>
                      <span>·</span>
                      <span>인용구 {past.quote_count}</span>
                      {past.title && (
                        <>
                          <span>·</span>
                          <span>{formatDate(past.created_at)}</span>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {isRunning && (
        <div className="mt-8 space-y-6">
          <div className="border border-line bg-paper p-5 rounded-sm">
            <div className="flex items-center justify-between gap-3 text-md text-ink-2">
              <span className="font-medium">
                {phase === 'pending' && '대기 중'}
                {phase === 'converting' && '파일을 마크다운으로 변환 중'}
                {phase === 'extracting' && '인용구 추출 중'}
                {phase === 'analyzing' && '분석 중'}
              </span>
              <span className="tabular-nums text-mute-soft">
                {succeededCount + failedCount} / {files.length || job?.file_count || 0} 파일 처리
              </span>
            </div>
            <div className="mt-3 text-sm text-mute-soft tabular-nums">
              지금까지 수집된 인용구:{' '}
              {(liveQuoteCount ?? job?.quote_count ?? 0).toLocaleString()}개
            </div>
          </div>

          {files.length > 0 && (
            <ul className="divide-y divide-line-soft border border-line bg-paper rounded-sm">
              {files.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 px-4 py-2 text-md text-ink-2"
                >
                  <span className="truncate">{r.file.name}</span>
                  <span className="shrink-0 text-sm text-mute-soft tabular-nums">
                    {r.phase === 'queued' && '대기'}
                    {r.phase === 'uploading' && '처리 중…'}
                    {r.phase === 'done' && `완료 · ${r.quoteCount ?? 0}개`}
                    {r.phase === 'failed' && `실패 · ${r.error ?? ''}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {phase === 'ready' && job && (
        <div className="mt-8 space-y-6">
          <div>
            <Button variant="link" size="sm" onClick={onReset}>
              ← 이전 분석 목록
            </Button>
          </div>
          <div className="border border-line bg-paper p-5 rounded-sm">
            <div className="text-md font-medium text-ink-2">
              분석 완료
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-4 text-md text-ink-2">
              <div>
                <dt className="text-sm text-mute-soft">파일</dt>
                <dd className="tabular-nums">{job.file_count}</dd>
              </div>
              <div>
                <dt className="text-sm text-mute-soft">참여자</dt>
                <dd className="tabular-nums">{job.participant_count}</dd>
              </div>
              <div>
                <dt className="text-sm text-mute-soft">인용구</dt>
                <dd className="tabular-nums">{job.quote_count}</dd>
              </div>
            </dl>
          </div>

          <QuoteSearchPanel jobId={job.id} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="border border-line bg-paper p-5 rounded-sm">
              <div className="eyebrow-mute mb-2">정량 분석</div>
              <h2 className="text-lg font-semibold text-ink-2">
                클러스터 인사이트
              </h2>
              <p className="mt-1.5 text-sm text-mute-soft">
                인용구를 의미 단위로 묶어 핵심 메시지를 추출합니다.
              </p>
              <div className="mt-4">
                {clusters === null ? (
                  <p className="text-sm text-mute-soft">불러오는 중…</p>
                ) : (
                  <ClusterView clusters={clusters} />
                )}
              </div>
            </section>
            <section className="border border-line bg-paper p-5 rounded-sm">
              <div className="eyebrow-mute mb-2">정성 분석</div>
              <h2 className="text-lg font-semibold text-ink-2">
                긴장·모순 지도
              </h2>
              <p className="mt-2 text-sm leading-[1.55] text-mute-soft">
                참여자 간 긴장, 발화 모순, 인용구 별자리 등 정성 시각화는 후속 PR (5b · 6b) 에서 추가됩니다.
              </p>
            </section>
          </div>

          <div className="flex justify-end">
            <Button variant="secondary" size="lg" onClick={onReset}>
              새 분석 시작
            </Button>
          </div>
        </div>
      )}

      {phase === 'failed' && job && (
        <div className="mt-8 space-y-6">
          <div className="border border-line bg-paper p-5 rounded-sm">
            <div className="text-md font-medium text-warning">
              분석 실패 — 크레딧이 환불되었습니다
            </div>
            <p className="mt-2 text-sm text-mute-soft">
              50% 미만의 파일만 분석에 성공해 결과 품질이 신뢰할 수 없습니다.
              사용된 30크레딧은 자동으로 환불되었습니다.
            </p>
            {job.failure_reason && (
              <pre className="mt-3 whitespace-pre-wrap text-sm text-mute tabular-nums">
                {job.failure_reason}
              </pre>
            )}
          </div>
          <div className="flex justify-end">
            <Button variant="secondary" size="lg" onClick={onReset}>
              다시 시도
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
