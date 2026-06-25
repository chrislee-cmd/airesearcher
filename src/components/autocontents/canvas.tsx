"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ChromeInput } from "@/components/ui/chrome-input";

export type NodeStatus = "empty" | "ready" | "running" | "error";

export type NodeSelection =
  | { kind: "source" }
  | { kind: "output" }
  | { kind: "customize"; id: string }
  | { kind: "image" }
  | { kind: "deploy" }
  | null;

export type CanvasPrompt = {
  key: string;
  theme: string;
  prompt: string;
};

export type ResultStatus = "streaming" | "done" | "error";

export type CanvasResult = {
  id: string;
  promptKey: string;
  theme: string;
  prompt: string;
  status: ResultStatus;
};

export type ResultGroup = {
  customizeId: string;
  customizeName: string;
  results: CanvasResult[];
};

export const DRAG_PROMPT_TYPE = "application/x-enko-prompt-key";
export const DRAG_RESULT_TYPE = "application/x-enko-result-id";

export type ImportedResultItem = {
  resultId: string;
  customizeName: string;
  prompt: string;
  status: ResultStatus;
  meta?: string; // extra label (e.g., "이미지 3개" or "채널 2개")
};

const STATUS = {
  empty: {
    dot: "bg-paper-soft ",
    chip:
      "bg-paper-soft text-mute ",
    label: "미설정",
  },
  ready: {
    dot: "bg-success",
    chip:
      "bg-mint text-success ",
    label: "준비됨",
  },
  running: {
    dot: "bg-amore animate-pulse",
    chip: "bg-amore-bg text-amore ",
    label: "실행 중",
  },
  error: {
    dot: "bg-warning",
    chip: "bg-warning-bg text-warning ",
    label: "에러",
  },
} as const;

type CanvasProps = {
  sourceBadge: string;
  sourceDetail?: string;
  sourceStatus: NodeStatus;
  bucketPrompts: CanvasPrompt[];

  customizes: { id: string; name: string }[];
  customizePrompts: Record<string, CanvasPrompt[]>;

  outputBadge: string;
  outputDetail?: string;
  outputStatus: NodeStatus;
  resultGroups: ResultGroup[];
  selectedResultId: string | null;
  onSelectResult: (id: string | null) => void;
  progress?: { completed: number; total: number };

  selection: NodeSelection;
  onSelectNode: (sel: NodeSelection) => void;

  selectedPromptKey: string | null;
  onSelectPrompt: (key: string | null) => void;
  onRemovePrompt: (key: string) => void;
  onUnassignPrompt: (key: string, customizeId: string) => void;
  onAssignPrompt: (key: string, customizeId: string | null) => void;

  onAddCustomize: () => void;
  onRemoveCustomize: (id: string) => void;
  onRenameCustomize: (id: string, name: string) => void;

  onRunCustomize: (id: string) => void;
  runningCustomizeIds: Set<string>;
  customizePromptCounts: Record<string, number>;
  hasAnySource: boolean;

  // image widget
  imageItems: ImportedResultItem[];
  onImportToImage: (resultId: string) => void;
  onRemoveFromImage: (resultId: string) => void;
  onSelectImageItem: (resultId: string) => void;
  imageActiveResultId: string | null;

  // deploy widget
  deployItems: ImportedResultItem[];
  onImportToDeploy: (resultId: string) => void;
  onRemoveFromDeploy: (resultId: string) => void;
  onSelectDeployItem: (resultId: string) => void;
  deployActiveResultId: string | null;
};

export default function Canvas(props: CanvasProps) {
  return (
    <div
      className="relative overflow-hidden rounded-xs border border-line bg-paper "
      style={{
        backgroundImage:
          "radial-gradient(circle, rgba(0,0,0,0.07) 1px, transparent 1px)",
        backgroundSize: "18px 18px",
      }}
    >
      <Toolbar nodeCount={2 + props.customizes.length} />
      <CanvasFlow {...props} />
    </div>
  );
}

function CanvasFlow(props: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const customizeIds = props.customizes.map((c) => c.id).join(",");
  return (
    <div
      ref={containerRef}
      className="relative flex flex-col items-stretch gap-0 px-4 py-6 lg:px-8"
    >
      <ConnectorOverlay
        containerRef={containerRef}
        customizeIds={customizeIds}
        customizePromptCounts={props.customizePromptCounts}
        runningCustomizeIds={props.runningCustomizeIds}
      />

      <div className="relative z-10 flex justify-center">
        <div data-node-id="source">
          <SourceWidget
            badge={props.sourceBadge}
            detail={props.sourceDetail}
            status={props.sourceStatus}
            selected={props.selection?.kind === "source"}
            onClick={() => props.onSelectNode({ kind: "source" })}
            prompts={props.bucketPrompts}
            selectedPromptKey={props.selectedPromptKey}
            onSelectPrompt={props.onSelectPrompt}
            onRemovePrompt={props.onRemovePrompt}
            onDropPrompt={(key) => props.onAssignPrompt(key, null)}
          />
        </div>
      </div>

      <div className="h-16" aria-hidden />

      <div className="relative z-10 flex flex-wrap items-stretch justify-center gap-4">
        {props.customizes.map((c) => {
          const promptCount = props.customizePromptCounts[c.id] ?? 0;
          const isRunning = props.runningCustomizeIds.has(c.id);
          const disabled =
            !props.hasAnySource || promptCount === 0 || isRunning;
          const hint = !props.hasAnySource
            ? "소스를 먼저 설정하세요"
            : promptCount === 0
              ? "프롬프트를 이 위젯으로 드래그하세요"
              : isRunning
                ? "이미 진행 중"
                : undefined;
          return (
            <div key={c.id} className="flex flex-col items-stretch">
              <div data-customize-card-id={c.id}>
                <CustomizeWidget
                  id={c.id}
                  name={c.name}
                  prompts={props.customizePrompts[c.id] ?? []}
                  selected={
                    props.selection?.kind === "customize" &&
                    props.selection.id === c.id
                  }
                  onClick={() =>
                    props.onSelectNode({ kind: "customize", id: c.id })
                  }
                  onRename={(name) => props.onRenameCustomize(c.id, name)}
                  onRemove={() => props.onRemoveCustomize(c.id)}
                  canRemove={props.customizes.length > 1}
                  selectedPromptKey={props.selectedPromptKey}
                  onSelectPrompt={props.onSelectPrompt}
                  onRemovePrompt={(key) => props.onUnassignPrompt(key, c.id)}
                  onDropPrompt={(key) => props.onAssignPrompt(key, c.id)}
                />
              </div>
              <CustomizeRunSlot
                customizeId={c.id}
                onRun={() => props.onRunCustomize(c.id)}
                disabled={disabled}
                hint={hint}
                running={isRunning}
                promptCount={promptCount}
              />
            </div>
          );
        })}
        <div className="flex flex-col items-stretch">
          <AddCustomizeButton onClick={props.onAddCustomize} />
          <div className="h-14" aria-hidden />
        </div>
      </div>

      <div className="h-20" aria-hidden />

      <div className="relative z-10 flex justify-center">
        <div data-node-id="output">
          <OutputWidget
            badge={props.outputBadge}
            detail={props.outputDetail}
            status={props.outputStatus}
            selected={props.selection?.kind === "output"}
            onClick={() => props.onSelectNode({ kind: "output" })}
            groups={props.resultGroups}
            selectedResultId={props.selectedResultId}
            onSelectResult={(id) => {
              props.onSelectResult(id);
              props.onSelectNode({ kind: "output" });
            }}
            progress={props.progress}
            running={props.runningCustomizeIds.size > 0}
          />
        </div>
      </div>

      <div className="h-20" aria-hidden />

      <div className="relative z-10 flex flex-wrap items-stretch justify-center gap-4">
        <div data-node-id="image">
          <ImageWidget
            items={props.imageItems}
            activeResultId={props.imageActiveResultId}
            selected={props.selection?.kind === "image"}
            onClick={() => props.onSelectNode({ kind: "image" })}
            onDropResult={props.onImportToImage}
            onSelectItem={(id) => {
              props.onSelectImageItem(id);
              props.onSelectNode({ kind: "image" });
            }}
            onRemoveItem={props.onRemoveFromImage}
          />
        </div>
        <div data-node-id="deploy">
          <DeployWidget
            items={props.deployItems}
            activeResultId={props.deployActiveResultId}
            selected={props.selection?.kind === "deploy"}
            onClick={() => props.onSelectNode({ kind: "deploy" })}
            onDropResult={props.onImportToDeploy}
            onSelectItem={(id) => {
              props.onSelectDeployItem(id);
              props.onSelectNode({ kind: "deploy" });
            }}
            onRemoveItem={props.onRemoveFromDeploy}
          />
        </div>
      </div>
    </div>
  );
}

function Toolbar({ nodeCount }: { nodeCount: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/70 bg-paper/70 px-4 py-2.5 backdrop-blur-sm ">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wider text-mute">
          Workflow
        </span>
        <span className="text-mute-soft ">·</span>
        <span className="text-mute">{nodeCount}개 노드</span>
      </div>
    </div>
  );
}

function CustomizeRunSlot({
  customizeId,
  onRun,
  disabled,
  hint,
  running,
  promptCount,
}: {
  customizeId: string;
  onRun: () => void;
  disabled?: boolean;
  hint?: string;
  running?: boolean;
  promptCount: number;
}) {
  return (
    <div className="relative flex h-14 w-full items-center justify-center">
      <Button
        data-customize-run-id={customizeId}
        onClick={(e) => {
          e.stopPropagation();
          onRun();
        }}
        disabled={disabled}
        title={disabled ? hint : `${promptCount}개 프롬프트 실행`}
        size="xs"
        variant={running ? "secondary" : "primary"}
        className="relative z-table-cell-sticky rounded-full"
      >
        {running ? (
          <>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            제작 중
          </>
        ) : (
          <>
            <span className="text-xs">▶</span>
            제작 ({promptCount})
          </>
        )}
      </Button>
    </div>
  );
}

type ConnectorPath = {
  key: string;
  d: string;
  variant: "primary" | "dim";
  running?: boolean;
};

function ConnectorOverlay({
  containerRef,
  customizeIds,
  customizePromptCounts,
  runningCustomizeIds,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  customizeIds: string;
  customizePromptCounts: Record<string, number>;
  runningCustomizeIds: Set<string>;
}) {
  const [paths, setPaths] = useState<ConnectorPath[]>([]);
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const lastPathsKeyRef = useRef<string>("");
  const lastDimsKeyRef = useRef<string>("");
  const rafRef = useRef<number | null>(null);

  const recompute = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cr = container.getBoundingClientRect();
    const w = Math.round(cr.width);
    const h = Math.round(cr.height);
    const dimsKey = `${w}x${h}`;
    if (dimsKey !== lastDimsKeyRef.current) {
      lastDimsKeyRef.current = dimsKey;
      setDims({ w, h });
    }

    const rectOf = (sel: string): DOMRect | null => {
      const el = container.querySelector(sel) as HTMLElement | null;
      return el ? el.getBoundingClientRect() : null;
    };

    const newPaths: ConnectorPath[] = [];

    const ids = customizeIds.split(",").filter(Boolean);
    const sourceRect = rectOf('[data-node-id="source"]');
    const outputRect = rectOf('[data-node-id="output"]');
    const imageRect = rectOf('[data-node-id="image"]');
    const deployRect = rectOf('[data-node-id="deploy"]');

    // Source → each customize card top
    if (sourceRect) {
      const sx = sourceRect.left + sourceRect.width / 2 - cr.left;
      const sy = sourceRect.bottom - cr.top;
      ids.forEach((id) => {
        const card = rectOf(`[data-customize-card-id="${CSS.escape(id)}"]`);
        if (!card) return;
        const cx = card.left + card.width / 2 - cr.left;
        const cy = card.top - cr.top;
        const dy = cy - sy;
        const cp1y = sy + Math.max(20, dy * 0.55);
        const cp2y = cy - Math.max(20, dy * 0.45);
        newPaths.push({
          key: `s-c-${id}`,
          d: `M ${sx} ${sy} C ${sx} ${cp1y}, ${cx} ${cp2y}, ${cx} ${cy}`,
          variant: "primary",
        });
      });
    }

    // Customize run buttons → Output top
    if (outputRect) {
      const ox = outputRect.left + outputRect.width / 2 - cr.left;
      const oy = outputRect.top - cr.top;
      ids.forEach((id) => {
        const btn = rectOf(`[data-customize-run-id="${CSS.escape(id)}"]`);
        if (!btn) return;
        const bx = btn.left + btn.width / 2 - cr.left;
        const by = btn.bottom - cr.top;
        const dy = oy - by;
        const cp1y = by + Math.max(20, dy * 0.55);
        const cp2y = oy - Math.max(20, dy * 0.45);
        const empty = (customizePromptCounts[id] ?? 0) === 0;
        newPaths.push({
          key: `c-o-${id}`,
          d: `M ${bx} ${by} C ${bx} ${cp1y}, ${ox} ${cp2y}, ${ox} ${oy}`,
          variant: empty ? "dim" : "primary",
          running: runningCustomizeIds.has(id),
        });
      });

      // Output bottom → Image / Deploy top
      const ob = outputRect.bottom - cr.top;
      const obx = ox;
      if (imageRect) {
        const ix = imageRect.left + imageRect.width / 2 - cr.left;
        const iy = imageRect.top - cr.top;
        const dy = iy - ob;
        const cp1y = ob + Math.max(20, dy * 0.55);
        const cp2y = iy - Math.max(20, dy * 0.45);
        newPaths.push({
          key: `o-i`,
          d: `M ${obx} ${ob} C ${obx} ${cp1y}, ${ix} ${cp2y}, ${ix} ${iy}`,
          variant: "primary",
        });
      }
      if (deployRect) {
        const dx = deployRect.left + deployRect.width / 2 - cr.left;
        const dy = deployRect.top - cr.top;
        const dyd = dy - ob;
        const cp1y = ob + Math.max(20, dyd * 0.55);
        const cp2y = dy - Math.max(20, dyd * 0.45);
        newPaths.push({
          key: `o-d`,
          d: `M ${obx} ${ob} C ${obx} ${cp1y}, ${dx} ${cp2y}, ${dx} ${dy}`,
          variant: "primary",
        });
      }
    }

    const pathsKey = newPaths
      .map((p) => `${p.key}|${p.d}|${p.variant}|${p.running ? 1 : 0}`)
      .join("~");
    if (pathsKey !== lastPathsKeyRef.current) {
      lastPathsKeyRef.current = pathsKey;
      setPaths(newPaths);
    }
  }, [containerRef, customizeIds, customizePromptCounts, runningCustomizeIds]);

  const scheduleRecompute = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      recompute();
    });
  }, [recompute]);

  useLayoutEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(scheduleRecompute);
    ro.observe(container);
    const nodes = container.querySelectorAll(
      "[data-node-id], [data-customize-card-id], [data-customize-run-id]",
    );
    nodes.forEach((n) => ro.observe(n));
    window.addEventListener("resize", scheduleRecompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", scheduleRecompute);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [containerRef, scheduleRecompute, customizeIds]);

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0"
      width={dims.w}
      height={dims.h}
      viewBox={`0 0 ${dims.w || 1} ${dims.h || 1}`}
    >
      <defs>
        <marker
          id="enko-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth="10"
          markerHeight="10"
          orient="auto"
        >
          <path
            d="M 0 0 L 10 5 L 0 10 Z"
            className="fill-mute-soft "
          />
        </marker>
        <marker
          id="enko-arrow-dim"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth="10"
          markerHeight="10"
          orient="auto"
        >
          <path
            d="M 0 0 L 10 5 L 0 10 Z"
            className="fill-mute-soft "
          />
        </marker>
        <marker
          id="enko-arrow-run"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth="10"
          markerHeight="10"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 Z" className="fill-amore" />
        </marker>
      </defs>
      {paths.map((p) => {
        const stroke = p.running
          ? "stroke-amore"
          : p.variant === "dim"
            ? "stroke-mute-soft/70 "
            : "stroke-mute-soft ";
        const markerId = p.running
          ? "enko-arrow-run"
          : p.variant === "dim"
            ? "enko-arrow-dim"
            : "enko-arrow";
        return (
          <path
            key={p.key}
            d={p.d}
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            className={stroke}
            markerEnd={`url(#${markerId})`}
          />
        );
      })}
    </svg>
  );
}

function MergeConnector() {
  return (
    <div
      aria-hidden
      className="relative mx-auto flex h-10 w-full items-center justify-center"
    >
      <svg viewBox="0 0 80 40" width="80" height="40" className="absolute inset-0" preserveAspectRatio="none" style={{ left: "calc(50% - 40px)" }}>
        <path
          d="M 40 0 C 40 12, 40 26, 40 32"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          className="text-mute-soft "
        />
        <polygon
          points="35,28 40,40 45,28"
          className="fill-mute-soft "
        />
      </svg>
    </div>
  );
}

function VerticalConnector() {
  return (
    <div
      aria-hidden
      className="relative mx-auto flex h-12 w-[80px] shrink-0 items-center justify-center"
    >
      <svg viewBox="0 0 80 48" width="80" height="48" className="absolute inset-0">
        <path
          d="M 40 0 C 40 16, 40 30, 40 42"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          className="text-mute-soft "
        />
        <polygon
          points="35,38 40,48 45,38"
          className="fill-mute-soft "
        />
      </svg>
    </div>
  );
}

type NodeShellProps = {
  icon: React.ReactNode;
  title: React.ReactNode;
  badge?: string;
  detail?: string;
  status: NodeStatus;
  selected: boolean;
  onClick: () => void;
  onDropPrompt?: (key: string) => void;
  onDropResult?: (resultId: string) => void;
  width: number;
  rightChrome?: React.ReactNode;
  children?: React.ReactNode;
};

function NodeShell({
  icon,
  title,
  badge,
  detail,
  status,
  selected,
  onClick,
  onDropPrompt,
  onDropResult,
  width,
  rightChrome,
  children,
}: NodeShellProps) {
  const [dragOver, setDragOver] = useState(false);
  const s = STATUS[status];
  const handlesDrop = !!onDropPrompt || !!onDropResult;
  return (
    <div
      onClick={onClick}
      onDragOver={
        handlesDrop
          ? (e) => {
              const types = e.dataTransfer.types;
              const wantPrompt = onDropPrompt && types.includes(DRAG_PROMPT_TYPE);
              const wantResult = onDropResult && types.includes(DRAG_RESULT_TYPE);
              if (wantPrompt || wantResult) {
                e.preventDefault();
                e.dataTransfer.dropEffect = wantPrompt ? "move" : "copy";
                if (!dragOver) setDragOver(true);
              }
            }
          : undefined
      }
      onDragLeave={handlesDrop ? () => setDragOver(false) : undefined}
      onDrop={
        handlesDrop
          ? (e) => {
              e.preventDefault();
              setDragOver(false);
              if (onDropPrompt) {
                const k = e.dataTransfer.getData(DRAG_PROMPT_TYPE);
                if (k) {
                  onDropPrompt(k);
                  return;
                }
              }
              if (onDropResult) {
                const r = e.dataTransfer.getData(DRAG_RESULT_TYPE);
                if (r) onDropResult(r);
              }
            }
          : undefined
      }
      style={{ width }}
      className={
        "shrink-0 cursor-pointer rounded-xs border bg-paper text-left shadow-sm transition-all " +
        (selected
          ? "border-amore ring-4 ring-amore/15 "
          : dragOver
            ? "border-success ring-4 ring-success/15"
            : "border-line hover:border-mute-soft hover:shadow-md ")
      }
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 ">
        <span className={"h-2 w-2 shrink-0 rounded-full " + s.dot} />
        <span className="text-lg leading-none">{icon}</span>
        <div className="min-w-0 flex-1 truncate text-sm font-semibold">
          {title}
        </div>
        {rightChrome}
        <span
          className={
            "shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium " +
            s.chip
          }
        >
          {s.label}
        </span>
      </div>

      <div className="space-y-1 px-3 pt-2">
        {badge && (
          <div className="truncate text-xs font-semibold text-ink-2 ">
            {badge}
          </div>
        )}
        {detail && (
          <div className="line-clamp-2 text-sm leading-snug text-mute">
            {detail}
          </div>
        )}
      </div>

      <div className="px-3 pb-3 pt-2">{children}</div>
    </div>
  );
}

function SourceWidget({
  badge,
  detail,
  status,
  selected,
  onClick,
  prompts,
  selectedPromptKey,
  onSelectPrompt,
  onRemovePrompt,
  onDropPrompt,
}: {
  badge: string;
  detail?: string;
  status: NodeStatus;
  selected: boolean;
  onClick: () => void;
  prompts: CanvasPrompt[];
  selectedPromptKey: string | null;
  onSelectPrompt: (key: string | null) => void;
  onRemovePrompt: (key: string) => void;
  onDropPrompt: (key: string) => void;
}) {
  return (
    <NodeShell
      icon="📥"
      title="컨텐츠 소스"
      badge={badge}
      detail={detail}
      status={status}
      selected={selected}
      onClick={onClick}
      onDropPrompt={onDropPrompt}
      width={360}
    >
      <PromptList
        prompts={prompts}
        selectedPromptKey={selectedPromptKey}
        onSelectPrompt={onSelectPrompt}
        onRemovePrompt={onRemovePrompt}
        emptyText="인스펙터에서 토픽을 클릭해 추가하세요"
      />
    </NodeShell>
  );
}

function CustomizeWidget({
  id: _id,
  name,
  prompts,
  selected,
  onClick,
  onRename,
  onRemove,
  canRemove,
  selectedPromptKey,
  onSelectPrompt,
  onRemovePrompt,
  onDropPrompt,
}: {
  id: string;
  name: string;
  prompts: CanvasPrompt[];
  selected: boolean;
  onClick: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  canRemove: boolean;
  selectedPromptKey: string | null;
  onSelectPrompt: (key: string | null) => void;
  onRemovePrompt: (key: string) => void;
  onDropPrompt: (key: string) => void;
}) {
  return (
    <NodeShell
      icon="🎨"
      title={
        <EditableTitle value={name} onChange={onRename} />
      }
      status="ready"
      selected={selected}
      onClick={onClick}
      onDropPrompt={onDropPrompt}
      width={300}
      rightChrome={
        canRemove ? (
          <IconButton
            aria-label="이 위젯 삭제"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`"${name}" 위젯을 삭제할까요?`)) onRemove();
            }}
            variant="bordered"
            size="sm"
            title="이 위젯 삭제"
          >
            ✕
          </IconButton>
        ) : null
      }
    >
      <PromptList
        prompts={prompts}
        selectedPromptKey={selectedPromptKey}
        onSelectPrompt={onSelectPrompt}
        onRemovePrompt={onRemovePrompt}
        emptyText="여기에 프롬프트를 드래그"
      />
    </NodeShell>
  );
}

function OutputWidget({
  badge,
  detail,
  status,
  selected,
  onClick,
  groups,
  selectedResultId,
  onSelectResult,
  progress,
  running,
}: {
  badge: string;
  detail?: string;
  status: NodeStatus;
  selected: boolean;
  onClick: () => void;
  groups: ResultGroup[];
  selectedResultId: string | null;
  onSelectResult: (id: string) => void;
  progress?: { completed: number; total: number };
  running?: boolean;
}) {
  const groupCount = Math.max(groups.length, 1);
  const widthPerGroup = 220;
  const containerWidth = Math.min(
    Math.max(520, groupCount * widthPerGroup + 48),
    980,
  );
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : null;
  return (
    <div className={running ? "relative rounded-xs enko-running-ring" : "relative"}>
      {running && (
        <>
          <div className="pointer-events-none absolute -inset-0.5 z-0 rounded-xs enko-shimmer opacity-60" />
          <div className="pointer-events-none absolute inset-x-1 top-0 z-10 h-0.5 overflow-hidden rounded-full">
            <div className="h-full w-1/4 rounded-full bg-amore enko-slide-bar" />
          </div>
        </>
      )}
    <NodeShell
      icon={running ? <span className="enko-wobble">📤</span> : "📤"}
      title={
        running ? (
          <span className="inline-flex items-center gap-1.5">
            아웃풋
            <span className="inline-flex items-center gap-1 rounded-full bg-amore-bg px-1.5 py-0.5 text-xs font-medium text-amore ">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
              working…
            </span>
          </span>
        ) : (
          "아웃풋"
        )
      }
      badge={badge}
      detail={detail}
      status={status}
      selected={selected}
      onClick={onClick}
      width={containerWidth}
    >
      {pct !== null && (
        <div className="mb-2.5">
          <div className="mb-1 flex items-center justify-between text-xs font-medium text-mute">
            <span>생성 진척도</span>
            <span>
              {pct}% · {progress!.completed}/{progress!.total}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper-soft ">
            <div
              className={
                "h-full rounded-full transition-all duration-300 " +
                (pct === 100
                  ? "bg-success"
                  : "bg-amore")
              }
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-xs border border-dashed border-line px-2 py-3 text-center text-sm text-mute-soft ">
          ▶ 제작을 누르면 결과가 여기 쌓입니다
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          {groups.map((g) => (
            <div
              key={g.customizeId}
              className="flex w-[200px] shrink-0 flex-col rounded-xs border border-line bg-paper-soft/60 p-1.5 "
            >
              <div className="mb-1 flex items-center gap-1.5 px-1">
                <span className="truncate text-xs font-semibold uppercase tracking-wider text-mute">
                  🎨 {g.customizeName}
                </span>
                <span className="shrink-0 text-xs text-mute-soft">
                  {g.results.length}
                </span>
              </div>
              <div className="space-y-1">
                {g.results.map((r) => (
                  <ResultChip
                    key={r.id}
                    result={r}
                    active={selectedResultId === r.id}
                    onClick={() => onSelectResult(r.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </NodeShell>
    </div>
  );
}

function ResultChip({
  result,
  active,
  onClick,
}: {
  result: CanvasResult;
  active: boolean;
  onClick: () => void;
}) {
  const statusEl =
    result.status === "streaming" ? (
      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amore" />
    ) : result.status === "error" ? (
      <span className="shrink-0 text-xs text-warning">✕</span>
    ) : (
      <span className="shrink-0 text-xs text-success">✓</span>
    );
  const draggable = result.status !== "streaming";
  return (
    <div
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              e.stopPropagation();
              e.dataTransfer.effectAllowed = "copy";
              e.dataTransfer.setData(DRAG_RESULT_TYPE, result.id);
            }
          : undefined
      }
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={`${result.theme} · ${result.prompt}${draggable ? " (드래그하여 이미지/배포 위젯으로)" : ""}`}
      className={
        "flex w-full cursor-pointer items-center gap-1.5 rounded-xs border px-2 py-1 text-left text-sm transition-colors " +
        (draggable ? "active:cursor-grabbing " : "") +
        (active
          ? "border-amore bg-amore-bg text-amore "
          : "border-line bg-paper text-ink-2 hover:border-mute-soft hover:bg-paper-soft ")
      }
    >
      {draggable && (
        <span aria-hidden className="shrink-0 text-mute-soft">
          ⋮⋮
        </span>
      )}
      {statusEl}
      <span className="flex-1 truncate">{result.prompt}</span>
    </div>
  );
}

function ImageWidget({
  items,
  activeResultId,
  selected,
  onClick,
  onDropResult,
  onSelectItem,
  onRemoveItem,
}: {
  items: ImportedResultItem[];
  activeResultId: string | null;
  selected: boolean;
  onClick: () => void;
  onDropResult: (id: string) => void;
  onSelectItem: (id: string) => void;
  onRemoveItem: (id: string) => void;
}) {
  return (
    <NodeShell
      icon="🖼️"
      title="이미지 추가"
      badge={items.length === 0 ? "비어 있음" : `${items.length}개 컨텐츠`}
      detail={
        items.length === 0
          ? "Output chip을 드래그해서 가져오세요"
          : "클릭 → 인스펙터에서 + 위치 찍기"
      }
      status={items.length === 0 ? "empty" : "ready"}
      selected={selected}
      onClick={onClick}
      onDropResult={onDropResult}
      width={320}
    >
      <ImportedList
        items={items}
        activeResultId={activeResultId}
        onSelect={onSelectItem}
        onRemove={onRemoveItem}
        emptyText="여기에 컨텐츠 chip을 드래그"
        draggable
      />
    </NodeShell>
  );
}

function DeployWidget({
  items,
  activeResultId,
  selected,
  onClick,
  onDropResult,
  onSelectItem,
  onRemoveItem,
}: {
  items: ImportedResultItem[];
  activeResultId: string | null;
  selected: boolean;
  onClick: () => void;
  onDropResult: (id: string) => void;
  onSelectItem: (id: string) => void;
  onRemoveItem: (id: string) => void;
}) {
  return (
    <NodeShell
      icon="🚀"
      title="배포"
      badge={items.length === 0 ? "비어 있음" : `${items.length}개 컨텐츠`}
      detail={
        items.length === 0
          ? "Output chip을 드래그해서 가져오세요"
          : "클릭 → 인스펙터에서 채널 선택·게시"
      }
      status={items.length === 0 ? "empty" : "ready"}
      selected={selected}
      onClick={onClick}
      onDropResult={onDropResult}
      width={320}
    >
      <ImportedList
        items={items}
        activeResultId={activeResultId}
        onSelect={onSelectItem}
        onRemove={onRemoveItem}
        emptyText="여기에 컨텐츠 chip을 드래그"
      />
    </NodeShell>
  );
}

function ImportedList({
  items,
  activeResultId,
  onSelect,
  onRemove,
  emptyText,
  draggable = false,
}: {
  items: ImportedResultItem[];
  activeResultId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  emptyText: string;
  draggable?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xs border border-dashed border-line px-2 py-3 text-center text-sm text-mute-soft ">
        {emptyText}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {items.map((it) => {
        const active = activeResultId === it.resultId;
        const statusEl =
          it.status === "streaming" ? (
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amore" />
          ) : it.status === "error" ? (
            <span className="shrink-0 text-xs text-warning">✕</span>
          ) : (
            <span className="shrink-0 text-xs text-success">✓</span>
          );
        return (
          <div
            key={it.resultId}
            draggable={draggable}
            onDragStart={
              draggable
                ? (e) => {
                    e.stopPropagation();
                    e.dataTransfer.effectAllowed = "copy";
                    e.dataTransfer.setData(DRAG_RESULT_TYPE, it.resultId);
                  }
                : undefined
            }
            onClick={(e) => {
              e.stopPropagation();
              onSelect(it.resultId);
            }}
            className={
              "group flex cursor-pointer items-center gap-1.5 rounded-xs border px-2 py-1 text-sm transition-colors " +
              (draggable ? "active:cursor-grabbing " : "") +
              (active
                ? "border-amore bg-amore-bg text-amore "
                : "border-line bg-paper text-ink-2 hover:border-mute-soft hover:bg-paper-soft ")
            }
            title={`${it.customizeName} · ${it.prompt}${draggable ? " (드래그하여 배포 위젯으로)" : ""}`}
          >
            {draggable && (
              <span aria-hidden className="shrink-0 text-mute-soft">
                ⋮⋮
              </span>
            )}
            {statusEl}
            <span className="flex-1 truncate">{it.prompt}</span>
            {it.meta && (
              <span className="shrink-0 rounded-full bg-paper-soft px-1.5 py-0.5 text-xs text-mute ">
                {it.meta}
              </span>
            )}
            <IconButton
              aria-label="제거"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(it.resultId);
              }}
              variant="ghost-danger"
              size="compact"
              className="opacity-0 group-hover:opacity-100"
              title="제거"
            >
              ×
            </IconButton>
          </div>
        );
      })}
    </div>
  );
}

function AddCustomizeButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      onClick={onClick}
      variant="ghost"
      size="sm"
      className="flex w-[180px] shrink-0 flex-col items-center justify-center gap-1 self-stretch border-2 border-dashed px-3 py-6"
    >
      <span className="text-xl leading-none">＋</span>
      <span>커스터마이즈 추가</span>
    </Button>
  );
}

function EditableTitle({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onChange(trimmed);
    else setDraft(value);
    setEditing(false);
  }

  if (editing) {
    return (
      <ChromeInput
        autoFocus
        size="xs"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-full font-semibold"
      />
    );
  }

  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        setDraft(value);
        setEditing(true);
      }}
      title="클릭해서 이름 변경"
      className="block truncate rounded-sm px-1 py-0.5 hover:bg-paper-soft "
    >
      {value}
    </span>
  );
}

function PromptList({
  prompts,
  selectedPromptKey,
  onSelectPrompt,
  onRemovePrompt,
  emptyText,
}: {
  prompts: CanvasPrompt[];
  selectedPromptKey: string | null;
  onSelectPrompt: (key: string | null) => void;
  onRemovePrompt: (key: string) => void;
  emptyText: string;
}) {
  if (prompts.length === 0) {
    return (
      <div className="rounded-xs border border-dashed border-line px-2 py-3 text-center text-sm text-mute-soft ">
        {emptyText}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {prompts.map((p) => (
        <PromptChip
          key={p.key}
          prompt={p}
          active={selectedPromptKey === p.key}
          onSelect={onSelectPrompt}
          onRemove={onRemovePrompt}
        />
      ))}
    </div>
  );
}

function PromptChip({
  prompt,
  active,
  onSelect,
  onRemove,
}: {
  prompt: CanvasPrompt;
  active: boolean;
  onSelect: (key: string | null) => void;
  onRemove: (key: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "copyMove";
        e.dataTransfer.setData(DRAG_PROMPT_TYPE, prompt.key);
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(active ? null : prompt.key);
      }}
      className={
        "group flex cursor-grab items-center gap-1.5 rounded-xs border px-2 py-1 text-sm transition-all active:cursor-grabbing " +
        (dragging ? "opacity-50 " : "") +
        (active
          ? "border-amore bg-amore-bg text-amore "
          : "border-line bg-paper text-ink-2 hover:border-mute-soft hover:bg-paper-soft ")
      }
      title={`${prompt.theme} · ${prompt.prompt}`}
    >
      <span aria-hidden className="shrink-0 text-mute-soft">
        ⋮⋮
      </span>
      <span className="flex-1 truncate">{prompt.prompt}</span>
      <IconButton
        aria-label="캔버스에서 제거"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(prompt.key);
        }}
        variant="ghost-danger"
        size="compact"
        className="opacity-0 group-hover:opacity-100"
        title="캔버스에서 제거"
      >
        ×
      </IconButton>
    </div>
  );
}
