"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChromeButton } from "@/components/ui/chrome-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "./markdown";
import {
  CONTENT_TYPE_OPTIONS,
  DEFAULT_STYLE,
  EMOJI_OPTIONS,
  FORMALITY_OPTIONS,
  LANGUAGE_OPTIONS,
  Language,
  LocOption,
  PERSONA_OPTIONS,
  StyleConfig,
  loc,
} from "./style-config";

type Props = {
  value: StyleConfig;
  onChange: (next: StyleConfig) => void;
  embedded?: boolean;
};

const DEFAULT_PREVIEW_TOPIC_KO =
  "이 컨텐츠 자동 생성기를 처음 쓰는 사용자에게 핵심 가치를 소개해 주세요.";
const DEFAULT_PREVIEW_TOPIC_EN =
  "Introduce the core value of this content generator to a first-time user.";

function defaultPreviewTopic(lang: Language) {
  return lang === "en" ? DEFAULT_PREVIEW_TOPIC_EN : DEFAULT_PREVIEW_TOPIC_KO;
}

export default function StylePanel({ value, onChange, embedded = false }: Props) {
  const [open, setOpen] = useState(true);
  // Track a user-set topic separately so language flips can fall back to the
  // localized default without needing a sync effect (which lints as a cascading
  // render under react-hooks/set-state-in-effect).
  const [topicOverride, setTopicOverride] = useState<string | null>(null);
  const previewTopic = topicOverride ?? defaultPreviewTopic(value.language);
  const setPreviewTopic = (next: string) => setTopicOverride(next);
  const setPreviewTopicTouched = (touched: boolean) => {
    if (!touched) setTopicOverride(null);
  };
  const [previewText, setPreviewText] = useState("");
  const [previewStatus, setPreviewStatus] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRunRef = useRef(true);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const delay = firstRunRef.current ? 250 : 700;
    firstRunRef.current = false;

    debounceRef.current = setTimeout(() => {
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setPreviewStatus("loading");
      setPreviewError(null);
      setPreviewText("");

      (async () => {
        try {
          const res = await fetch("/api/autocontents/preview", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ style: value, sampleTopic: previewTopic }),
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
            const { done, value: chunk } = await reader.read();
            if (done) break;
            acc += decoder.decode(chunk, { stream: true });
            setPreviewText(acc);
          }
          setPreviewStatus("done");
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
          setPreviewError(e instanceof Error ? e.message : "프리뷰 실패");
          setPreviewStatus("error");
        }
      })();
    }, delay);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, previewTopic]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const patch = (p: Partial<StyleConfig>) => onChange({ ...value, ...p });

  if (embedded) {
    return (
      <div className="flex flex-col">
        <div className="sticky top-0 z-table-sticky border-b border-line bg-paper">
          <div className="border-b border-line px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-mute">
                  Live Preview
                </span>
                <PreviewStatusBadge status={previewStatus} />
              </div>
              <ChromeButton
                onClick={() => {
                  setPreviewTopic(defaultPreviewTopic(value.language));
                  setPreviewTopicTouched(false);
                }}
                size="xs"
                variant="mute"
              >
                토픽 리셋
              </ChromeButton>
            </div>
            <Input
              type="text"
              size="sm"
              value={previewTopic}
              onChange={(e) => {
                setPreviewTopic(e.target.value);
                setPreviewTopicTouched(true);
              }}
              placeholder="프리뷰용 샘플 토픽"
              className="mb-1.5 text-sm"
            />
            <div className="max-h-[28vh] min-h-[100px] overflow-y-auto rounded-xs border border-line bg-paper p-2.5">
              {previewError ? (
                <span className="text-sm text-warning">에러: {previewError}</span>
              ) : previewText ? (
                <div>
                  <Markdown>{previewText}</Markdown>
                  {previewStatus === "loading" && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-mute">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
                      업데이트 중…
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-sm text-mute-soft">
                  {previewStatus === "loading"
                    ? "프리뷰 생성 중…"
                    : "설정을 바꾸면 여기에 즉시 갱신됩니다."}
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-mute">
              ~0.7s 디바운스 · claude-haiku-4-5
            </div>
          </div>
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-xs text-mute">자동 저장</span>
            <ChromeButton
              onClick={() => onChange(DEFAULT_STYLE)}
              size="xs"
              variant="mute"
            >
              기본값
            </ChromeButton>
          </div>
        </div>

        <div className="space-y-4 px-4 py-4">
          <ChipGroup
            label="컨텐츠 타입"
            options={CONTENT_TYPE_OPTIONS}
            lang={value.language}
            value={value.contentType}
            onChange={(v) => patch({ contentType: v })}
          />
          <ChipGroup
            label="언어"
            options={LANGUAGE_OPTIONS}
            lang={value.language}
            value={value.language}
            onChange={(v) => patch({ language: v })}
          />
          <ChipGroup
            label="격식"
            options={FORMALITY_OPTIONS}
            lang={value.language}
            value={value.formality}
            onChange={(v) => patch({ formality: v })}
          />
          <ChipGroup
            label="페르소나"
            options={PERSONA_OPTIONS}
            lang={value.language}
            value={value.persona}
            onChange={(v) => patch({ persona: v })}
          />
          <ChipGroup
            label="이모지"
            options={EMOJI_OPTIONS}
            lang={value.language}
            value={value.emoji}
            onChange={(v) => patch({ emoji: v })}
          />
          <CustomNotesBlock
            value={value.customNotes}
            onChange={(v) => patch({ customNotes: v })}
            language={value.language}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-sm border border-line bg-paper">
      <Button
        onClick={() => setOpen((v) => !v)}
        variant="link"
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        fullWidth
      >
        <div className="flex items-center gap-2">
          <span
            className="text-mute-soft transition-transform"
            style={{ transform: open ? "rotate(0)" : "rotate(-90deg)" }}
          >
            ▾
          </span>
          <span className="text-md font-medium">스타일 커스터마이즈</span>
          <span className="text-sm text-mute">
            (모든 토픽에 적용 · 자동 저장)
          </span>
        </div>
        <span
          onClick={(e) => {
            e.stopPropagation();
            onChange(DEFAULT_STYLE);
          }}
          role="button"
          className="rounded-xs border border-line px-2 py-1 text-sm hover:bg-paper-soft"
        >
          기본값
        </span>
      </Button>

      {open && (
        <div className="grid grid-cols-1 gap-5 border-t border-line px-4 py-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="order-2 space-y-5 lg:order-1">
            <CardGroup
              label="언어"
              help="출력 언어를 강제합니다."
              options={LANGUAGE_OPTIONS}
              lang={value.language}
              value={value.language}
              onChange={(v) => patch({ language: v })}
            />

            <CardGroup
              label="격식"
              help="문장 종결과 어휘 레지스터를 결정합니다 (가장 큰 톤 차이)."
              options={FORMALITY_OPTIONS}
              lang={value.language}
              value={value.formality}
              onChange={(v) => patch({ formality: v })}
            />

            <CardGroup
              label="페르소나"
              help="화자의 관점과 어떻게 말할지를 정합니다 (감정/근거/행동/서사)."
              options={PERSONA_OPTIONS}
              lang={value.language}
              value={value.persona}
              onChange={(v) => patch({ persona: v })}
            />

            <CardGroup
              label="컨텐츠 타입"
              help="블로그 / 트위터 쓰레드 / 레딧 중 어떤 매체에 최적화할지."
              options={CONTENT_TYPE_OPTIONS}
              lang={value.language}
              value={value.contentType}
              onChange={(v) => patch({ contentType: v })}
            />

            <CardGroup
              label="이모지"
              help="이모지 사용 여부 (none/free만 — 그 사이는 LLM이 구분 못 함)."
              options={EMOJI_OPTIONS}
              lang={value.language}
              value={value.emoji}
              onChange={(v) => patch({ emoji: v })}
            />

            <TextSection
              label="★ 추가 지시 (MUST FOLLOW)"
              help="LLM이 반드시 그대로 따라야 하는 지시. 다른 옵션·방향성보다 우선."
              valueSummary={
                value.customNotes.trim()
                  ? value.customNotes.trim().slice(0, 60) +
                    (value.customNotes.trim().length > 60 ? "…" : "")
                  : "비어 있음"
              }
            >
              <Textarea
                value={value.customNotes}
                onChange={(e) => patch({ customNotes: e.target.value })}
                placeholder="예) 마지막에 한 줄 CTA로 마무리, 영문 용어는 괄호 안에 영어 병기"
                className="min-h-[60px]"
              />
            </TextSection>
          </div>

          <div className="order-1 lg:order-2">
            <div className="sticky top-4 rounded-sm border border-line bg-paper-soft p-3 backdrop-blur-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold uppercase tracking-wider text-mute">
                    Live Preview
                  </span>
                  <PreviewStatusBadge status={previewStatus} />
                </div>
                <ChromeButton
                  onClick={() => {
                    setPreviewTopic(defaultPreviewTopic(value.language));
                    setPreviewTopicTouched(false);
                  }}
                  size="xs"
                  variant="mute"
                >
                  토픽 리셋
                </ChromeButton>
              </div>
              <Input
                type="text"
                size="sm"
                value={previewTopic}
                onChange={(e) => {
                  setPreviewTopic(e.target.value);
                  setPreviewTopicTouched(true);
                }}
                placeholder="프리뷰용 샘플 토픽"
                className="mb-2 text-sm"
              />
              <div className="max-h-[60vh] min-h-[180px] overflow-y-auto rounded-xs border border-line bg-paper p-3">
                {previewError ? (
                  <span className="text-md text-warning">
                    에러: {previewError}
                  </span>
                ) : previewText ? (
                  <div>
                    <Markdown>{previewText}</Markdown>
                    {previewStatus === "loading" && (
                      <div className="mt-2 flex items-center gap-1.5 text-sm text-mute">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
                        업데이트 중…
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="text-md text-mute-soft">
                    {previewStatus === "loading"
                      ? "프리뷰 생성 중…"
                      : "설정을 바꾸면 여기에 짧은 샘플이 즉시 갱신됩니다."}
                  </span>
                )}
              </div>
              <div className="mt-1.5 text-sm text-mute">
                설정 변경 시 ~0.7s 디바운스 · claude-haiku-4-5
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function ChipGroup<T extends string>({
  label,
  options,
  lang,
  value,
  onChange,
}: {
  label: string;
  options: LocOption<T>[];
  lang: Language;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-mute">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const l = loc(o, lang);
          const active = value === o.value;
          return (
            <Button
              key={o.value}
              onClick={() => onChange(o.value)}
              title={l.short}
              aria-pressed={active}
              size="xs"
              variant={active ? "primary" : "ghost"}
              className="rounded-full"
            >
              {l.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function SectionShell({
  label,
  summary,
  defaultOpen = false,
  children,
}: {
  label: string;
  summary: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-sm border border-line">
      <Button
        onClick={() => setOpen((v) => !v)}
        variant="link"
        fullWidth
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-paper-soft"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="text-mute-soft transition-transform"
            style={{ transform: open ? "rotate(0)" : "rotate(-90deg)" }}
          >
            ▾
          </span>
          <span className="shrink-0 text-sm font-semibold text-ink-2">
            {label}
          </span>
        </div>
        <span className="ml-2 truncate text-sm text-mute">{summary}</span>
      </Button>
      {open && (
        <div className="border-t border-line px-3 py-3">{children}</div>
      )}
    </div>
  );
}

function CardGroup<T extends string>({
  label,
  help,
  options,
  lang,
  value,
  onChange,
}: {
  label: string;
  help: string;
  options: LocOption<T>[];
  lang: Language;
  value: T;
  onChange: (v: T) => void;
}) {
  const selectedOpt = options.find((o) => o.value === value);
  const selectedLoc = selectedOpt ? loc(selectedOpt, lang) : null;
  const summary = selectedLoc
    ? `${selectedLoc.label} · ${selectedLoc.short}`
    : "선택 없음";

  return (
    <SectionShell label={label} summary={summary}>
      <div className="mb-2 text-xs text-mute">{help}</div>
      <div className="flex flex-col gap-1.5">
        {options.map((o) => {
          const l = loc(o, lang);
          const active = value === o.value;
          return (
            <Button
              key={o.value}
              onClick={() => onChange(o.value)}
              variant={active ? "secondary" : "ghost"}
              size="sm"
              className="!justify-start text-left"
              fullWidth
            >
              <span className="flex w-full items-baseline gap-2">
                <span className="line-clamp-1 min-w-0 flex-1 text-md">
                  <span className="font-semibold">{l.label}</span>
                  <span className="text-mute"> — {l.short}</span>
                </span>
                {active && (
                  <span className="shrink-0 rounded-full bg-ink px-1.5 py-0.5 text-xs font-medium text-paper">
                    선택됨
                  </span>
                )}
              </span>
            </Button>
          );
        })}
      </div>
    </SectionShell>
  );
}

function TextSection({
  label,
  help,
  valueSummary,
  children,
}: {
  label: string;
  help?: string;
  valueSummary: string;
  children: React.ReactNode;
}) {
  return (
    <SectionShell label={label} summary={valueSummary}>
      {help && <div className="mb-2 text-xs text-mute">{help}</div>}
      {children}
    </SectionShell>
  );
}

function PreviewStatusBadge({
  status,
}: {
  status: "idle" | "loading" | "done" | "error";
}) {
  if (status === "loading")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amore-bg px-1.5 py-0.5 text-xs font-medium text-amore">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
        업데이트 중
      </span>
    );
  if (status === "done")
    return (
      <span className="rounded-full bg-mint px-1.5 py-0.5 text-xs font-medium text-success">
        최신
      </span>
    );
  if (status === "error")
    return (
      <span className="rounded-full bg-warning-bg px-1.5 py-0.5 text-xs font-medium text-warning">
        에러
      </span>
    );
  return null;
}

function CustomNotesBlock({
  value,
  onChange,
  language,
}: {
  value: string;
  onChange: (v: string) => void;
  language: Language;
}) {
  const [injected, setInjected] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [injectedVersion, setInjectedVersion] = useState("");

  const trimmed = value.trim();
  const lineCount = trimmed ? trimmed.split(/\n+/).filter(Boolean).length : 0;
  const isDirty = trimmed !== injectedVersion.trim();
  const canInject = trimmed.length > 0;

  function handleInject() {
    if (!canInject) return;
    setInjectedVersion(value);
    setInjected(true);
    setShowPreview(true);
    window.setTimeout(() => setInjected(false), 1800);
  }

  const mandatoryBlock =
    language === "ko"
      ? [
          "[★ MANDATORY USER INSTRUCTIONS — 최우선 / MUST FOLLOW]",
          "  - 다음 지시는 반드시 그대로 따릅니다. 다른 모든 규칙(스타일/방향성 포함)과 충돌 시 이 지시가 항상 우선합니다.",
          "  - 모든 항목을 빠짐없이 적용하세요. 누락이나 약화된 적용은 실패로 간주합니다.",
          `  >>> ${trimmed.replace(/\n/g, "\n      ")}`,
        ].join("\n")
      : [
          "[★ MANDATORY USER INSTRUCTIONS — HIGHEST PRIORITY / MUST FOLLOW]",
          "  - The directives below MUST be obeyed exactly. They ALWAYS win over any other rule.",
          "  - Apply every directive in full. Skipping or watering down is treated as failure.",
          `  >>> ${trimmed.replace(/\n/g, "\n      ")}`,
        ].join("\n");

  return (
    <div className="rounded-sm border-2 border-warning bg-warning-bg p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-warning">★</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-warning">
            추가 지시 (MUST FOLLOW)
          </span>
        </div>
        {!isDirty && injectedVersion && (
          <span className="rounded-full bg-mint px-1.5 py-0.5 text-xs font-medium text-success">
            ✓ 주입 완료
          </span>
        )}
        {isDirty && injectedVersion && (
          <span className="rounded-full bg-warning-line px-1.5 py-0.5 text-xs font-medium text-warning">
            ⚠ 미주입 변경
          </span>
        )}
      </div>
      <div className="mb-2 text-xs leading-snug text-warning">
        여기 적은 지시는 다른 모든 옵션(언어/격식/페르소나/컨텐츠 타입/이모지)과
        내용 방향성보다 <strong>우선</strong>합니다. 자동으로 시스템 프롬프트에
        포함되지만, 안전한 확인을 위해 <strong>주입 버튼</strong>으로 명시
        확정할 수 있습니다.
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          "예)\n- 마지막에 한 줄 CTA로 마무리\n- 영문 용어는 괄호 안에 영어 병기\n- 회사명 'Enkostay'는 첫 등장에만 표기"
        }
        rows={5}
        className="min-h-[80px]"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-warning">
          {lineCount > 0
            ? `${lineCount}개 지시 라인`
            : "지시를 한 줄씩 입력하세요"}
        </span>
        <div className="flex items-center gap-1.5">
          {injectedVersion && (
            <ChromeButton
              onClick={() => setShowPreview((v) => !v)}
              size="xs"
              variant="mute"
            >
              {showPreview ? "미리보기 닫기" : "미리보기"}
            </ChromeButton>
          )}
          <Button
            onClick={handleInject}
            disabled={!canInject}
            size="xs"
            variant={injected ? "primary" : "primary"}
            title={
              canInject
                ? "이 지시를 시스템 프롬프트의 ★ MANDATORY 블록으로 명시 주입"
                : "지시를 먼저 입력하세요"
            }
          >
            {injected ? "✓ 주입됨" : "↳ 주입"}
          </Button>
        </div>
      </div>
      {showPreview && injectedVersion && (
        <div className="mt-2 rounded-xs border border-warning-line bg-paper p-2">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-warning">
            LLM에 전달되는 MANDATORY 블록
          </div>
          <pre className="whitespace-pre-wrap break-words text-xs leading-snug text-ink-2">
            {mandatoryBlock}
          </pre>
        </div>
      )}
    </div>
  );
}
