"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChromeButton } from "@/components/ui/chrome-button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { Topic } from "./lib/topics";
import { Markdown } from "./markdown";
import SourcePicker, {
  FileSource,
  ManualSource,
  Sources,
  UrlSource,
  activeSourceCount,
  sourcesLabel,
} from "./source-picker";
import StylePanel from "./style-panel";
import Canvas, {
  CanvasPrompt,
  ImportedResultItem,
  NodeSelection,
  NodeStatus,
  ResultGroup,
  ResultStatus,
} from "./canvas";
import ImageInspector, {
  ImagePlacement,
} from "./inspectors/image-inspector";
import DeployInspector, {
  DeployChannel,
  DeployJob,
} from "./inspectors/deploy-inspector";
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import {
  CONTENT_TYPE_OPTIONS,
  DEFAULT_STYLE,
  EMOJI_OPTIONS,
  FORMALITY_OPTIONS,
  LANGUAGE_OPTIONS,
  PERSONA_OPTIONS,
  StyleConfig,
} from "./style-config";

function pickValid<T extends { value: string }>(
  opts: T[],
  v: unknown,
  fallback: T["value"],
): T["value"] {
  return opts.some((o) => o.value === v) ? (v as T["value"]) : fallback;
}

function migrateStyle(raw: unknown): StyleConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    language: pickValid(LANGUAGE_OPTIONS, r.language, DEFAULT_STYLE.language),
    formality: pickValid(
      FORMALITY_OPTIONS,
      r.formality,
      DEFAULT_STYLE.formality,
    ),
    persona: pickValid(PERSONA_OPTIONS, r.persona, DEFAULT_STYLE.persona),
    contentType: pickValid(
      CONTENT_TYPE_OPTIONS,
      r.contentType,
      DEFAULT_STYLE.contentType,
    ),
    emoji: pickValid(EMOJI_OPTIONS, r.emoji, DEFAULT_STYLE.emoji),
    customNotes: typeof r.customNotes === "string" ? r.customNotes : "",
  };
}

const STYLE_STORAGE_KEY = "enko.styleConfig.v2";
const SOURCE_STORAGE_KEY = "enko.topicSources.v2";
const CUSTOMIZES_STORAGE_KEY = "enko.customizes.v1";
const ASSIGNMENTS_STORAGE_KEY = "enko.assignments.v1";
const DEPLOY_CHANNELS_STORAGE_KEY = "enko.deployChannels.v1";

function topicKey(t: { theme: string; prompt: string }): string {
  return `${t.theme}${t.prompt}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineMd(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, "$1<em>$2</em>")
    .replace(/(^|\s)\*([^*]+)\*(?=\s|$)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function markdownToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let inList: "ul" | "ol" | null = null;
  let paraBuf: string[] = [];

  const closeList = () => {
    if (inList) {
      out.push(`</${inList}>`);
      inList = null;
    }
  };
  const flushPara = () => {
    if (paraBuf.length > 0) {
      out.push(`<p>${renderInlineMd(paraBuf.join(" "))}</p>`);
      paraBuf = [];
    }
  };
  const openList = (kind: "ul" | "ol") => {
    if (inList && inList !== kind) closeList();
    if (!inList) {
      out.push(`<${kind}>`);
      inList = kind;
    }
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushPara();
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/))) {
      flushPara();
      closeList();
      out.push(
        `<figure><img src="${escapeHtml(m[2])}" alt="${escapeHtml(m[1])}" /></figure>`,
      );
      continue;
    }
    if ((m = line.match(/^###\s+(.+)$/))) {
      flushPara();
      closeList();
      out.push(`<h3>${renderInlineMd(m[1])}</h3>`);
      continue;
    }
    if ((m = line.match(/^##\s+(.+)$/))) {
      flushPara();
      closeList();
      out.push(`<h2>${renderInlineMd(m[1])}</h2>`);
      continue;
    }
    if ((m = line.match(/^#\s+(.+)$/))) {
      flushPara();
      closeList();
      out.push(`<h1>${renderInlineMd(m[1])}</h1>`);
      continue;
    }
    if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara();
      closeList();
      out.push(`<blockquote>${renderInlineMd(m[1] ?? "")}</blockquote>`);
      continue;
    }
    if ((m = line.match(/^[-*+]\s+(.+)$/))) {
      flushPara();
      openList("ul");
      out.push(`<li>${renderInlineMd(m[1])}</li>`);
      continue;
    }
    if ((m = line.match(/^\d+\.\s+(.+)$/))) {
      flushPara();
      openList("ol");
      out.push(`<li>${renderInlineMd(m[1])}</li>`);
      continue;
    }
    paraBuf.push(line);
  }
  flushPara();
  closeList();
  return out.join("\n");
}

function exportToPdf(title: string, content: string) {
  const bodyHtml = markdownToHtml(content);
  const safeTitle = escapeHtml(title);
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${safeTitle}</title>
<style>
  :root { color-scheme: light; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
    line-height: 1.65;
    color: #1f2937;
    max-width: 720px;
    margin: 2.5rem auto;
    padding: 0 1.25rem;
  }
  h1, h2, h3 { line-height: 1.2; margin-top: 1.6em; margin-bottom: 0.5em; color: #111827; }
  h1 { font-size: 1.9rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.4em; }
  h2 { font-size: 1.45rem; }
  h3 { font-size: 1.2rem; }
  p { margin: 0.75em 0; }
  ul, ol { padding-left: 1.4em; }
  li { margin: 0.3em 0; }
  img { max-width: 100%; height: auto; border-radius: 6px; }
  figure { margin: 1.2em 0; text-align: center; }
  blockquote { border-left: 3px solid #d1d5db; padding: 0.2em 1em; color: #4b5563; margin: 1em 0; }
  pre { background: #f3f4f6; padding: 0.8em 1em; overflow: auto; border-radius: 6px; font-size: 0.85em; }
  code { background: #f3f4f6; padding: 0.1em 0.3em; border-radius: 4px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  @media print {
    body { margin: 0; padding: 0 0.5in; }
    a { color: inherit; text-decoration: none; }
  }
</style>
</head>
<body>
<h1>${safeTitle}</h1>
${bodyHtml}
<script>
  window.addEventListener("load", function() {
    setTimeout(function() { window.focus(); window.print(); }, 250);
  });
</script>
</body>
</html>`;
  const w = window.open("", "_blank");
  if (!w) {
    throw new Error("팝업이 차단되었습니다. 팝업 차단을 해제하고 다시 시도하세요.");
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

type InlineRun = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

function tokenizeInline(s: string): (InlineRun | { link: string; text: string })[] {
  const out: (InlineRun | { link: string; text: string })[] = [];
  // Tokens: link [text](url), bold **x**, italic _x_ or *x* (single asterisk word-bounded), code `x`
  const re =
    /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|(^|\s)_([^_]+)_(?=\s|$|[.,!?;:])|(^|\s)\*([^*]+)\*(?=\s|$|[.,!?;:])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const start = m.index;
    const matched = m[0];
    // text before the match (preserve leading whitespace captured by italic patterns)
    if (start > last) out.push({ text: s.slice(last, start) });
    if (m[1] !== undefined && m[2] !== undefined) {
      out.push({ link: m[2], text: m[1] });
    } else if (m[3] !== undefined) {
      out.push({ text: m[3], bold: true });
    } else if (m[4] !== undefined) {
      out.push({ text: m[4], code: true });
    } else if (m[6] !== undefined) {
      if (m[5]) out.push({ text: m[5] });
      out.push({ text: m[6], italic: true });
    } else if (m[8] !== undefined) {
      if (m[7]) out.push({ text: m[7] });
      out.push({ text: m[8], italic: true });
    }
    last = start + matched.length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

function inlineRunsToDocx(
  s: string,
): (TextRun | ExternalHyperlink)[] {
  const tokens = tokenizeInline(s);
  const children: (TextRun | ExternalHyperlink)[] = [];
  for (const t of tokens) {
    if ("link" in t) {
      children.push(
        new ExternalHyperlink({
          link: t.link,
          children: [
            new TextRun({ text: t.text, style: "Hyperlink", color: "1d4ed8", underline: {} }),
          ],
        }),
      );
    } else {
      children.push(
        new TextRun({
          text: t.text,
          bold: t.bold,
          italics: t.italic,
          font: t.code ? "Courier New" : undefined,
        }),
      );
    }
  }
  return children;
}

function markdownToDocxParagraphs(md: string): Paragraph[] {
  const lines = md.split(/\r?\n/);
  const out: Paragraph[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  const flushCode = () => {
    if (codeBuf.length === 0) return;
    for (const cl of codeBuf) {
      out.push(
        new Paragraph({
          children: [new TextRun({ text: cl, font: "Courier New", size: 20 })],
          spacing: { before: 0, after: 0 },
        }),
      );
    }
    codeBuf = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    if (!line.trim()) {
      out.push(new Paragraph({ children: [] }));
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/))) {
      out.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: `[이미지: ${m[1] || m[2]}]`, italics: true, color: "6b7280" }),
          ],
        }),
      );
      continue;
    }
    if ((m = line.match(/^###\s+(.+)$/))) {
      out.push(
        new Paragraph({ heading: HeadingLevel.HEADING_3, children: inlineRunsToDocx(m[1]) }),
      );
      continue;
    }
    if ((m = line.match(/^##\s+(.+)$/))) {
      out.push(
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: inlineRunsToDocx(m[1]) }),
      );
      continue;
    }
    if ((m = line.match(/^#\s+(.+)$/))) {
      out.push(
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: inlineRunsToDocx(m[1]) }),
      );
      continue;
    }
    if ((m = line.match(/^>\s?(.*)$/))) {
      out.push(
        new Paragraph({
          children: inlineRunsToDocx(m[1] ?? ""),
          indent: { left: 360 },
        }),
      );
      continue;
    }
    if ((m = line.match(/^[-*+]\s+(.+)$/))) {
      out.push(
        new Paragraph({ bullet: { level: 0 }, children: inlineRunsToDocx(m[1]) }),
      );
      continue;
    }
    if ((m = line.match(/^\d+\.\s+(.+)$/))) {
      out.push(
        new Paragraph({
          numbering: { reference: "default-ordered", level: 0 },
          children: inlineRunsToDocx(m[1]),
        }),
      );
      continue;
    }
    out.push(new Paragraph({ children: inlineRunsToDocx(line) }));
  }
  flushCode();
  return out;
}

function slugForFilename(s: string): string {
  return s
    .replace(/[\\/:*?"<>| -]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60) || "document";
}

async function exportToDocx(filename: string, title: string, content: string) {
  const body: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: title })],
    }),
    ...markdownToDocxParagraphs(content),
  ];
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "default-ordered",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [{ children: body }],
  });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function renderContentWithImagePlacements(
  output: string,
  placements: ImagePlacement[],
): string {
  const ready = placements.filter(
    (p) => p.status === "ready" && p.imageUrl && p.imageUrl.trim().length > 0,
  );
  if (ready.length === 0) return output;

  const blocks = output.trim().split(/\n\s*\n/);
  const byIndex = new Map<number, ImagePlacement[]>();
  for (const p of ready) {
    const arr = byIndex.get(p.afterBlockIndex) ?? [];
    arr.push(p);
    byIndex.set(p.afterBlockIndex, arr);
  }
  const renderImg = (p: ImagePlacement) =>
    `![${(p.keyword || "image").replace(/[\[\]]/g, "")}](${p.imageUrl})`;

  const out: string[] = [];
  for (const p of byIndex.get(-1) ?? []) out.push(renderImg(p));
  blocks.forEach((b, i) => {
    out.push(b);
    for (const p of byIndex.get(i) ?? []) out.push(renderImg(p));
  });
  return out.join("\n\n");
}

function migrateSources(raw: unknown): Sources {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  if (typeof r.kind === "string") {
    if (r.kind === "url" && typeof r.url === "string") {
      return { url: { kind: "url", url: r.url } };
    }
    if (
      r.kind === "manual" &&
      typeof r.text === "string" &&
      Array.isArray(r.topics)
    ) {
      return {
        manual: {
          kind: "manual",
          text: r.text as string,
          topics: r.topics as Topic[],
        },
      };
    }
    return {};
  }
  const out: Sources = {};
  const u = r.url as { url?: unknown } | undefined;
  if (u && typeof u.url === "string") {
    out.url = { kind: "url", url: u.url };
  }
  const m = r.manual as
    | { text?: unknown; topics?: unknown }
    | undefined;
  if (m && typeof m.text === "string" && Array.isArray(m.topics)) {
    out.manual = {
      kind: "manual",
      text: m.text,
      topics: m.topics as Topic[],
    };
  }
  return out;
}

type CustomizeWidget = {
  id: string;
  name: string;
  style: StyleConfig;
};

type GenerationResult = {
  id: string;
  customizeId: string;
  customizeName: string;
  promptKey: string;
  theme: string;
  prompt: string;
  direction: string;
  output: string;
  status: ResultStatus;
  error?: string;
  createdAt: number;
};

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function TopicsClient() {
  const [urlTopics, setUrlTopics] = useState<Topic[]>([]);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const [sources, setSources] = useState<Sources>({});

  const [customizes, setCustomizes] = useState<CustomizeWidget[]>([
    { id: "default", name: "커스터마이즈 1", style: DEFAULT_STYLE },
  ]);
  // assignments: promptKey -> list of customizeIds. Presence = on canvas. Empty array = source bucket.
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});

  const [selectedPromptKey, setSelectedPromptKey] = useState<string | null>(
    null,
  );

  const [selection, setSelection] = useState<NodeSelection>({
    kind: "source",
  });

  const [results, setResults] = useState<GenerationResult[]>([]);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);

  // Image widget state
  const [imageImports, setImageImports] = useState<string[]>([]);
  const [imagePlacements, setImagePlacements] = useState<
    Record<string, ImagePlacement[]>
  >({});
  const [imageActiveResultId, setImageActiveResultId] = useState<string | null>(
    null,
  );

  // Deploy widget state
  const [deployImports, setDeployImports] = useState<string[]>([]);
  const [deployChannels, setDeployChannels] = useState<DeployChannel[]>([]);
  const [deploySelections, setDeploySelections] = useState<
    Record<string, string[]>
  >({});
  const [deployJobs, setDeployJobs] = useState<DeployJob[]>([]);
  const [publishingChannelIds, setPublishingChannelIds] = useState<Set<string>>(
    new Set(),
  );
  const [quickExportingByResult, setQuickExportingByResult] = useState<
    Record<string, Set<"pdf" | "docx">>
  >({});
  const [deployActiveResultId, setDeployActiveResultId] = useState<
    string | null
  >(null);

  const abortRefs = useRef<Record<string, AbortController>>({});

  // Load persisted state
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SOURCE_STORAGE_KEY);
      if (raw) {
        const migrated = migrateSources(JSON.parse(raw));
        if (activeSourceCount(migrated) > 0) {
          setSources(migrated);
          setSelection(null);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      const rawC = localStorage.getItem(CUSTOMIZES_STORAGE_KEY);
      if (rawC) {
        const parsed = JSON.parse(rawC);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const valid: CustomizeWidget[] = [];
          for (const c of parsed) {
            if (
              c &&
              typeof c.id === "string" &&
              typeof c.name === "string"
            ) {
              valid.push({
                id: c.id,
                name: c.name,
                style: migrateStyle(c.style),
              });
            }
          }
          if (valid.length > 0) setCustomizes(valid);
        }
      } else {
        const rawS = localStorage.getItem(STYLE_STORAGE_KEY);
        if (rawS) {
          const seeded = migrateStyle(JSON.parse(rawS));
          setCustomizes([
            { id: "default", name: "커스터마이즈 1", style: seeded },
          ]);
        }
      }
      const rawA = localStorage.getItem(ASSIGNMENTS_STORAGE_KEY);
      if (rawA) {
        const parsed = JSON.parse(rawA);
        if (parsed && typeof parsed === "object") {
          const valid: Record<string, string[]> = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (Array.isArray(v)) {
              valid[k] = v.filter((x): x is string => typeof x === "string");
            } else if (typeof v === "string") {
              valid[k] = [v];
            } else if (v === null) {
              valid[k] = [];
            }
          }
          setAssignments(valid);
        }
      }
      const rawD = localStorage.getItem(DEPLOY_CHANNELS_STORAGE_KEY);
      if (rawD) {
        const parsed = JSON.parse(rawD);
        if (Array.isArray(parsed)) {
          const valid: DeployChannel[] = [];
          for (const c of parsed) {
            if (
              !c ||
              typeof c.id !== "string" ||
              typeof c.name !== "string" ||
              !c.config
            )
              continue;
            if (
              c.kind === "wordpress" &&
              typeof c.config.url === "string" &&
              typeof c.config.username === "string" &&
              typeof c.config.appPassword === "string"
            ) {
              valid.push(c as DeployChannel);
            } else if (
              c.kind === "notion" &&
              typeof c.config.integrationToken === "string" &&
              typeof c.config.parentPageId === "string"
            ) {
              valid.push(c as DeployChannel);
            } else if (c.kind === "pdf" || c.kind === "docx") {
              valid.push({ ...c, config: {} } as DeployChannel);
            }
          }
          if (valid.length > 0) setDeployChannels(valid);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        DEPLOY_CHANNELS_STORAGE_KEY,
        JSON.stringify(deployChannels),
      );
    } catch {
      // ignore
    }
  }, [deployChannels]);

  // Persist sources
  useEffect(() => {
    try {
      const toStore: Sources = {};
      if (sources.url) toStore.url = sources.url;
      if (sources.manual) toStore.manual = sources.manual;
      localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(toStore));
    } catch {
      // ignore
    }
  }, [sources]);

  // Persist customizes
  useEffect(() => {
    try {
      localStorage.setItem(CUSTOMIZES_STORAGE_KEY, JSON.stringify(customizes));
    } catch {
      // ignore
    }
  }, [customizes]);

  // Persist assignments
  useEffect(() => {
    try {
      localStorage.setItem(
        ASSIGNMENTS_STORAGE_KEY,
        JSON.stringify(assignments),
      );
    } catch {
      // ignore
    }
  }, [assignments]);

  // Fetch URL topics
  useEffect(() => {
    let cancelled = false;
    if (!sources.url) {
      setUrlTopics([]);
      setLoadingUrl(false);
      setUrlError(null);
      return;
    }
    const urlVal = sources.url.url;
    setLoadingUrl(true);
    setUrlError(null);
    (async () => {
      try {
        const qs = `?url=${encodeURIComponent(urlVal)}`;
        const res = await fetch(`/api/autocontents/topics${qs}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { topics: Topic[] };
        if (!cancelled) setUrlTopics(data.topics);
      } catch (e) {
        if (!cancelled)
          setUrlError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (!cancelled) setLoadingUrl(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sources.url?.url]);

  // Merge topics from all sources (dedup)
  const topics = useMemo<Topic[]>(() => {
    const seen = new Set<string>();
    const collected: { theme: string; prompt: string }[] = [];
    const push = (t: { theme: string; prompt: string }) => {
      const k = topicKey(t);
      if (seen.has(k)) return;
      seen.add(k);
      collected.push({ theme: t.theme, prompt: t.prompt });
    };
    for (const t of urlTopics) push(t);
    if (sources.file) for (const t of sources.file.topics) push(t);
    if (sources.manual) for (const t of sources.manual.topics) push(t);
    return collected.map((t, i) => ({ ...t, id: i }));
  }, [urlTopics, sources.file, sources.manual]);

  const grouped = useMemo(() => {
    const map = new Map<string, Topic[]>();
    for (const t of topics) {
      const key = t.theme || "Etc";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries());
  }, [topics]);

  // Compute canvas prompts: only those present in `assignments` are on canvas
  const topicByKey = useMemo(() => {
    const m = new Map<string, Topic>();
    for (const t of topics) m.set(topicKey(t), t);
    return m;
  }, [topics]);

  const canvasPromptsAll: CanvasPrompt[] = useMemo(() => {
    const out: CanvasPrompt[] = [];
    for (const key of Object.keys(assignments)) {
      const t = topicByKey.get(key);
      if (t) out.push({ key, theme: t.theme, prompt: t.prompt });
    }
    return out;
  }, [assignments, topicByKey]);

  const bucketPrompts = useMemo(
    () => canvasPromptsAll.filter((p) => (assignments[p.key] ?? []).length === 0),
    [canvasPromptsAll, assignments],
  );

  const customizePrompts = useMemo(() => {
    const out: Record<string, CanvasPrompt[]> = {};
    for (const c of customizes) out[c.id] = [];
    for (const p of canvasPromptsAll) {
      const cids = assignments[p.key] ?? [];
      for (const cid of cids) {
        if (out[cid]) out[cid].push(p);
      }
    }
    return out;
  }, [canvasPromptsAll, customizes, assignments]);

  // Resolve current customize for the selected prompt (used by Run)
  const selectedPromptCustomize: CustomizeWidget | null = useMemo(() => {
    if (!selectedPromptKey) return null;
    const cid = assignments[selectedPromptKey];
    if (typeof cid === "string") {
      return customizes.find((c) => c.id === cid) ?? customizes[0] ?? null;
    }
    return customizes[0] ?? null;
  }, [selectedPromptKey, assignments, customizes]);

  // Selected topic (for run)
  const selectedTopic = useMemo(() => {
    if (!selectedPromptKey) return null;
    return topicByKey.get(selectedPromptKey) ?? null;
  }, [selectedPromptKey, topicByKey]);

  // Clear stale selection if prompt no longer exists in topics
  useEffect(() => {
    if (selectedPromptKey && !topicByKey.has(selectedPromptKey)) {
      setSelectedPromptKey(null);
    }
  }, [selectedPromptKey, topicByKey]);

  // --- Actions ---
  function addPromptToCanvas(t: Topic) {
    const k = topicKey(t);
    setAssignments((prev) => (k in prev ? prev : { ...prev, [k]: [] }));
  }

  function removePromptFromCanvas(key: string) {
    setAssignments((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (selectedPromptKey === key) setSelectedPromptKey(null);
  }

  function assignPrompt(key: string, customizeId: string | null) {
    setAssignments((prev) => {
      const current = prev[key] ?? [];
      if (customizeId == null) {
        // drop into Source bucket → clear assignments
        return { ...prev, [key]: [] };
      }
      if (current.includes(customizeId)) return prev;
      return { ...prev, [key]: [...current, customizeId] };
    });
  }

  function unassignPromptFromCustomize(key: string, customizeId: string) {
    setAssignments((prev) => {
      const current = prev[key] ?? [];
      if (!current.includes(customizeId)) return prev;
      return { ...prev, [key]: current.filter((id) => id !== customizeId) };
    });
  }

  function addCustomize() {
    const newId = makeId();
    setCustomizes((prev) => [
      ...prev,
      {
        id: newId,
        name: `커스터마이즈 ${prev.length + 1}`,
        style: DEFAULT_STYLE,
      },
    ]);
    setSelection({ kind: "customize", id: newId });
  }

  function removeCustomize(id: string) {
    setCustomizes((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((c) => c.id !== id);
    });
    // Unassign any prompts that were on this customize
    setAssignments((prev) => {
      const next: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(prev)) {
        next[k] = v.filter((cid) => cid !== id);
      }
      return next;
    });
    if (selection?.kind === "customize" && selection.id === id) {
      setSelection(null);
    }
  }

  function renameCustomize(id: string, name: string) {
    setCustomizes((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name } : c)),
    );
  }

  function updateCustomizeStyle(id: string, style: StyleConfig) {
    setCustomizes((prev) =>
      prev.map((c) => (c.id === id ? { ...c, style } : c)),
    );
  }

  function patchResult(
    id: string,
    patch: Partial<GenerationResult>,
  ) {
    setResults((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  async function handleRunCustomize(customizeId: string) {
    const customize = customizes.find((c) => c.id === customizeId);
    if (!customize) return;
    const assigned = customizePrompts[customizeId] ?? [];
    if (assigned.length === 0) return;

    const newResults: GenerationResult[] = assigned.map((p) => ({
      id: makeId(),
      customizeId: customize.id,
      customizeName: customize.name,
      promptKey: p.key,
      theme: p.theme,
      prompt: p.prompt,
      direction: "",
      output: "",
      status: "streaming",
      createdAt: Date.now(),
    }));

    setResults((prev) => [...prev, ...newResults]);

    await Promise.all(
      newResults.map(async (result) => {
        const ctrl = new AbortController();
        abortRefs.current[result.id] = ctrl;
        try {
          const res = await fetch("/api/autocontents/generate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              theme: result.theme,
              topic: result.prompt,
              direction: result.direction,
              style: customize.style,
            }),
            signal: ctrl.signal,
          });
          if (!res.ok || !res.body) {
            const msg = await res.text().catch(() => "");
            throw new Error(msg || `HTTP ${res.status}`);
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let acc = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            acc += decoder.decode(value, { stream: true });
            patchResult(result.id, { output: acc });
          }
          patchResult(result.id, { status: "done" });
        } catch (e) {
          patchResult(result.id, {
            status: "error",
            error:
              (e as Error).name === "AbortError"
                ? "중단됨"
                : e instanceof Error
                  ? e.message
                  : "Generation failed",
          });
        } finally {
          delete abortRefs.current[result.id];
        }
      }),
    );
  }

  async function regenerateResult(resultId: string, editPrompt: string) {
    const target = results.find((r) => r.id === resultId);
    if (!target) return;
    const customize = customizes.find((c) => c.id === target.customizeId);
    if (!customize) return;
    const previousOutput = target.output;
    const ctrl = new AbortController();
    abortRefs.current[resultId] = ctrl;
    patchResult(resultId, {
      status: "streaming",
      output: "",
      error: undefined,
      direction: editPrompt,
    });
    try {
      const res = await fetch("/api/autocontents/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          theme: target.theme,
          topic: target.prompt,
          style: customize.style,
          previousOutput,
          editPrompt,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        patchResult(resultId, { output: acc });
      }
      patchResult(resultId, { status: "done" });
    } catch (e) {
      patchResult(resultId, {
        status: "error",
        error:
          (e as Error).name === "AbortError"
            ? "중단됨"
            : e instanceof Error
              ? e.message
              : "Regeneration failed",
      });
    } finally {
      delete abortRefs.current[resultId];
    }
  }

  function clearResults() {
    for (const id of Object.keys(abortRefs.current)) {
      abortRefs.current[id]?.abort();
      delete abortRefs.current[id];
    }
    setResults([]);
    setSelectedResultId(null);
  }

  // ---- Image widget handlers ----
  function importToImage(resultId: string) {
    setImageImports((prev) =>
      prev.includes(resultId) ? prev : [...prev, resultId],
    );
  }
  function removeFromImage(resultId: string) {
    setImageImports((prev) => prev.filter((r) => r !== resultId));
    setImagePlacements((prev) => {
      if (!(resultId in prev)) return prev;
      const next = { ...prev };
      delete next[resultId];
      return next;
    });
    if (imageActiveResultId === resultId) setImageActiveResultId(null);
  }
  function addImagePlacement(resultId: string, afterBlockIndex: number) {
    const id = makeId();
    setImagePlacements((prev) => {
      const next = { ...prev };
      const arr = next[resultId] ? [...next[resultId]] : [];
      arr.push({
        id,
        afterBlockIndex,
        keyword: "",
        source: "unsplash",
        status: "draft",
      });
      next[resultId] = arr;
      return next;
    });
    return id;
  }
  function updateImagePlacement(
    resultId: string,
    placementId: string,
    patch: Partial<ImagePlacement>,
  ) {
    setImagePlacements((prev) => {
      const arr = prev[resultId];
      if (!arr) return prev;
      return {
        ...prev,
        [resultId]: arr.map((p) =>
          p.id === placementId ? { ...p, ...patch } : p,
        ),
      };
    });
  }
  function removeImagePlacement(resultId: string, placementId: string) {
    setImagePlacements((prev) => {
      const arr = prev[resultId];
      if (!arr) return prev;
      return {
        ...prev,
        [resultId]: arr.filter((p) => p.id !== placementId),
      };
    });
  }

  // ---- Deploy widget handlers ----
  function importToDeploy(resultId: string) {
    setDeployImports((prev) =>
      prev.includes(resultId) ? prev : [...prev, resultId],
    );
  }
  function removeFromDeploy(resultId: string) {
    setDeployImports((prev) => prev.filter((r) => r !== resultId));
    setDeploySelections((prev) => {
      if (!(resultId in prev)) return prev;
      const next = { ...prev };
      delete next[resultId];
      return next;
    });
    if (deployActiveResultId === resultId) setDeployActiveResultId(null);
  }
  function addDeployChannel(channel: Omit<DeployChannel, "id">) {
    const id = makeId();
    setDeployChannels((prev) => [...prev, { id, ...channel } as DeployChannel]);
  }
  function updateDeployChannel(
    id: string,
    payload: Omit<DeployChannel, "id">,
  ) {
    setDeployChannels((prev) =>
      prev.map((c) => (c.id === id ? ({ id, ...payload } as DeployChannel) : c)),
    );
  }
  function removeDeployChannel(id: string) {
    setDeployChannels((prev) => prev.filter((c) => c.id !== id));
    setDeploySelections((prev) => {
      const next: Record<string, string[]> = {};
      for (const [rid, ids] of Object.entries(prev)) {
        next[rid] = ids.filter((cid) => cid !== id);
      }
      return next;
    });
  }
  function toggleDeployChannel(resultId: string, channelId: string) {
    setDeploySelections((prev) => {
      const cur = prev[resultId] ?? [];
      const has = cur.includes(channelId);
      return {
        ...prev,
        [resultId]: has
          ? cur.filter((c) => c !== channelId)
          : [...cur, channelId],
      };
    });
  }
  async function publishDeploy(
    resultId: string,
    status: "draft" | "publish",
    explicitChannelIds?: string[],
  ) {
    const target = results.find((r) => r.id === resultId);
    if (!target) return;
    const channelIds = explicitChannelIds ?? deploySelections[resultId] ?? [];
    const selectedChannels = deployChannels.filter((c) =>
      channelIds.includes(c.id),
    );
    if (selectedChannels.length === 0) return;

    const title = target.prompt;
    const placementsForResult = imagePlacements[resultId] ?? [];
    const content = renderContentWithImagePlacements(
      target.output,
      placementsForResult,
    );
    const newJobs: DeployJob[] = selectedChannels.map((c) => ({
      id: makeId(),
      resultId,
      channelId: c.id,
      channelName: c.name,
      channelKind: c.kind,
      status: "publishing",
      createdAt: Date.now(),
    }));
    setDeployJobs((prev) => [...prev, ...newJobs]);
    setPublishingChannelIds(
      (prev) => new Set([...prev, ...selectedChannels.map((c) => c.id)]),
    );

    await Promise.all(
      selectedChannels.map(async (channel, i) => {
        const job = newJobs[i];
        try {
          let publishedUrl: string | undefined;

          if (channel.kind === "wordpress") {
            const res = await fetch("/api/autocontents/deploy/wordpress", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                url: channel.config.url,
                username: channel.config.username,
                appPassword: channel.config.appPassword,
                title,
                content,
                status,
              }),
            });
            const data = (await res.json()) as {
              postId?: number;
              url?: string;
              error?: string;
            };
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
            publishedUrl = data.url;
          } else if (channel.kind === "notion") {
            const res = await fetch("/api/autocontents/deploy/notion", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                integrationToken: channel.config.integrationToken,
                parentPageId: channel.config.parentPageId,
                title,
                content,
              }),
            });
            const data = (await res.json()) as {
              pageId?: string;
              url?: string;
              error?: string;
            };
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
            publishedUrl = data.url;
          } else if (channel.kind === "pdf") {
            exportToPdf(title, content);
            // "published" once the print window opens (user-driven save step)
            publishedUrl = undefined;
          }

          setDeployJobs((prev) =>
            prev.map((j) =>
              j.id === job.id
                ? { ...j, status: "published", publishedUrl }
                : j,
            ),
          );
        } catch (e) {
          setDeployJobs((prev) =>
            prev.map((j) =>
              j.id === job.id
                ? {
                    ...j,
                    status: "failed",
                    error: e instanceof Error ? e.message : "게시 실패",
                  }
                : j,
            ),
          );
        } finally {
          setPublishingChannelIds((prev) => {
            const next = new Set(prev);
            next.delete(channel.id);
            return next;
          });
        }
      }),
    );
  }

  function publishSingleChannel(
    resultId: string,
    channelId: string,
    status: "draft" | "publish",
  ) {
    return publishDeploy(resultId, status, [channelId]);
  }

  function setQuickExporting(
    resultId: string,
    kind: "pdf" | "docx",
    busy: boolean,
  ) {
    setQuickExportingByResult((prev) => {
      const cur = new Set(prev[resultId] ?? []);
      if (busy) cur.add(kind);
      else cur.delete(kind);
      const next = { ...prev };
      if (cur.size === 0) delete next[resultId];
      else next[resultId] = cur;
      return next;
    });
  }

  async function quickExport(resultId: string, kind: "pdf" | "docx") {
    const target = results.find((r) => r.id === resultId);
    if (!target) return;
    const title = target.prompt;
    const placementsForResult = imagePlacements[resultId] ?? [];
    const content = renderContentWithImagePlacements(
      target.output,
      placementsForResult,
    );
    const job: DeployJob = {
      id: makeId(),
      resultId,
      channelId: `virtual-${kind}`,
      channelName: kind === "pdf" ? "PDF 추출" : "DOCX 추출",
      channelKind: kind,
      status: "publishing",
      createdAt: Date.now(),
    };
    setDeployJobs((prev) => [...prev, job]);
    setQuickExporting(resultId, kind, true);
    try {
      if (kind === "pdf") {
        exportToPdf(title, content);
      } else {
        const stamp = new Date()
          .toISOString()
          .replace(/[-:T]/g, "")
          .slice(0, 14);
        const filename = `${slugForFilename(target.customizeName)}_${slugForFilename(target.theme || "doc")}_${stamp}.docx`;
        await exportToDocx(filename, title, content);
      }
      setDeployJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, status: "published" } : j)),
      );
    } catch (e) {
      setDeployJobs((prev) =>
        prev.map((j) =>
          j.id === job.id
            ? {
                ...j,
                status: "failed",
                error: e instanceof Error ? e.message : "추출 실패",
              }
            : j,
        ),
      );
    } finally {
      setQuickExporting(resultId, kind, false);
    }
  }

  const hasAnySource = activeSourceCount(sources) > 0;
  const sourceStatus: NodeStatus = urlError
    ? "error"
    : !hasAnySource
      ? "empty"
      : loadingUrl
        ? "running"
        : "ready";

  const sourceBadge = hasAnySource ? sourcesLabel(sources) : "소스 없음";
  const sourceDetail = hasAnySource
    ? `${topics.length}개 토픽 · 캔버스 ${bucketPrompts.length}개`
    : "URL / 파일 / 직접입력 중 1개 이상 설정";

  const assignedCount = customizes.reduce(
    (n, c) => n + (customizePrompts[c.id]?.length ?? 0),
    0,
  );

  const customizePromptCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of customizes) {
      m[c.id] = customizePrompts[c.id]?.length ?? 0;
    }
    return m;
  }, [customizes, customizePrompts]);

  const runningCustomizeIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of results) {
      if (r.status === "streaming") s.add(r.customizeId);
    }
    return s;
  }, [results]);

  const running = runningCustomizeIds.size > 0;

  const resultGroups: ResultGroup[] = useMemo(() => {
    const byId = new Map<string, GenerationResult[]>();
    for (const c of customizes) byId.set(c.id, []);
    for (const r of results) {
      if (!byId.has(r.customizeId)) byId.set(r.customizeId, []);
      byId.get(r.customizeId)!.push(r);
    }
    const order: { id: string; name: string }[] = customizes.map((c) => ({
      id: c.id,
      name: c.name,
    }));
    for (const r of results) {
      if (!customizes.some((c) => c.id === r.customizeId)) {
        if (!order.some((o) => o.id === r.customizeId)) {
          order.push({ id: r.customizeId, name: r.customizeName });
        }
      }
    }
    return order
      .map(({ id, name }) => ({
        customizeId: id,
        customizeName:
          customizes.find((c) => c.id === id)?.name ?? name,
        results: (byId.get(id) ?? []).map((r) => ({
          id: r.id,
          promptKey: r.promptKey,
          theme: r.theme,
          prompt: r.prompt,
          status: r.status,
        })),
      }))
      .filter((g) => g.results.length > 0);
  }, [customizes, results]);

  const anyStreaming = results.some((r) => r.status === "streaming");
  const anyError = results.some((r) => r.status === "error");
  const outputStatus: NodeStatus = anyStreaming
    ? "running"
    : results.length === 0
      ? "empty"
      : anyError
        ? "error"
        : "ready";

  const outputBadge =
    results.length === 0
      ? "결과 없음"
      : `${results.length}개 결과 · ${resultGroups.length}개 그룹`;
  const outputDetail =
    results.length === 0
      ? "▶ 제작을 누르면 여기 쌓입니다"
      : anyStreaming
        ? "생성 중…"
        : "chip 클릭 → 인스펙터에서 미리보기";

  const selectedResult = useMemo(
    () => results.find((r) => r.id === selectedResultId) ?? null,
    [results, selectedResultId],
  );

  const resultById = useMemo(() => {
    const m = new Map<string, GenerationResult>();
    for (const r of results) m.set(r.id, r);
    return m;
  }, [results]);

  const imageItems: ImportedResultItem[] = useMemo(() => {
    return imageImports
      .map((id) => resultById.get(id))
      .filter((r): r is GenerationResult => !!r)
      .map((r) => {
        const count = imagePlacements[r.id]?.length ?? 0;
        return {
          resultId: r.id,
          customizeName: r.customizeName,
          prompt: r.prompt,
          status: r.status,
          meta: count > 0 ? `🖼️ ${count}` : undefined,
        };
      });
  }, [imageImports, resultById, imagePlacements]);

  const deployItems: ImportedResultItem[] = useMemo(() => {
    return deployImports
      .map((id) => resultById.get(id))
      .filter((r): r is GenerationResult => !!r)
      .map((r) => {
        const selCount = (deploySelections[r.id] ?? []).length;
        const pubCount = deployJobs.filter(
          (j) => j.resultId === r.id && j.status === "published",
        ).length;
        const meta =
          pubCount > 0
            ? `📤 ${pubCount}`
            : selCount > 0
              ? `${selCount}ch`
              : undefined;
        return {
          resultId: r.id,
          customizeName: r.customizeName,
          prompt: r.prompt,
          status: r.status,
          meta,
        };
      });
  }, [deployImports, resultById, deploySelections, deployJobs]);

  const imageActiveResult = imageActiveResultId
    ? resultById.get(imageActiveResultId) ?? null
    : null;
  const deployActiveResult = deployActiveResultId
    ? resultById.get(deployActiveResultId) ?? null
    : null;

  const completedCount = results.filter(
    (r) => r.status !== "streaming",
  ).length;
  const progress = { completed: completedCount, total: results.length };

  return (
    <div className="min-h-screen w-full bg-paper-soft text-ink ">
      <header className="border-b border-line ">
        <div className="mx-auto max-w-[1400px] px-6 py-4">
          <h1 className="text-xl font-semibold tracking-tight">
            컨텐츠 자동 생성기
          </h1>
          <p className="mt-0.5 text-sm text-mute">
            소스에서 프롬프트를 골라 캔버스로 옮기고, 원하는 커스터마이즈
            위젯으로 드래그하세요
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-6">
        <section className="min-w-0">
          <Canvas
            sourceBadge={sourceBadge}
            sourceDetail={sourceDetail}
            sourceStatus={sourceStatus}
            bucketPrompts={bucketPrompts}
            customizes={customizes.map((c) => ({ id: c.id, name: c.name }))}
            customizePrompts={customizePrompts}
            outputBadge={outputBadge}
            outputDetail={outputDetail}
            outputStatus={outputStatus}
            resultGroups={resultGroups}
            selectedResultId={selectedResultId}
            onSelectResult={setSelectedResultId}
            progress={progress}
            selection={selection}
            onSelectNode={setSelection}
            selectedPromptKey={selectedPromptKey}
            onSelectPrompt={setSelectedPromptKey}
            onRemovePrompt={removePromptFromCanvas}
            onUnassignPrompt={unassignPromptFromCustomize}
            onAssignPrompt={assignPrompt}
            onAddCustomize={addCustomize}
            onRemoveCustomize={removeCustomize}
            onRenameCustomize={renameCustomize}
            onRunCustomize={handleRunCustomize}
            runningCustomizeIds={runningCustomizeIds}
            customizePromptCounts={customizePromptCounts}
            hasAnySource={hasAnySource}
            imageItems={imageItems}
            onImportToImage={importToImage}
            onRemoveFromImage={removeFromImage}
            onSelectImageItem={setImageActiveResultId}
            imageActiveResultId={imageActiveResultId}
            deployItems={deployItems}
            onImportToDeploy={importToDeploy}
            onRemoveFromDeploy={removeFromDeploy}
            onSelectDeployItem={setDeployActiveResultId}
            deployActiveResultId={deployActiveResultId}
          />
        </section>

        {selection && (
          <Inspector
            selection={selection}
            onClose={() => setSelection(null)}
              sources={sources}
              onApplyUrl={(s) =>
                setSources((prev) => ({ ...prev, url: s }))
              }
              onApplyFile={(s) =>
                setSources((prev) => ({ ...prev, file: s }))
              }
              onApplyManual={(s) =>
                setSources((prev) => ({ ...prev, manual: s }))
              }
              onClearUrl={() =>
                setSources((prev) => {
                  const { url: _url, ...rest } = prev;
                  return rest;
                })
              }
              onClearFile={() =>
                setSources((prev) => {
                  const { file: _file, ...rest } = prev;
                  return rest;
                })
              }
              onClearManual={() =>
                setSources((prev) => {
                  const { manual: _manual, ...rest } = prev;
                  return rest;
                })
              }
              topics={topics}
              grouped={grouped}
              loadingTopics={loadingUrl}
              topicsError={urlError}
              onAddPromptToCanvas={addPromptToCanvas}
              canvasPromptKeys={new Set(Object.keys(assignments))}
              customizes={customizes}
              onRenameCustomize={renameCustomize}
              onRemoveCustomize={removeCustomize}
              onChangeCustomizeStyle={updateCustomizeStyle}
              selectedResult={selectedResult}
              onClearSelectedResult={() => setSelectedResultId(null)}
              onClearAllResults={clearResults}
              onRegenerate={regenerateResult}
              running={running}
              streamingCount={
                results.filter((r) => r.status === "streaming").length
              }
              totalResults={results.length}
              imageActiveResult={imageActiveResult}
              imagePlacementsForActive={
                imageActiveResultId
                  ? imagePlacements[imageActiveResultId] ?? []
                  : []
              }
              onCloseImageSelection={() => setImageActiveResultId(null)}
              onAddImagePlacement={(idx) =>
                imageActiveResultId
                  ? addImagePlacement(imageActiveResultId, idx)
                  : ""
              }
              onUpdateImagePlacement={(id, patch) => {
                if (imageActiveResultId)
                  updateImagePlacement(imageActiveResultId, id, patch);
              }}
              onRemoveImagePlacement={(id) => {
                if (imageActiveResultId)
                  removeImagePlacement(imageActiveResultId, id);
              }}
              deployActiveResult={deployActiveResult}
              deployChannels={deployChannels}
              deployJobsForActive={
                deployActiveResultId
                  ? deployJobs.filter(
                      (j) => j.resultId === deployActiveResultId,
                    )
                  : []
              }
              publishingChannelIds={publishingChannelIds}
              quickExportingForActive={
                deployActiveResultId
                  ? quickExportingByResult[deployActiveResultId] ?? new Set()
                  : new Set()
              }
              onAddDeployChannel={addDeployChannel}
              onUpdateDeployChannel={updateDeployChannel}
              onRemoveDeployChannel={removeDeployChannel}
              onPublishDeployChannel={(channelId, status) => {
                if (deployActiveResultId)
                  void publishSingleChannel(
                    deployActiveResultId,
                    channelId,
                    status,
                  );
              }}
              onQuickExportDeploy={(kind) => {
                if (deployActiveResultId)
                  void quickExport(deployActiveResultId, kind);
              }}
            onCloseDeploySelection={() => setDeployActiveResultId(null)}
          />
        )}
      </main>
    </div>
  );
}

function Inspector(props: {
  selection: NonNullable<NodeSelection>;
  onClose: () => void;
  sources: Sources;
  onApplyUrl: (s: UrlSource) => void;
  onApplyFile: (s: FileSource) => void;
  onApplyManual: (s: ManualSource) => void;
  onClearUrl: () => void;
  onClearFile: () => void;
  onClearManual: () => void;
  topics: Topic[];
  grouped: [string, Topic[]][];
  loadingTopics: boolean;
  topicsError: string | null;
  onAddPromptToCanvas: (t: Topic) => void;
  canvasPromptKeys: Set<string>;
  customizes: CustomizeWidget[];
  onRenameCustomize: (id: string, name: string) => void;
  onRemoveCustomize: (id: string) => void;
  onChangeCustomizeStyle: (id: string, s: StyleConfig) => void;
  selectedResult: GenerationResult | null;
  onClearSelectedResult: () => void;
  onClearAllResults: () => void;
  onRegenerate: (resultId: string, editPrompt: string) => void;
  running: boolean;
  streamingCount: number;
  totalResults: number;
  imageActiveResult: GenerationResult | null;
  imagePlacementsForActive: ImagePlacement[];
  onCloseImageSelection: () => void;
  onAddImagePlacement: (afterBlockIndex: number) => string;
  onUpdateImagePlacement: (id: string, patch: Partial<ImagePlacement>) => void;
  onRemoveImagePlacement: (id: string) => void;
  deployActiveResult: GenerationResult | null;
  deployChannels: DeployChannel[];
  deployJobsForActive: DeployJob[];
  publishingChannelIds: Set<string>;
  quickExportingForActive: Set<"pdf" | "docx">;
  onAddDeployChannel: (channel: Omit<DeployChannel, "id">) => void;
  onUpdateDeployChannel: (id: string, payload: Omit<DeployChannel, "id">) => void;
  onRemoveDeployChannel: (id: string) => void;
  onPublishDeployChannel: (channelId: string, status: "draft" | "publish") => void;
  onQuickExportDeploy: (kind: "pdf" | "docx") => void;
  onCloseDeploySelection: () => void;
}) {
  const {
    selection,
    onClose,
    sources,
    onApplyUrl,
    onApplyFile,
    onApplyManual,
    onClearUrl,
    onClearFile,
    onClearManual,
    topics,
    grouped,
    loadingTopics,
    topicsError,
    onAddPromptToCanvas,
    canvasPromptKeys,
    customizes,
    onRenameCustomize,
    onRemoveCustomize,
    onChangeCustomizeStyle,
    selectedResult,
    onClearSelectedResult,
    onClearAllResults,
    onRegenerate,
    running,
    streamingCount,
    totalResults,
    imageActiveResult,
    imagePlacementsForActive,
    onCloseImageSelection,
    onAddImagePlacement,
    onUpdateImagePlacement,
    onRemoveImagePlacement,
    deployActiveResult,
    deployChannels,
    deployJobsForActive,
    publishingChannelIds,
    quickExportingForActive,
    onAddDeployChannel,
    onUpdateDeployChannel,
    onRemoveDeployChannel,
    onPublishDeployChannel,
    onQuickExportDeploy,
    onCloseDeploySelection,
  } = props;

  const meta =
    selection.kind === "source"
      ? { icon: "📥", title: "컨텐츠 소스" }
      : selection.kind === "output"
        ? { icon: "📤", title: "아웃풋" }
        : selection.kind === "image"
          ? { icon: "🖼️", title: "이미지 추가" }
          : selection.kind === "deploy"
            ? { icon: "🚀", title: "배포" }
            : { icon: "🎨", title: "커스터마이즈" };

  const activeCustomize =
    selection.kind === "customize"
      ? customizes.find((c) => c.id === selection.id) ?? null
      : null;

  const title = (
    <div className="flex items-center gap-2">
      <span className="text-2xl leading-none">{meta.icon}</span>
      <span>
        {selection.kind === "customize" && activeCustomize
          ? activeCustomize.name
          : meta.title}
      </span>
      <span className="rounded-full bg-paper-soft px-1.5 py-0.5 text-xs font-medium text-mute">
        Inspector
      </span>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      <div>
        {selection.kind === "source" && (
          <SourceInspector
            sources={sources}
            onApplyUrl={onApplyUrl}
            onApplyFile={onApplyFile}
            onApplyManual={onApplyManual}
            onClearUrl={onClearUrl}
            onClearFile={onClearFile}
            onClearManual={onClearManual}
            topics={topics}
            grouped={grouped}
            loadingTopics={loadingTopics}
            topicsError={topicsError}
            canvasPromptKeys={canvasPromptKeys}
            onAddPromptToCanvas={onAddPromptToCanvas}
          />
        )}

        {selection.kind === "customize" && activeCustomize && (
          <CustomizeInspector
            customize={activeCustomize}
            canDelete={customizes.length > 1}
            onRename={(n) => onRenameCustomize(activeCustomize.id, n)}
            onRemove={() => onRemoveCustomize(activeCustomize.id)}
            onChangeStyle={(s) =>
              onChangeCustomizeStyle(activeCustomize.id, s)
            }
          />
        )}

        {selection.kind === "output" && (
          <OutputInspector
            selectedResult={selectedResult}
            onClearSelectedResult={onClearSelectedResult}
            onClearAllResults={onClearAllResults}
            onRegenerate={onRegenerate}
            running={running}
            streamingCount={streamingCount}
            totalResults={totalResults}
          />
        )}

        {selection.kind === "image" && (
          <ImageInspector
            result={
              imageActiveResult
                ? {
                    id: imageActiveResult.id,
                    customizeName: imageActiveResult.customizeName,
                    theme: imageActiveResult.theme,
                    prompt: imageActiveResult.prompt,
                    output: imageActiveResult.output,
                  }
                : null
            }
            placements={imagePlacementsForActive}
            onAddPlacement={onAddImagePlacement}
            onUpdatePlacement={onUpdateImagePlacement}
            onRemovePlacement={onRemoveImagePlacement}
            onCloseSelection={onCloseImageSelection}
          />
        )}

        {selection.kind === "deploy" && (
          <DeployInspector
            result={
              deployActiveResult
                ? {
                    id: deployActiveResult.id,
                    customizeName: deployActiveResult.customizeName,
                    theme: deployActiveResult.theme,
                    prompt: deployActiveResult.prompt,
                    output: deployActiveResult.output,
                  }
                : null
            }
            channels={deployChannels}
            onAddChannel={onAddDeployChannel}
            onUpdateChannel={onUpdateDeployChannel}
            onRemoveChannel={onRemoveDeployChannel}
            onPublishChannel={onPublishDeployChannel}
            onQuickExport={onQuickExportDeploy}
            publishingChannelIds={publishingChannelIds}
            quickExporting={quickExportingForActive}
            jobs={deployJobsForActive}
            onCloseSelection={onCloseDeploySelection}
          />
        )}
      </div>
    </Modal>
  );
}

function SourceInspector({
  sources,
  onApplyUrl,
  onApplyFile,
  onApplyManual,
  onClearUrl,
  onClearFile,
  onClearManual,
  topics,
  grouped,
  loadingTopics,
  topicsError,
  canvasPromptKeys,
  onAddPromptToCanvas,
}: {
  sources: Sources;
  onApplyUrl: (s: UrlSource) => void;
  onApplyFile: (s: FileSource) => void;
  onApplyManual: (s: ManualSource) => void;
  onClearUrl: () => void;
  onClearFile: () => void;
  onClearManual: () => void;
  topics: Topic[];
  grouped: [string, Topic[]][];
  loadingTopics: boolean;
  topicsError: string | null;
  canvasPromptKeys: Set<string>;
  onAddPromptToCanvas: (t: Topic) => void;
}) {
  return (
    <div className="space-y-4 p-3">
      <SourcePicker
        sources={sources}
        onApplyUrl={onApplyUrl}
        onApplyFile={onApplyFile}
        onApplyManual={onApplyManual}
        onClearUrl={onClearUrl}
        onClearFile={onClearFile}
        onClearManual={onClearManual}
      />

      <div className="rounded-sm border border-line ">
        <div className="flex items-center justify-between border-b border-line px-3 py-2 ">
          <div className="text-sm font-semibold uppercase tracking-wider text-mute">
            토픽 ({topics.length})
          </div>
          <div className="text-xs text-mute">
            클릭 → 캔버스로 추가
          </div>
        </div>
        <div className="max-h-[40vh] overflow-y-auto">
          {loadingTopics ? (
            <div className="px-3 py-3 text-xs text-mute">불러오는 중…</div>
          ) : topicsError ? (
            <div className="px-3 py-2 text-xs text-warning">
              {topicsError}
            </div>
          ) : topics.length === 0 ? (
            <div className="px-3 py-3 text-xs text-mute">
              위에서 소스를 추가하면 여기에 토픽이 표시됩니다.
            </div>
          ) : (
            grouped.map(([theme, items]) => (
              <div key={theme}>
                <div className="sticky top-0 bg-paper-soft px-3 py-1 text-xs font-semibold uppercase tracking-wider text-mute ">
                  {theme}
                </div>
                <ul>
                  {items.map((t) => {
                    const on = canvasPromptKeys.has(topicKey(t));
                    return (
                      <li key={t.id}>
                        <Button
                          onClick={() => onAddPromptToCanvas(t)}
                          disabled={on}
                          variant="link"
                          size="xs"
                          fullWidth
                          className="!justify-start !px-3 !py-1.5 text-left hover:!bg-paper-soft"
                        >
                          <span className="flex w-full items-center gap-2">
                            <span
                              className={
                                "shrink-0 text-xs " +
                                (on ? "text-success" : "text-mute-soft")
                              }
                            >
                              {on ? "●" : "○"}
                            </span>
                            <span className="flex-1 truncate">{t.prompt}</span>
                          </span>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function CustomizeInspector({
  customize,
  canDelete,
  onRename,
  onRemove,
  onChangeStyle,
}: {
  customize: CustomizeWidget;
  canDelete: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
  onChangeStyle: (s: StyleConfig) => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="space-y-3 border-b border-line px-4 py-3 ">
        <div>
          <div className="mb-1 text-sm font-semibold uppercase tracking-wider text-mute">
            위젯 이름
          </div>
          <Input
            type="text"
            size="sm"
            value={customize.name}
            onChange={(e) => onRename(e.target.value)}
            placeholder="이 커스터마이즈의 이름"
          />
        </div>
        {canDelete && (
          <Button
            onClick={() => {
              if (confirm(`"${customize.name}" 위젯을 삭제할까요?`)) onRemove();
            }}
            variant="destructive-link"
            size="xs"
          >
            이 커스터마이즈 위젯 삭제
          </Button>
        )}
      </div>

      <StylePanel value={customize.style} onChange={onChangeStyle} embedded />
    </div>
  );
}

function OutputInspector({
  selectedResult,
  onClearSelectedResult,
  onClearAllResults,
  onRegenerate,
  running,
  streamingCount,
  totalResults,
}: {
  selectedResult: GenerationResult | null;
  onClearSelectedResult: () => void;
  onClearAllResults: () => void;
  onRegenerate: (resultId: string, editPrompt: string) => void;
  running: boolean;
  streamingCount: number;
  totalResults: number;
}) {
  if (selectedResult) {
    return (
      <ResultPreview
        result={selectedResult}
        onClose={onClearSelectedResult}
        onRegenerate={(editPrompt) =>
          onRegenerate(selectedResult.id, editPrompt)
        }
      />
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="text-sm font-semibold uppercase tracking-wider text-mute">
        결과 미리보기
      </div>
      <div className="rounded-xs border border-dashed border-line px-3 py-4 text-xs text-mute ">
        아웃풋 위젯의 chip을 클릭하면 여기에 미리보기가 나옵니다.
      </div>
      <div className="flex items-center justify-between text-sm text-mute">
        <span>
          총 {totalResults}개 · 진행 중 {streamingCount}개
        </span>
        {totalResults > 0 && !running && (
          <Button
            onClick={() => {
              if (confirm("모든 생성 결과를 삭제할까요?")) onClearAllResults();
            }}
            variant="destructive-link"
            size="xs"
          >
            전체 삭제
          </Button>
        )}
      </div>
    </div>
  );
}

function ResultPreview({
  result,
  onClose,
  onRegenerate,
}: {
  result: GenerationResult;
  onClose: () => void;
  onRegenerate: (editPrompt: string) => void;
}) {
  const [editPrompt, setEditPrompt] = useState("");
  const statusBadge =
    result.status === "streaming" ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-amore-bg px-2 py-0.5 text-xs font-medium text-amore ">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
        생성 중
      </span>
    ) : result.status === "error" ? (
      <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning ">
        에러
      </span>
    ) : (
      <span className="rounded-full bg-mint px-2 py-0.5 text-xs font-medium text-success ">
        완료
      </span>
    );

  return (
    <div className="border-b border-line ">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 ">
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded-xs bg-paper-soft px-1.5 py-0.5 font-medium text-ink-2 ">
            🎨 {result.customizeName}
          </span>
          {statusBadge}
        </div>
        <div className="flex items-center gap-1">
          {result.output && (
            <ChromeButton
              onClick={() => navigator.clipboard.writeText(result.output)}
              size="xs"
              variant="mute"
            >
              복사
            </ChromeButton>
          )}
          <ChromeButton onClick={onClose} size="xs" variant="mute">
            닫기
          </ChromeButton>
        </div>
      </div>

      <div className="space-y-2 px-4 py-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-mute">
            {result.theme}
          </div>
          <div className="text-sm font-medium">{result.prompt}</div>
        </div>
        {result.direction && (
          <div className="rounded-xs bg-paper-soft px-2 py-1 text-sm text-mute ">
            최근 수정 지시: {result.direction}
          </div>
        )}
      </div>

      <div className="max-h-[40vh] overflow-y-auto border-t border-line bg-paper-soft/40 px-4 py-3 ">
        {result.error ? (
          <div className="rounded-xs border border-warning-line bg-warning-bg px-3 py-2 text-sm text-warning ">
            {result.error}
          </div>
        ) : result.output ? (
          <Markdown>{result.output}</Markdown>
        ) : (
          <div className="text-sm text-mute-soft">
            {result.status === "streaming" ? "생성 중…" : "출력이 없습니다."}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-line px-4 py-3 ">
        <Textarea
          id={`edit-${result.id}`}
          label="수정 프롬프트"
          value={editPrompt}
          onChange={(e) => setEditPrompt(e.target.value)}
          disabled={result.status === "streaming"}
          placeholder="예) 좀 더 짧게 요약 / 실제 사례 1개 추가 / 마지막에 CTA 한 줄"
          rows={3}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-mute">
            현재 출력 + 지시를 LLM에 보내 같은 스타일로 다시 작성
          </span>
          <Button
            onClick={() => {
              const trimmed = editPrompt.trim();
              if (!trimmed) return;
              onRegenerate(trimmed);
              setEditPrompt("");
            }}
            disabled={
              result.status === "streaming" || editPrompt.trim().length === 0
            }
            size="xs"
            variant="primary"
          >
            <span className="text-xs">⟳</span>
            재생성
          </Button>
        </div>
      </div>
    </div>
  );
}
