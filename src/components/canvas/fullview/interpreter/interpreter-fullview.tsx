'use client';

/* ────────────────────────────────────────────────────────────────────
   InterpreterFullview — 동시통역 풀뷰 V2 body (CD state 03 · Streaming).
   fresh 빌드 (design-handoff/FULLVIEW-SHELL.md §F4 Interpreter +
   fullview/Widget Fullview Comps.dc.html 03). 레거시 fullview-view.tsx /
   listener-panel.tsx / prompter-pane 는 supersede — 편집·재사용 안 함.
   로직/데이터만 재사용: TranslateSessionContext 스냅샷(promptedLines·
   inputLines·listeners·shareUrl·outputAudible·stop)을 read-only 로 미러.

   레이아웃(§F4): 트윈 INPUT/OUTPUT 패널(flex:1 each · border-3 ink ·
   radius-panel-lg · shadow-memphis-md) + 우측 rail 300px(출력오디오 토글 ·
   옵저버 링크 · 리스너 목록). INPUT 헤더 paper-soft·dot mute-soft / OUTPUT
   헤더 success-bg-soft·dot·label success.

   헤더 액션(§F3 lang pill · End-session)은 셸 헤더가 소유 → 이 body 가
   FullviewHeaderSlot 로 publish 하면 CanvasBoard 의 FullviewHeader 가
   렌더한다(세션 스냅샷이 카드 subtree 라 헤더에 직접 닿지 못하는 걸 bridge).
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CaptionLine } from '@/components/translate-console';
import { useTranslateSession } from '@/components/translate/translate-session-context';
import { useFullviewHeaderSlotPublisher } from '@/components/canvas/shell/fullview-header-slot-context';
import { FullviewEndSessionButton } from '../fullview-header';

// 통역 라인은 CD 에서 Outfit(display) 로 조판된다(§03 stream). 셸 타이틀과
// 동일한 런타임 var 소비 — 하드코드 폰트 금지.
const STREAM_FONT = {
  fontFamily: 'var(--font-outfit), var(--font-sans)',
} as const;

export function InterpreterFullview() {
  const t = useTranslations('TranslateConsole');
  const {
    promptedLines,
    inputLines,
    listeners,
    shareUrl,
    isLive,
    sourceLangLabel,
    targetLangLabel,
    outputAudible,
    toggleOutputAudible,
    copyShareUrl,
    shareCopied,
    stop,
  } = useTranslateSession();

  // 헤더 슬롯 publish — lang pill(§F3 mono "src → tgt") + End-session(라이브
  // 시에만; = 카드 stop 액션 미러). 언마운트/전환 시 clear.
  const publishHeaderSlot = useFullviewHeaderSlotPublisher();
  useEffect(() => {
    const langPill =
      sourceLangLabel && targetLangLabel ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border-[1.5px] border-ink bg-paper px-[11px] py-1 font-mono-label text-sm font-bold text-ink">
          {sourceLangLabel} → {targetLangLabel}
        </span>
      ) : undefined;
    publishHeaderSlot({
      statusChip: langPill,
      actions: isLive ? (
        <FullviewEndSessionButton onClick={stop} label={t('stop')} />
      ) : undefined,
    });
    return () => publishHeaderSlot({});
  }, [
    publishHeaderSlot,
    sourceLangLabel,
    targetLangLabel,
    isLive,
    stop,
    t,
  ]);

  return (
    <div className="flex min-h-0 flex-1 gap-[18px] overflow-hidden p-[22px]">
      {/* 트윈 패널 그룹 (flex:1) */}
      <div className="flex min-w-0 flex-1 gap-[14px]">
        <StreamPanel
          tone="input"
          label={t('interpreter.input')}
          langLabel={sourceLangLabel}
          lines={inputLines}
          emptyText={t('prompter.empty')}
        />
        <StreamPanel
          tone="output"
          label={t('interpreter.output')}
          langLabel={targetLangLabel}
          lines={promptedLines}
          emptyText={t('prompter.empty')}
        />
      </div>

      {/* 우측 rail 300px — 출력오디오 · 옵저버 링크 · 리스너 */}
      <div className="flex w-[300px] shrink-0 flex-col gap-[14px] overflow-hidden">
        {/* 출력 오디오 토글 (§F4: on = track success · knob paper · border-2 ink) */}
        <div className="flex items-center gap-[11px] rounded-sm border-2 border-ink bg-paper px-[15px] py-[13px] shadow-memphis-sm">
          <span aria-hidden className="text-2xl leading-none">
            🔊
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-extrabold text-ink">
              {t('interpreter.outputAudio')}
            </div>
            <div className="text-xs-soft text-mute-soft">
              {t('interpreter.outputAudioHint')}
            </div>
          </div>
          <AudioToggle
            on={outputAudible}
            onToggle={toggleOutputAudible}
            onAria={t('monitorMute.muteAria')}
            offAria={t('monitorMute.unmuteAria')}
          />
        </div>

        {/* 옵저버 링크 — mono 필드 + Copy (§F4: field border-1.5 ink · radius-field) */}
        <div className="flex flex-col gap-[9px] rounded-sm border-[1.5px] border-line bg-paper-soft px-[15px] py-[13px]">
          <div className="flex items-center gap-[7px]">
            <span aria-hidden className="text-xl leading-none">
              🔗
            </span>
            <span className="text-md font-extrabold text-ink">
              {t('interpreter.observerLink')}
            </span>
          </div>
          <div className="flex gap-[7px]">
            <div className="min-w-0 flex-1 truncate rounded-[var(--fv-radius-field)] border-[1.5px] border-ink bg-paper px-[11px] py-[9px] font-mono-label text-sm text-ink">
              {shareUrl ?? t('interpreter.observerLinkPending')}
            </div>
            <CopyButton
              disabled={!shareUrl}
              onCopy={copyShareUrl}
              label={shareCopied ? t('share.copied') : t('share.copy')}
            />
          </div>
          <div className="text-xs-soft leading-[1.5] text-mute-soft">
            {t('interpreter.observerHint')}
          </div>
        </div>

        {/* 리스너 목록 (§F4: presence — success dot · mono id) */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-sm border-[1.5px] border-line bg-paper-soft">
          <div className="flex items-center gap-[7px] border-b border-line px-[15px] py-[12px]">
            <span aria-hidden className="text-lg leading-none">
              👂
            </span>
            <span className="text-md font-extrabold text-ink">
              {t('listeners.title', { count: listeners.length })}
            </span>
          </div>
          {listeners.length === 0 ? (
            <p className="px-[15px] py-6 text-center text-sm text-mute-soft">
              {t('listeners.empty')}
            </p>
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col gap-[7px] overflow-y-auto p-[9px]">
              {listeners.map((l) => (
                <ListenerRow key={l.key} listener={l} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── INPUT / OUTPUT 스트림 패널 ──────────────────────────────────────────
function StreamPanel({
  tone,
  label,
  langLabel,
  lines,
  emptyText,
}: {
  tone: 'input' | 'output';
  label: string;
  langLabel: string;
  lines: CaptionLine[];
  emptyText: string;
}) {
  const isOutput = tone === 'output';
  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--fv-radius-panel-lg)] border-[3px] border-ink bg-paper shadow-memphis-md">
      <header
        className={`flex shrink-0 items-center gap-2 border-b-2 border-ink px-[18px] py-[11px] ${
          isOutput ? 'bg-success-bg-soft' : 'bg-paper-soft'
        }`}
      >
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${
            isOutput ? 'bg-success' : 'bg-mute-soft'
          }`}
        />
        <span
          className={`font-mono-label text-xs font-bold tracking-[0.14em] ${
            isOutput ? 'text-success' : 'text-mute-soft'
          }`}
        >
          {label}
        </span>
        {langLabel ? (
          <span className="text-xl font-bold text-ink" style={STREAM_FONT}>
            {langLabel}
          </span>
        ) : null}
      </header>
      <div
        className="sc flex min-h-0 flex-1 flex-col justify-end gap-5 overflow-y-auto px-6 py-[26px]"
        style={STREAM_FONT}
      >
        {lines.length === 0 ? (
          <p className="text-3xl leading-[1.6] text-faint">{emptyText}</p>
        ) : (
          lines.map((l, i) => {
            const active = i === lines.length - 1;
            return (
              <p
                key={l.id}
                className={`text-3xl leading-[1.6] ${
                  active
                    ? `text-ink ${isOutput ? 'font-semibold' : ''}`
                    : 'text-faint'
                }`}
              >
                {l.text}
              </p>
            );
          })
        )}
      </div>
    </section>
  );
}

// ── 출력 오디오 토글 (on/off) ───────────────────────────────────────────
function AudioToggle({
  on,
  onToggle,
  onAria,
  offAria,
}: {
  on: boolean;
  onToggle: () => void;
  onAria: string;
  offAria: string;
}) {
  return (
    // eslint-disable-next-line react/forbid-elements -- CD §F4 출력오디오 토글은 track 44×26·knob 20×20·border-2 ink 의 전용 스위치 chrome 으로 Checkbox/Button primitive 와 형태 불일치. 셸 close ✕ 와 동일 선례(native chrome).
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? onAria : offAria}
      onClick={onToggle}
      className={`relative h-[26px] w-[44px] shrink-0 rounded-pill border-2 border-ink transition-colors ${
        on ? 'bg-success' : 'bg-paper-soft'
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-[1px] h-5 w-5 rounded-full border-[1.5px] border-ink bg-paper transition-all ${
          on ? 'right-[1px]' : 'left-[1px]'
        }`}
      />
    </button>
  );
}

// ── 옵저버 링크 Copy 버튼 (ink solid pill, §03) ─────────────────────────
function CopyButton({
  disabled,
  onCopy,
  label,
}: {
  disabled: boolean;
  onCopy: () => void;
  label: string;
}) {
  return (
    // eslint-disable-next-line react/forbid-elements -- CD §03 Copy 는 ink solid · radius-field(10) 전용 chrome 으로 Button primitive variant(rounded-xs/full 고정)와 radius 불일치(§7.11 className radius override 불가). 셸 close ✕ 와 동일 선례.
    <button
      type="button"
      onClick={onCopy}
      disabled={disabled}
      className="shrink-0 rounded-[var(--fv-radius-field)] bg-ink px-[13px] py-[9px] text-md font-bold text-paper disabled:opacity-50"
    >
      {label}
    </button>
  );
}

// ── 리스너 행 ────────────────────────────────────────────────────────────
function ListenerRow({
  listener,
}: {
  listener: { anon_id: string; user_agent: string; joined_at: string };
}) {
  const t = useTranslations('TranslateConsole.listeners');
  // "n초 전" 라벨이 presence 가 조용해도 흐르도록 1분마다 tick.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const agent = useMemo(
    () => describeAgent(listener.user_agent),
    [listener.user_agent],
  );
  return (
    <li className="flex items-center gap-[9px] rounded-[var(--fv-radius-field)] border-[1.4px] border-line bg-paper px-[11px] py-[9px]">
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full bg-success"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono-label text-md font-bold text-ink">
          {shortAnonId(listener.anon_id)}
        </div>
        <div className="truncate text-xs-soft text-mute-soft">
          {agent || t('unknownAgent')}
        </div>
      </div>
      <span className="shrink-0 font-mono-label text-xs-soft tabular-nums text-faint">
        {relativeJoined(listener.joined_at, now, t)}
      </span>
    </li>
  );
}

// 아래 3개 헬퍼는 레거시 listener-panel 의 순수 함수 로직과 동일한 규약
// (재사용 대상 = 로직). presentation 은 위 fresh 컴포넌트가 소유.
function shortAnonId(id: string): string {
  return id.replace(/^anon-/, '').slice(0, 8);
}

function relativeJoined(
  joinedAt: string,
  now: number,
  t: ReturnType<typeof useTranslations>,
): string {
  const ts = Date.parse(joinedAt);
  if (Number.isNaN(ts)) return '';
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 60) return t('justNow');
  const min = Math.floor(sec / 60);
  if (min < 60) return t('minutesAgo', { count: min });
  const hr = Math.floor(min / 60);
  return t('hoursAgo', { count: hr });
}

function describeAgent(ua: string): string {
  if (!ua) return '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : '';
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return [browser, os].filter(Boolean).join(' · ');
}
