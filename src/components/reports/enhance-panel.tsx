'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { EnhanceMode, ContextInput } from '@/lib/reports/context-payload';
import { useWorkspace } from '@/components/workspace-provider';

// Self-contained panel that lives under the report result. Caller passes:
//   - reportId / parentVersion (the version currently shown)
//   - onEnhanced(markdownStream, finalMarkdown) — used to drive the live
//     preview in report-generator (it shows enhanced MD chunk-by-chunk
//     then reloads versions when the stream ends).
//
// The panel itself handles mode switching, the input tabs (text · URL ·
// file · workspace · form), and the POST to /api/reports/enhance.

const MIME_ARTIFACT = 'application/x-workspace-artifact';

type Tab = 'text' | 'url' | 'file' | 'workspace' | 'form';

const MODE_LABELS: Record<EnhanceMode, string> = {
  trends: '트렌드로 강화',
  logs: '로그 데이터로 강화',
  perspective: '개인 관점 강화',
};

const MODE_DESC: Record<EnhanceMode, string> = {
  trends: '최신 트렌드 자료를 붙여 넣으면 Executive Summary와 권장사항에 외부 맥락을 반영합니다.',
  logs: '정량 로그(CSV/수치)를 추가하면 챕터별 정량 시그널을 보강합니다.',
  perspective: '특정 역할·관심사 시점에서 본 해석과 강조점을 추가합니다.',
};

export function EnhancePanel({
  reportId,
  parentVersion,
  busy,
  onStart,
  onChunk,
  onComplete,
  onError,
}: {
  reportId: string | null;
  parentVersion: number;
  busy: boolean;
  onStart: (mode: EnhanceMode) => void;
  onChunk: (acc: string) => void;
  onComplete: () => void;
  onError: (msg: string) => void;
}) {
  const workspace = useWorkspace();
  const [mode, setMode] = useState<EnhanceMode | null>(null);
  const [tab, setTab] = useState<Tab>('text');
  const [textBody, setTextBody] = useState('');
  const [urlValue, setUrlValue] = useState('');
  const [fileInput, setFileInput] = useState<{
    filename: string;
    mime?: string;
    size?: number;
    normalized_md: string;
  } | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [artifactId, setArtifactId] = useState<string>('');
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [userNote, setUserNote] = useState('');
  const [formFields, setFormFields] = useState<Record<string, string>>({});

  // Reset transient inputs when the user switches mode — handled in the
  // mode-button onClick rather than an effect so we don't trigger a
  // cascading render (lint: react-hooks/set-state-in-effect).
  function pickMode(next: EnhanceMode | null) {
    setMode(next);
    setTextBody('');
    setUrlValue('');
    setFileInput(null);
    setArtifactId('');
    setFormFields({});
    setTab('text');
  }

  // Pre-fetch artifact content when selection changes so buildInput() stays sync.
  useEffect(() => {
    if (!artifactId) { setArtifactContent(null); return; }
    const a = workspace.artifacts.find((x) => x.id === artifactId);
    if (!a) { setArtifactContent(null); return; }
    let cancelled = false;
    void workspace.fetchContent(a).then((res) => {
      if (!cancelled) setArtifactContent(res?.content ?? null);
    });
    return () => { cancelled = true; };
  }, [artifactId, workspace]);

  const compatibleArtifacts = useMemo(
    () => workspace.artifacts.filter((a) => a.featureKey !== 'reports'),
    [workspace.artifacts],
  );

  const dropRef = useRef<HTMLDivElement | null>(null);

  function onArtifactDrop(e: React.DragEvent) {
    e.preventDefault();
    const id = e.dataTransfer.getData(MIME_ARTIFACT);
    if (id) setArtifactId(id);
  }

  async function uploadContextFile(file: File) {
    setFileBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/reports/context/normalize', {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'extract_failed');
      setFileInput({
        filename: json.filename,
        mime: json.mime,
        size: json.size,
        normalized_md: json.normalized_md,
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : 'extract_failed');
    } finally {
      setFileBusy(false);
    }
  }

  function buildInput(): ContextInput | null {
    if (tab === 'text') {
      if (!textBody.trim()) return null;
      return { kind: 'text', content: textBody.trim() };
    }
    if (tab === 'url') {
      if (!/^https?:\/\//i.test(urlValue.trim())) return null;
      return { kind: 'url', url: urlValue.trim() };
    }
    if (tab === 'file') {
      if (!fileInput) return null;
      return { kind: 'file', ...fileInput };
    }
    if (tab === 'workspace') {
      const a = workspace.artifacts.find((x) => x.id === artifactId);
      if (!a || !artifactContent) return null;
      return {
        kind: 'artifact',
        artifact_id: a.id,
        feature: a.featureKey,
        title: a.title,
        content_excerpt:
          artifactContent.length > 80_000
            ? artifactContent.slice(0, 80_000)
            : artifactContent,
      };
    }
    if (tab === 'form' && mode) {
      const cleaned = Object.fromEntries(
        Object.entries(formFields).filter(([, v]) => v && v.trim().length > 0),
      );
      if (Object.keys(cleaned).length === 0) return null;
      return { kind: 'form', schema: mode, fields: cleaned };
    }
    return null;
  }

  const canRun = !!mode && !!reportId && !busy && !!buildInput();

  async function run() {
    if (!mode || !reportId) return;
    const input = buildInput();
    if (!input) return;
    onStart(mode);
    try {
      const res = await fetch('/api/reports/enhance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          report_id: reportId,
          parent_version: parentVersion,
          payload: {
            mode,
            inputs: [input],
            user_note: userNote.trim() || undefined,
          },
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `enhance_failed_${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        onChunk(acc);
      }
      onComplete();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'enhance_failed');
    }
  }

  const formSchema = mode ? FORM_SCHEMAS[mode] : null;

  return (
    <div className="mt-10 border-t border-line pt-6">
      <div className="flex items-center gap-2">
        <span className="h-[1px] w-6 bg-amore" />
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-amore">
          Enhance
        </span>
      </div>
      <p className="mt-2 text-[12.5px] text-mute">
        외부 맥락을 추가해 v{parentVersion}에서 새 버전을 만듭니다. 원본 사실과 인용은 유지됩니다.
      </p>

      {/* Mode picker */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {(Object.keys(MODE_LABELS) as EnhanceMode[]).map((m) => {
          const active = mode === m;
          return (
            <button
              key={m}
              type="button"
              disabled={busy}
              onClick={() => pickMode(active ? null : m)}
              className={`border px-4 py-3 text-left transition-colors duration-[120ms] [border-radius:4px] ${
                active
                  ? 'border-ink bg-ink text-paper'
                  : 'border-line bg-paper text-ink-2 hover:border-ink-2'
              } disabled:opacity-40`}
            >
              <div className="text-[12.5px] font-semibold">
                {MODE_LABELS[m]}
              </div>
              <div
                className={`mt-1 text-[11px] leading-[1.5] ${active ? 'text-paper/75' : 'text-mute-soft'}`}
              >
                {MODE_DESC[m]}
              </div>
            </button>
          );
        })}
      </div>

      {/* Input area (only when a mode is selected) */}
      {mode && (
        <div className="mt-5 border border-line bg-paper p-4 [border-radius:4px]">
          {/* Tabs */}
          <div className="flex flex-wrap items-center gap-1 border-b border-line-soft pb-2">
            {(['text', 'url', 'file', 'workspace', 'form'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`px-2.5 py-1 text-[11.5px] transition-colors duration-[120ms] [border-radius:4px] ${
                  tab === t
                    ? 'border border-ink-2 bg-paper text-ink-2'
                    : 'border border-transparent text-mute hover:text-ink-2'
                }`}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>

          <div className="mt-3">
            {tab === 'text' && (
              <textarea
                value={textBody}
                onChange={(e) => setTextBody(e.target.value)}
                rows={6}
                placeholder="트렌드 기사/메모/요약을 붙여 넣으세요."
                className="w-full resize-y border border-line bg-paper-soft px-3 py-2 text-[12.5px] leading-[1.65] text-ink-2 outline-none focus:border-ink-2 [border-radius:4px]"
              />
            )}
            {tab === 'url' && (
              <input
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                type="url"
                placeholder="https://..."
                className="w-full border border-line bg-paper-soft px-3 py-2 text-[12.5px] text-ink-2 outline-none focus:border-ink-2 [border-radius:4px]"
              />
            )}
            {tab === 'file' && (
              <div>
                <input
                  type="file"
                  accept=".docx,.md,.markdown,.txt,.xlsx,.csv"
                  disabled={fileBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadContextFile(f);
                  }}
                  className="text-[12px] text-mute"
                />
                {fileBusy && (
                  <div className="mt-2 text-[11.5px] text-mute-soft">
                    추출 중...
                  </div>
                )}
                {fileInput && !fileBusy && (
                  <div className="mt-2 text-[11.5px] text-mute">
                    {fileInput.filename} ·{' '}
                    {fileInput.normalized_md.length.toLocaleString()}자 추출됨
                  </div>
                )}
              </div>
            )}
            {tab === 'workspace' && (
              <div
                ref={dropRef}
                onDragOver={(e) => e.preventDefault()}
                onDrop={onArtifactDrop}
                className="border border-dashed border-line bg-paper-soft px-3 py-3 text-[12px] [border-radius:4px]"
              >
                <div className="text-mute-soft">
                  Workspace에서 artifact를 드래그하거나 아래에서 선택하세요.
                </div>
                <select
                  value={artifactId}
                  onChange={(e) => setArtifactId(e.target.value)}
                  className="mt-2 w-full border border-line bg-paper px-2 py-1.5 text-[12px] text-ink-2 outline-none focus:border-ink-2 [border-radius:4px]"
                >
                  <option value="">— 선택 —</option>
                  {compatibleArtifacts.map((a) => (
                    <option key={a.id} value={a.id}>
                      [{a.featureKey}] {a.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {tab === 'form' && formSchema && (
              <div className="grid gap-3">
                {formSchema.map((f) => (
                  <label key={f.key} className="grid gap-1">
                    <span className="text-[10.5px] uppercase tracking-[0.18em] text-mute-soft">
                      {f.label}
                    </span>
                    {f.type === 'textarea' ? (
                      <textarea
                        rows={3}
                        value={formFields[f.key] ?? ''}
                        onChange={(e) =>
                          setFormFields((p) => ({
                            ...p,
                            [f.key]: e.target.value,
                          }))
                        }
                        placeholder={f.placeholder}
                        className="resize-y border border-line bg-paper-soft px-3 py-2 text-[12.5px] text-ink-2 outline-none focus:border-ink-2 [border-radius:4px]"
                      />
                    ) : (
                      <input
                        value={formFields[f.key] ?? ''}
                        onChange={(e) =>
                          setFormFields((p) => ({
                            ...p,
                            [f.key]: e.target.value,
                          }))
                        }
                        placeholder={f.placeholder}
                        className="border border-line bg-paper-soft px-3 py-2 text-[12.5px] text-ink-2 outline-none focus:border-ink-2 [border-radius:4px]"
                      />
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* User note + run */}
          <div className="mt-4 grid gap-2">
            <label className="grid gap-1">
              <span className="text-[10.5px] uppercase tracking-[0.18em] text-mute-soft">
                자유 지시 (선택)
              </span>
              <input
                value={userNote}
                onChange={(e) => setUserNote(e.target.value)}
                placeholder="예: 결론을 이 트렌드와 직접 연결해줘"
                className="border border-line bg-paper-soft px-3 py-2 text-[12px] text-ink-2 outline-none focus:border-ink-2 [border-radius:4px]"
              />
            </label>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-mute-soft">
                강화 1회 · 20크레딧
              </span>
              <button
                type="button"
                onClick={run}
                disabled={!canRun}
                className="border border-ink bg-ink px-4 py-2 text-[12px] font-semibold text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
              >
                {busy ? '강화 중...' : `v${parentVersion + 1} 생성`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const TAB_LABEL: Record<Tab, string> = {
  text: '텍스트',
  url: 'URL',
  file: '파일',
  workspace: 'Workspace',
  form: '폼',
};

type FormField = {
  key: string;
  label: string;
  type: 'text' | 'textarea';
  placeholder?: string;
};

const FORM_SCHEMAS: Record<EnhanceMode, FormField[]> = {
  trends: [
    { key: 'keywords', label: 'Trend Keywords', type: 'text', placeholder: '예: 슬로우 뷰티, 더마, 안티에이징' },
    { key: 'period', label: 'Period', type: 'text', placeholder: '2025 H2' },
    { key: 'sources', label: 'Sources', type: 'text', placeholder: '예: Mintel, Nielsen, 자체 SNS 분석' },
    { key: 'summary', label: 'Trend Summary', type: 'textarea', placeholder: '핵심 트렌드 2~5줄 요약' },
  ],
  logs: [
    { key: 'metric', label: 'Metric Name', type: 'text', placeholder: '예: 사용 빈도 (회/주)' },
    { key: 'unit', label: 'Unit', type: 'text', placeholder: '회/주, %, KRW' },
    { key: 'lens', label: 'Analysis Lens', type: 'text', placeholder: 'WoW · 세그먼트별 · 코호트' },
    { key: 'observations', label: 'Key Observations', type: 'textarea', placeholder: '관찰된 핵심 수치 패턴' },
  ],
  perspective: [
    { key: 'role', label: 'Role', type: 'text', placeholder: 'PM / 디자이너 / 리서처 / 임원' },
    { key: 'interests', label: 'Interests', type: 'text', placeholder: '가격, UX, 충성도' },
    { key: 'tone', label: 'Tone', type: 'text', placeholder: '객관 / 주장적 / 보수적' },
    { key: 'lens', label: 'Lens', type: 'textarea', placeholder: '이 관점에서 본 핵심 해석/반론' },
  ],
};
