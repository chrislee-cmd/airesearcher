'use client';

import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { parsePartialJson } from 'ai';
import { track } from './mixpanel-provider';
import { useRequireAuth } from './auth-provider';
import { useGenerationJobs } from './generation-job-provider';
import type { RecruitingBrief } from '@/lib/recruiting-schema';

const ACCEPT = '.pdf,.docx,.xlsx,.xls,.csv,.txt';
const ACCEPT_RE = /\.(pdf|docx|xlsx|xls|csv|txt)$/i;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

type PartialBrief = Partial<RecruitingBrief> & {
  criteria?: Partial<RecruitingBrief['criteria'][number]>[];
  schedule?: Partial<RecruitingBrief['schedule'][number]>[];
};

function isCompleteCriterion(
  c: Partial<RecruitingBrief['criteria'][number]>,
): c is RecruitingBrief['criteria'][number] {
  return (
    typeof c.category === 'string' &&
    typeof c.label === 'string' &&
    typeof c.detail === 'string' &&
    typeof c.required === 'boolean'
  );
}

function isCompletePhase(
  p: Partial<RecruitingBrief['schedule'][number]>,
): p is RecruitingBrief['schedule'][number] {
  return (
    typeof p.phase === 'string' &&
    typeof p.note === 'string' &&
    (p.startDate === null || typeof p.startDate === 'string') &&
    (p.endDate === null || typeof p.endDate === 'string')
  );
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return '미정';
  if (start && end && start === end) return start;
  if (start && end) return `${start} ~ ${end}`;
  return start ?? end ?? '';
}

export function RecruitingBrief() {
  const t = useTranslations('Features');
  const tCommon = useTranslations('Common');
  const requireAuth = useRequireAuth();
  const jobs = useGenerationJobs();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const [partial, setPartial] = useState<PartialBrief | null>(null);

  const job = jobs.get('recruiting');
  const running = job.status === 'running';
  const result =
    job.status === 'done' ? (job.result as RecruitingBrief | null) : null;
  const errorMessage =
    job.status === 'error' ? job.error ?? 'unknown_error' : null;

  function addFiles(incoming: FileList | File[]) {
    const accepted: File[] = [];
    const rejectedNames: string[] = [];
    for (const f of Array.from(incoming)) {
      if (ACCEPT_RE.test(f.name)) accepted.push(f);
      else rejectedNames.push(f.name);
    }
    setFiles((prev) => {
      const seen = new Set(prev.map((p) => `${p.name}::${p.size}`));
      const next = [...prev];
      for (const f of accepted) {
        const key = `${f.name}::${f.size}`;
        if (!seen.has(key)) {
          next.push(f);
          seen.add(key);
        }
      }
      return next;
    });
    setRejected(rejectedNames);
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function onClickRun() {
    requireAuth(() => void doRun());
  }

  async function doRun() {
    if (files.length === 0 && !pasted.trim()) return;
    track('generate_clicked', {
      feature: 'recruiting',
      file_count: files.length,
      pasted_chars: pasted.length,
    });
    const submittedFiles = files;
    const submittedPaste = pasted;

    setPartial(null);

    await jobs.start<RecruitingBrief>('recruiting', {
      input: { count: submittedFiles.length },
      run: async () => {
        const fd = new FormData();
        for (const f of submittedFiles) fd.append('files', f);
        if (submittedPaste.trim()) fd.append('pasted', submittedPaste);

        const res = await fetch('/api/recruiting/extract', {
          method: 'POST',
          body: fd,
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `extract_failed: ${res.statusText}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = await parsePartialJson(buffer);
          if (parsed.value && typeof parsed.value === 'object') {
            setPartial(parsed.value as PartialBrief);
          }
        }

        const finalParsed = JSON.parse(buffer) as RecruitingBrief;
        setPartial(finalParsed);
        track('generate_success', { feature: 'recruiting' });
        return finalParsed;
      },
    });
  }

  const canRun = (files.length > 0 || pasted.trim().length > 0) && !running;
  const view: PartialBrief | null = result ?? partial;

  const criteria = (view?.criteria ?? []).filter(isCompleteCriterion);
  const schedule = (view?.schedule ?? []).filter(isCompletePhase);

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-8">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink">
          {t('recruiting.title')}
        </h1>
        <span className="shrink-0 text-[11.5px] tabular-nums text-mute-soft">
          {t('recruiting.cost')}
        </span>
      </div>
      <p className="mt-3 max-w-[820px] text-[12.5px] leading-[1.75] text-mute">
        {t('recruiting.description')}
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        className={`mt-8 flex cursor-pointer flex-col items-center justify-center gap-2 border border-dashed bg-paper px-6 py-12 text-center transition-colors duration-[120ms] [border-radius:4px] ${
          dragOver
            ? 'border-amore bg-amore-bg'
            : 'border-line hover:border-ink-2'
        }`}
      >
        <div className="text-[13px] font-semibold text-ink-2">
          파일을 끌어다 놓거나 클릭해서 업로드
        </div>
        <div className="text-[11.5px] text-mute-soft">
          .pdf · .docx · .xlsx · .csv · .txt — 최대 10개, 파일당 25MB
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          onChange={onPick}
          className="hidden"
        />
      </div>

      {rejected.length > 0 && (
        <div className="mt-3 text-[11.5px] text-amore">
          허용되지 않은 형식: {rejected.join(', ')}
        </div>
      )}

      {files.length > 0 && (
        <ul className="mt-5 divide-y divide-line border border-line bg-paper [border-radius:4px]">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${i}`}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12.5px]"
            >
              <span className="truncate text-ink-2">{f.name}</span>
              <span className="shrink-0 tabular-nums text-mute-soft">
                {formatBytes(f.size)}
              </span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                disabled={running}
                className="shrink-0 text-[11.5px] text-mute hover:text-amore disabled:opacity-40"
              >
                제거
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        <label className="mb-2 block text-[12px] font-semibold text-ink-2">
          또는 텍스트 붙여넣기
        </label>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          disabled={running}
          rows={6}
          placeholder="이메일, 메신저, 브리프 텍스트를 그대로 붙여넣으세요."
          className="w-full resize-y border border-line bg-paper px-3 py-2 text-[12.5px] leading-[1.6] text-ink-2 placeholder:text-mute-soft focus:border-ink-2 focus:outline-none disabled:opacity-50 [border-radius:4px]"
        />
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        <span className="text-[11px] tabular-nums text-mute-soft">
          {files.length}개 파일 · {pasted.length}자
        </span>
        <button
          onClick={onClickRun}
          disabled={!canRun}
          className="border border-ink bg-ink px-5 py-2 text-[12px] font-semibold text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
        >
          {running ? tCommon('loading') : '추출 실행'}
        </button>
      </div>

      {errorMessage && (
        <div className="mt-6 border border-amore bg-amore-bg p-4 text-[12.5px] text-amore [border-radius:4px]">
          오류: {errorMessage}
        </div>
      )}

      {(running || view) && (
        <div className="mt-10">
          <h2 className="border-b border-line pb-3 text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
            {running ? '추출 중…' : '추출 결과'}
          </h2>

          {view?.summary && (
            <p className="mt-4 border border-line-soft bg-paper px-4 py-3 text-[12.5px] leading-[1.7] text-ink-2 [border-radius:4px]">
              {view.summary}
            </p>
          )}

          <div className="mt-6 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
            <section>
              <h3 className="mb-3 text-[13px] font-semibold text-ink-2">
                대상자 조건 ({criteria.length})
              </h3>
              {criteria.length === 0 ? (
                <p className="text-[12px] text-mute-soft">
                  {running ? '분석 중…' : '추출된 조건이 없습니다.'}
                </p>
              ) : (
                <ul className="divide-y divide-line border border-line bg-paper [border-radius:4px]">
                  {criteria.map((c, i) => (
                    <li key={i} className="px-4 py-3 text-[12.5px]">
                      <div className="flex items-center gap-2">
                        <span className="text-[10.5px] uppercase tracking-[0.04em] text-mute-soft">
                          {c.category}
                        </span>
                        {c.required ? (
                          <span className="border border-amore px-1.5 py-px text-[10px] text-amore [border-radius:3px]">
                            필수
                          </span>
                        ) : (
                          <span className="border border-line px-1.5 py-px text-[10px] text-mute [border-radius:3px]">
                            우대
                          </span>
                        )}
                      </div>
                      <div className="mt-1 font-semibold text-ink">
                        {c.label}
                      </div>
                      <div className="mt-0.5 text-mute">{c.detail}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-3 text-[13px] font-semibold text-ink-2">
                조사 일정 ({schedule.length})
              </h3>
              {schedule.length === 0 ? (
                <p className="text-[12px] text-mute-soft">
                  {running ? '분석 중…' : '추출된 일정이 없습니다.'}
                </p>
              ) : (
                <ol className="space-y-2">
                  {schedule.map((p, i) => (
                    <li
                      key={i}
                      className="border border-line bg-paper px-4 py-3 text-[12.5px] [border-radius:4px]"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold text-ink">
                          {p.phase}
                        </span>
                        <span className="shrink-0 tabular-nums text-[11px] text-mute-soft">
                          {formatDateRange(p.startDate, p.endDate)}
                        </span>
                      </div>
                      {p.note && (
                        <div className="mt-1 text-[12px] text-mute">
                          {p.note}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
