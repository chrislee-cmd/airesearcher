"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { ChromeButton } from "@/components/ui/chrome-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Topic,
  parseCsv,
  parseSheetsUrlToCsvExport,
  rowsToTopics,
} from "./lib/topics";

export type UrlSource = { kind: "url"; url: string };
export type FileSource = {
  kind: "file";
  format: "csv" | "xlsx";
  fileName: string;
  topics: Topic[];
};
export type ManualSource = {
  kind: "manual";
  text: string;
  topics: Topic[];
};

export type Source = UrlSource | FileSource | ManualSource;

export type Sources = {
  url?: UrlSource;
  file?: FileSource;
  manual?: ManualSource;
};

export function activeSourceCount(s: Sources): number {
  return (s.url ? 1 : 0) + (s.file ? 1 : 0) + (s.manual ? 1 : 0);
}

export function sourcesLabel(s: Sources): string {
  const parts: string[] = [];
  if (s.url) parts.push("Sheets");
  if (s.file) parts.push(s.file.format.toUpperCase());
  if (s.manual) parts.push("직접입력");
  return parts.length === 0 ? "소스 없음" : parts.join(" + ");
}

function parseManualText(text: string): Topic[] {
  const seen = new Set<string>();
  const out: Topic[] = [];
  const lines = text.split(/\r?\n/);
  let i = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let theme = "Etc";
    let prompt = line;
    const sep = line.indexOf("|");
    if (sep > 0) {
      const left = line.slice(0, sep).trim();
      const right = line.slice(sep + 1).trim();
      if (left && right) {
        theme = left;
        prompt = right;
      }
    }
    if (!prompt) continue;
    const key = prompt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: i++, theme, prompt });
  }
  return out;
}

type Props = {
  sources: Sources;
  onApplyUrl: (s: UrlSource) => void;
  onApplyFile: (s: FileSource) => void;
  onApplyManual: (s: ManualSource) => void;
  onClearUrl: () => void;
  onClearFile: () => void;
  onClearManual: () => void;
};

type Tab = "url" | "file" | "manual";

export default function SourcePicker({
  sources,
  onApplyUrl,
  onApplyFile,
  onApplyManual,
  onClearUrl,
  onClearFile,
  onClearManual,
}: Props) {
  const [tab, setTab] = useState<Tab>(() => {
    if (sources.url) return "url";
    if (sources.file) return "file";
    if (sources.manual) return "manual";
    return "url";
  });

  const tabMeta: Record<
    Tab,
    { icon: string; label: string; active: boolean; activeLabel: string }
  > = {
    url: {
      icon: "📊",
      label: "Sheets",
      active: !!sources.url,
      activeLabel: "URL",
    },
    file: {
      icon: "📁",
      label: "파일",
      active: !!sources.file,
      activeLabel: sources.file
        ? `${sources.file.format.toUpperCase()} · ${sources.file.topics.length}`
        : "",
    },
    manual: {
      icon: "✍️",
      label: "직접",
      active: !!sources.manual,
      activeLabel: sources.manual ? `${sources.manual.topics.length}개` : "",
    },
  };

  return (
    <section className="rounded-sm border border-line bg-paper">
      <div className="flex items-stretch gap-0.5 border-b border-line p-1">
        {(Object.keys(tabMeta) as Tab[]).map((t) => {
          const m = tabMeta[t];
          const selected = tab === t;
          return (
            <ChromeButton
              key={t}
              onClick={() => setTab(t)}
              size="xs"
              variant={selected ? "primary" : "mute"}
              className="flex-1 justify-center"
            >
              <span className="text-xs leading-none">{m.icon}</span>
              <span>{m.label}</span>
              {m.active && (
                <span
                  className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-success"
                  title="사용 중"
                />
              )}
            </ChromeButton>
          );
        })}
      </div>

      {tab === "url" && (
        <UrlPanel
          active={!!sources.url}
          currentUrl={sources.url?.url ?? ""}
          onApply={onApplyUrl}
          onClear={onClearUrl}
        />
      )}
      {tab === "file" && (
        <FilePanel
          active={!!sources.file}
          currentFileName={sources.file?.fileName ?? null}
          currentCount={sources.file?.topics.length ?? 0}
          onApply={onApplyFile}
          onClear={onClearFile}
        />
      )}
      {tab === "manual" && (
        <ManualPanel
          active={!!sources.manual}
          currentText={sources.manual?.text ?? ""}
          currentCount={sources.manual?.topics.length ?? 0}
          onApply={onApplyManual}
          onClear={onClearManual}
        />
      )}
    </section>
  );
}

function PanelShell({
  description,
  active,
  activeLabel,
  onClear,
  children,
}: {
  description?: React.ReactNode;
  active: boolean;
  activeLabel?: string;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 p-2.5">
      {(active || description) && (
        <div className="flex items-center justify-between gap-2">
          {description && (
            <div className="flex-1 text-xs leading-snug text-mute">
              {description}
            </div>
          )}
          {active && (
            <div className="flex shrink-0 items-center gap-1">
              <span className="rounded-full bg-amore-bg px-1.5 py-0.5 text-xs font-medium text-amore">
                사용 중{activeLabel ? ` · ${activeLabel}` : ""}
              </span>
              {onClear && (
                <ChromeButton onClick={onClear} size="xs" variant="mute">
                  해제
                </ChromeButton>
              )}
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function UrlPanel({
  active,
  currentUrl,
  onApply,
  onClear,
}: {
  active: boolean;
  currentUrl: string;
  onApply: (s: UrlSource) => void;
  onClear: () => void;
}) {
  const [urlInput, setUrlInput] = useState(currentUrl);
  const [urlError, setUrlError] = useState<string | null>(null);

  function apply() {
    setUrlError(null);
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setUrlError("URL을 입력하세요.");
      return;
    }
    if (!parseSheetsUrlToCsvExport(trimmed)) {
      setUrlError(
        "유효한 Google Sheets URL이 아닙니다. (예: https://docs.google.com/spreadsheets/d/.../edit#gid=0)",
      );
      return;
    }
    onApply({ kind: "url", url: trimmed });
  }

  return (
    <PanelShell active={active} onClear={onClear}>
      <div className="flex gap-1.5">
        <Input
          type="text"
          size="sm"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=0"
        />
        <Button onClick={apply} size="sm" variant="primary">
          적용
        </Button>
      </div>
      {urlError && <div className="text-sm text-warning">{urlError}</div>}
      <div className="text-xs text-mute-soft">
        시트는 &apos;링크가 있는 모든 사용자(보기)&apos;로 공유되어야 합니다.
      </div>
    </PanelShell>
  );
}

function FilePanel({
  active,
  currentFileName,
  currentCount,
  onApply,
  onClear,
}: {
  active: boolean;
  currentFileName: string | null;
  currentCount: number;
  onApply: (s: FileSource) => void;
  onClear: () => void;
}) {
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function handleFile(file: File) {
    setFileError(null);
    setFileBusy(true);
    try {
      const name = file.name.toLowerCase();
      let topics: Topic[];
      let format: "csv" | "xlsx";
      if (name.endsWith(".csv")) {
        const text = await file.text();
        topics = rowsToTopics(parseCsv(text));
        format = "csv";
      } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const firstSheetName = wb.SheetNames[0];
        if (!firstSheetName) throw new Error("시트가 비어있습니다.");
        const sheet = wb.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
          header: 1,
          raw: false,
          defval: "",
        });
        topics = rowsToTopics(rows.map((r) => (r as unknown as string[]) ?? []));
        format = "xlsx";
      } else {
        throw new Error(
          "지원하지 않는 형식입니다. CSV 또는 XLSX 파일을 사용하세요.",
        );
      }
      if (topics.length === 0) {
        throw new Error(
          "토픽을 찾지 못했습니다. 첫 행에 'Prompt'(또는 'Question', '토픽', '질문') 컬럼이 필요합니다. 'Theme'/'Category'/'Topic'은 테마 그룹핑에 사용됩니다.",
        );
      }
      onApply({ kind: "file", format, fileName: file.name, topics });
    } catch (e) {
      setFileError(e instanceof Error ? e.message : "파일 파싱 실패");
    } finally {
      setFileBusy(false);
    }
  }

  return (
    <PanelShell
      active={active}
      onClear={onClear}
      activeLabel={
        currentFileName
          ? `${currentFileName} · ${currentCount}개`
          : `${currentCount}개`
      }
    >
      <div className="flex items-center gap-2">
        <Button
          onClick={() => fileRef.current?.click()}
          size="sm"
          variant="secondary"
          disabled={fileBusy}
        >
          파일 선택
        </Button>
        {currentFileName && (
          <span className="truncate text-sm text-mute">{currentFileName}</span>
        )}
        {/* eslint-disable-next-line react/forbid-elements -- hidden file input owned by Button trigger */}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={fileBusy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
          className="hidden"
        />
      </div>
      {fileBusy && (
        <div className="text-sm text-mute">파일을 파싱 중…</div>
      )}
      {fileError && <div className="text-sm text-warning">{fileError}</div>}
      <div className="text-xs leading-snug text-mute-soft">
        컬럼: <code className="rounded-xs bg-paper-soft px-1">Prompt</code>(필수) ·{" "}
        <code className="rounded-xs bg-paper-soft px-1">Theme</code>/
        <code className="rounded-xs bg-paper-soft px-1">Topic</code>(그룹)
      </div>
    </PanelShell>
  );
}

function ManualPanel({
  active,
  currentText,
  currentCount,
  onApply,
  onClear,
}: {
  active: boolean;
  currentText: string;
  currentCount: number;
  onApply: (s: ManualSource) => void;
  onClear: () => void;
}) {
  const [manualInput, setManualInput] = useState(currentText);
  const [manualError, setManualError] = useState<string | null>(null);
  const manualPreview = parseManualText(manualInput);

  function apply() {
    setManualError(null);
    const topics = parseManualText(manualInput);
    if (topics.length === 0) {
      setManualError("최소 1개 이상의 토픽을 입력하세요.");
      return;
    }
    onApply({ kind: "manual", text: manualInput, topics });
  }

  return (
    <PanelShell
      active={active}
      onClear={onClear}
      activeLabel={`${currentCount}개`}
    >
      <Textarea
        value={manualInput}
        onChange={(e) => setManualInput(e.target.value)}
        placeholder={"예) 생산성 | 아침 루틴\n글쓰기 | 첫 문장 잘 쓰는 법"}
        rows={3}
        className="text-md"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-mute">
          인식 {manualPreview.length}개 ·{" "}
          <code className="rounded-xs bg-paper-soft px-1">테마 | 프롬프트</code> 형식
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {manualInput && (
            <Button onClick={() => setManualInput("")} size="xs" variant="link">
              지우기
            </Button>
          )}
          <Button onClick={apply} size="xs" variant="primary">
            적용
          </Button>
        </div>
      </div>
      {manualError && (
        <div className="text-sm text-warning">{manualError}</div>
      )}
    </PanelShell>
  );
}
