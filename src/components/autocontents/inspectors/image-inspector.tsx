"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChromeButton } from "@/components/ui/chrome-button";
import { ChromeInput } from "@/components/ui/chrome-input";
import { IconButton } from "@/components/ui/icon-button";
import { Markdown } from "../markdown";

export type ImagePlacement = {
  id: string;
  afterBlockIndex: number;
  keyword: string;
  source: "unsplash" | "llm";
  status: "draft" | "generating" | "ready" | "error";
  imageUrl?: string;
  credit?: string | null;
  creditUrl?: string | null;
  error?: string;
};

export type ImageInspectorResult = {
  id: string;
  customizeName: string;
  theme: string;
  prompt: string;
  output: string;
};

type Props = {
  result: ImageInspectorResult | null;
  placements: ImagePlacement[];
  onAddPlacement: (afterBlockIndex: number) => string;
  onUpdatePlacement: (id: string, patch: Partial<ImagePlacement>) => void;
  onRemovePlacement: (id: string) => void;
  onCloseSelection: () => void;
};

function splitBlocks(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.split(/\n\s*\n/);
}

export default function ImageInspector({
  result,
  placements,
  onAddPlacement,
  onUpdatePlacement,
  onRemovePlacement,
  onCloseSelection,
}: Props) {
  const blocks = useMemo(
    () => (result ? splitBlocks(result.output) : []),
    [result],
  );

  const placementsByBlock = useMemo(() => {
    const m: Record<number, ImagePlacement[]> = {};
    for (const p of placements) {
      if (!m[p.afterBlockIndex]) m[p.afterBlockIndex] = [];
      m[p.afterBlockIndex].push(p);
    }
    return m;
  }, [placements]);

  if (!result) {
    return (
      <div className="space-y-3 p-4">
        <div className="text-sm font-semibold uppercase tracking-wider text-mute">
          이미지 추가
        </div>
        <div className="rounded-xs border border-dashed border-line px-3 py-4 text-xs text-mute ">
          위젯의 컨텐츠 chip을 클릭하면 여기에 본문이 표시됩니다. 본문 단락
          사이를 클릭하면 그 자리에 이미지를 추가할 수 있습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 ">
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded-xs bg-paper-soft px-1.5 py-0.5 font-medium text-ink-2 ">
            🎨 {result.customizeName}
          </span>
          <span className="text-mute">{result.theme}</span>
        </div>
        <ChromeButton onClick={onCloseSelection} size="xs" variant="mute">
          닫기
        </ChromeButton>
      </div>

      <div className="border-b border-line px-4 py-3 ">
        <div className="text-xs uppercase tracking-wider text-mute">
          {result.theme}
        </div>
        <div className="text-sm font-medium">{result.prompt}</div>
        <div className="mt-1 text-xs text-mute">
          단락 사이의 <span className="text-success">＋ 라인</span>을 클릭해
          이미지를 그 자리에 끼워 넣으세요.
        </div>
      </div>

      <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
        <ContentWithGutters
          blocks={blocks}
          placementsByBlock={placementsByBlock}
          onAddPlacement={onAddPlacement}
          onUpdatePlacement={onUpdatePlacement}
          onRemovePlacement={onRemovePlacement}
        />
      </div>
    </div>
  );
}

function ContentWithGutters({
  blocks,
  placementsByBlock,
  onAddPlacement,
  onUpdatePlacement,
  onRemovePlacement,
}: {
  blocks: string[];
  placementsByBlock: Record<number, ImagePlacement[]>;
  onAddPlacement: (afterBlockIndex: number) => string;
  onUpdatePlacement: (id: string, patch: Partial<ImagePlacement>) => void;
  onRemovePlacement: (id: string) => void;
}) {
  if (blocks.length === 0) {
    return <div className="text-xs text-mute">본문이 비어 있습니다.</div>;
  }

  return (
    <div className="space-y-0">
      <Gutter afterBlockIndex={-1} onAdd={onAddPlacement} />
      {blocks.map((block, i) => (
        <div key={i}>
          <div className="prose prose-sm max-w-none break-words">
            <Markdown>{block}</Markdown>
          </div>
          {(placementsByBlock[i] ?? []).map((p) => (
            <PlacementCard
              key={p.id}
              placement={p}
              onUpdate={(patch) => onUpdatePlacement(p.id, patch)}
              onRemove={() => onRemovePlacement(p.id)}
            />
          ))}
          <Gutter afterBlockIndex={i} onAdd={onAddPlacement} />
        </div>
      ))}
    </div>
  );
}

function Gutter({
  afterBlockIndex,
  onAdd,
}: {
  afterBlockIndex: number;
  onAdd: (afterBlockIndex: number) => string;
}) {
  return (
    <Button
      onClick={() => onAdd(afterBlockIndex)}
      variant="link"
      className="group relative my-1 flex h-6 w-full cursor-copy items-center justify-center !p-0"
      title="여기에 이미지 추가"
    >
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-transparent transition-colors group-hover:bg-success" />
      <span className="relative z-table-cell-sticky inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0 text-xs text-mute opacity-0 transition-opacity group-hover:opacity-100 ">
        <span className="text-success">＋</span>
        이미지
      </span>
    </Button>
  );
}

function PlacementCard({
  placement,
  onUpdate,
  onRemove,
}: {
  placement: ImagePlacement;
  onUpdate: (patch: Partial<ImagePlacement>) => void;
  onRemove: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function generate() {
    const kw = placement.keyword.trim();
    if (!kw) {
      onUpdate({ status: "error", error: "키워드를 입력하세요." });
      return;
    }
    setBusy(true);
    onUpdate({ status: "generating", error: undefined });
    try {
      const res = await fetch("/api/autocontents/image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyword: kw, source: placement.source }),
      });
      const data = (await res.json()) as {
        imageUrl?: string;
        credit?: string | null;
        creditUrl?: string | null;
        error?: string;
      };
      if (!res.ok || !data.imageUrl) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      onUpdate({
        status: "ready",
        imageUrl: data.imageUrl,
        credit: data.credit ?? null,
        creditUrl: data.creditUrl ?? null,
        error: undefined,
      });
    } catch (e) {
      onUpdate({
        status: "error",
        error: e instanceof Error ? e.message : "이미지 생성 실패",
      });
    } finally {
      setBusy(false);
    }
  }

  if (placement.status === "ready" && placement.imageUrl) {
    return (
      <figure className="my-3 overflow-hidden rounded-xs border border-line ">
        {/* eslint-disable-next-line @next/next/no-img-element -- external image URL, lazy host whitelist not yet defined for autocontents */}
        <img
          src={placement.imageUrl}
          alt={placement.keyword}
          className="block h-auto w-full"
        />
        <figcaption className="flex items-center justify-between gap-2 border-t border-line bg-paper-soft px-3 py-1.5 text-xs text-mute ">
          <span className="truncate">
            {placement.source === "unsplash" ? "📷 Unsplash" : "🪄 LLM"} ·{" "}
            {placement.keyword}
            {placement.credit && (
              <>
                {" · "}
                {placement.creditUrl ? (
                  <a
                    href={placement.creditUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {placement.credit}
                  </a>
                ) : (
                  placement.credit
                )}
              </>
            )}
          </span>
          <div className="flex items-center gap-1">
            <ChromeButton
              onClick={() => onUpdate({ status: "draft", imageUrl: undefined })}
              size="xs"
              variant="mute"
            >
              재생성
            </ChromeButton>
            <ChromeButton
              onClick={onRemove}
              size="xs"
              variant="mute"
              className="text-warning"
            >
              삭제
            </ChromeButton>
          </div>
        </figcaption>
      </figure>
    );
  }

  return (
    <div className="my-3 rounded-xs border border-success bg-mint/40 p-2 ">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold text-success ">
          이미지 추가 #{placement.id.slice(0, 4)}
        </span>
        <IconButton
          aria-label="제거"
          onClick={onRemove}
          variant="ghost-danger"
          size="compact"
          title="제거"
        >
          ×
        </IconButton>
      </div>
      <ChromeInput
        autoFocus
        type="text"
        size="sm"
        value={placement.keyword}
        onChange={(e) => onUpdate({ keyword: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void generate();
          }
        }}
        placeholder="이미지 키워드 (예: morning routine, seoul skyline)"
        className="mb-1.5 w-full"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 rounded-xs border border-line p-0.5 text-xs ">
          {(["unsplash", "llm"] as const).map((s) => {
            const active = placement.source === s;
            return (
              <ChromeButton
                key={s}
                onClick={() => onUpdate({ source: s })}
                size="xs"
                variant={active ? "primary" : "mute"}
              >
                {s === "unsplash" ? "📷 Unsplash" : "🪄 LLM"}
              </ChromeButton>
            );
          })}
        </div>
        <Button
          onClick={generate}
          disabled={busy || !placement.keyword.trim()}
          size="xs"
          variant="primary"
          className="bg-success border-success"
        >
          {placement.status === "generating" || busy ? "생성 중…" : "생성"}
        </Button>
      </div>
      {placement.error && (
        <div className="mt-1 text-xs text-warning">{placement.error}</div>
      )}
    </div>
  );
}
