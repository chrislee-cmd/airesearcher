'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingControlBoard / ProbingControlBar — probing 위젯의 세션 컨트롤.

   PR (widget-control-board-probing): 옛 서브헤더(⚙ 설정 버튼 → 모달 + CTA)
   구조를 폐기하고 2-phase 컨트롤로 재편.

     · Phase 1 (idle)  = ProbingControlBoard — 조사 목적 / 입력 소스 / 언어 /
       🚀 세션 시작 CTA 를 카드 상단에 모달 없이 인라인 노출. (옛 온보딩
       게이팅 · 설정 모달 폐기 — 컨트롤이 항상 보이므로 불필요.)
     · Phase 2 (active) = ProbingControlBar — 얇은 slim bar 로 축소. ▼ 를
       펼치면 세션 중에도 컨트롤(조사 목적 · 입력 소스 · 언어)을 재노출.

   입력 소스 / 언어 select 은 옛 SourcePicker / OutputLangPicker 를 이 파일로
   이관 (native <select> 는 forbid-elements 대상 아님 — button/input/textarea
   만 금지). 세션 진행 중 (idle/error 외) 에는 소스/언어 disabled — 옛 동작
   그대로. 조사 목적은 라이브 중에도 편집 가능 (다음 think tick 에 반영).
   ──────────────────────────────────────────────────────────────────── */

import { useState } from 'react';
import { Field } from '@/components/canvas/shell/field';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ChromeButton } from '@/components/ui/chrome-button';
import type { ProbingOutputLang } from '@/lib/probing-prompts';

export type SourceKind = 'mic' | 'tab';

const GOAL_MAX = 2_000;

function SourcePicker({
  value,
  onChange,
  disabled,
}: {
  value: SourceKind;
  onChange: (next: SourceKind) => void;
  disabled: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SourceKind)}
      disabled={disabled}
      aria-label="입력 소스"
      className="h-8 rounded-xs border border-line bg-paper px-2 text-md text-ink disabled:opacity-40"
    >
      <option value="mic">마이크</option>
      <option value="tab">탭 오디오</option>
    </select>
  );
}

// 분석 출력 언어 옵션 — translate 의 LANGS 6종과 동일. 입력 (STT) 언어와
// 독립적으로 분석 결과 언어를 선택 (예: 한국어 인터뷰 → 영어 분석).
const OUTPUT_LANG_OPTIONS: { value: ProbingOutputLang; label: string }[] = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
  { value: 'es', label: 'Español' },
  { value: 'th', label: 'ไทย' },
];

function OutputLangPicker({
  value,
  onChange,
  disabled,
}: {
  value: ProbingOutputLang;
  onChange: (next: ProbingOutputLang) => void;
  disabled: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ProbingOutputLang)}
      disabled={disabled}
      aria-label="분석 출력 언어"
      className="h-8 rounded-xs border border-line bg-paper px-2 text-md text-ink disabled:opacity-40"
    >
      {OUTPUT_LANG_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// 조사 목적 + 소스/언어 필드 묶음 — idle 보드와 active slim bar 가 공유.
function ControlFields({
  researchGoal,
  onResearchGoalChange,
  goalDisabled,
  source,
  onSourceChange,
  outputLang,
  onOutputLangChange,
  controlsDisabled,
}: {
  researchGoal: string;
  onResearchGoalChange: (next: string) => void;
  goalDisabled: boolean;
  source: SourceKind;
  onSourceChange: (next: SourceKind) => void;
  outputLang: ProbingOutputLang;
  onOutputLangChange: (next: ProbingOutputLang) => void;
  controlsDisabled: boolean;
}) {
  return (
    <>
      <Field label="조사 목적" description="이 인터뷰로 알고자 하는 것 (1~2 문장)">
        <Textarea
          value={researchGoal}
          onChange={(e) => onResearchGoalChange(e.target.value.slice(0, GOAL_MAX))}
          rows={2}
          maxLength={GOAL_MAX}
          disabled={goalDisabled}
          placeholder="예: 가성비 vs 프리미엄 선택 기준 이해"
          className="resize-none text-md"
        />
      </Field>
      <div className="flex flex-wrap gap-4">
        <Field label="입력 소스">
          <SourcePicker
            value={source}
            onChange={onSourceChange}
            disabled={controlsDisabled}
          />
        </Field>
        <Field label="언어">
          <OutputLangPicker
            value={outputLang}
            onChange={onOutputLangChange}
            disabled={controlsDisabled}
          />
        </Field>
      </div>
    </>
  );
}

// ─── Phase 1 (idle) — 컨트롤 보드 ───
export function ProbingControlBoard({
  researchGoal,
  onResearchGoalChange,
  goalDisabled,
  source,
  onSourceChange,
  outputLang,
  onOutputLangChange,
  controlsDisabled,
  onStart,
  startDisabled,
  statusLabel,
}: {
  researchGoal: string;
  onResearchGoalChange: (next: string) => void;
  goalDisabled: boolean;
  source: SourceKind;
  onSourceChange: (next: SourceKind) => void;
  outputLang: ProbingOutputLang;
  onOutputLangChange: (next: ProbingOutputLang) => void;
  controlsDisabled: boolean;
  onStart: () => void;
  startDisabled: boolean;
  statusLabel: string | null;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-4 border-b-[2px] border-ink bg-paper-soft px-5 py-4">
      <ControlFields
        researchGoal={researchGoal}
        onResearchGoalChange={onResearchGoalChange}
        goalDisabled={goalDisabled}
        source={source}
        onSourceChange={onSourceChange}
        outputLang={outputLang}
        onOutputLangChange={onOutputLangChange}
        controlsDisabled={controlsDisabled}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-mute">{statusLabel ?? ''}</span>
        <ChromeButton
          variant="default"
          size="lg"
          onClick={onStart}
          disabled={startDisabled}
        >
          🚀 세션 시작
        </ChromeButton>
      </div>
    </div>
  );
}

// ─── Phase 2 (active) — slim bar + 펼침 컨트롤 ───
export function ProbingControlBar({
  researchGoal,
  onResearchGoalChange,
  source,
  onSourceChange,
  outputLang,
  onOutputLangChange,
  controlsDisabled,
  onStop,
  stopDisabled,
  statusLabel,
}: {
  researchGoal: string;
  onResearchGoalChange: (next: string) => void;
  source: SourceKind;
  onSourceChange: (next: SourceKind) => void;
  outputLang: ProbingOutputLang;
  onOutputLangChange: (next: ProbingOutputLang) => void;
  controlsDisabled: boolean;
  onStop: () => void;
  stopDisabled: boolean;
  statusLabel: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="shrink-0 border-b-[2px] border-ink bg-paper-soft">
      <div className="flex items-center justify-between gap-2 px-5 py-2.5">
        <Button
          variant="link"
          size="xs"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="normal-case tracking-normal"
        >
          ⚙ 컨트롤 (조사 목적 · 마이크) {open ? '▲' : '▼'}
        </Button>
        <div className="flex items-center gap-2">
          {statusLabel && <span className="text-xs text-mute">{statusLabel}</span>}
          <ChromeButton size="lg" onClick={onStop} disabled={stopDisabled}>
            정지
          </ChromeButton>
        </div>
      </div>

      {open && (
        <div className="flex flex-col gap-4 border-t border-ink/10 px-5 py-3">
          <ControlFields
            researchGoal={researchGoal}
            onResearchGoalChange={onResearchGoalChange}
            // 조사 목적은 라이브 중에도 편집 가능 (다음 think tick 에 반영).
            goalDisabled={false}
            source={source}
            onSourceChange={onSourceChange}
            outputLang={outputLang}
            onOutputLangChange={onOutputLangChange}
            controlsDisabled={controlsDisabled}
          />
          {controlsDisabled && (
            <p className="text-xs text-mute-soft">
              세션 중에는 입력 소스·언어를 바꿀 수 없어요 — 다음 세션부터 적용됩니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
