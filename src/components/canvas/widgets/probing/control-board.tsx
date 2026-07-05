'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingControlPanel — probing 위젯의 세션 컨트롤 (상시 노출).

   PR (widget-remove-subheader-persistent-controls): 옛 서브헤더 slim bar
   (⚙ 요약 ▼ 로 접었다 펴는) 구조를 완전 폐기. 컨트롤(조사 목적 / 입력 소스 /
   언어)은 phase 무관 항상 카드 상단에 노출되고, CTA 만 세션 상태에 따라
   🚀 세션 시작 ↔ 정지 로 바뀐다. 라이브 중에도 컨트롤이 그대로 보여 조사
   목적은 즉시(다음 think tick) 반영된다.

   입력 소스 / 언어 dropdown 은 ui SelectMenu primitive (위젯 컨트롤 primitive
   통일 spec — 옛 SourcePicker / OutputLangPicker local 함수 폐기). 세션 진행
   중 (idle/error 외) 에는 소스/언어 disabled — 옛 동작 그대로. 조사 목적은
   라이브 중에도 편집 가능.
   ──────────────────────────────────────────────────────────────────── */

import { Field } from '@/components/canvas/shell/field';
import { Textarea } from '@/components/ui/textarea';
import { ChromeButton } from '@/components/ui/chrome-button';
import { SelectMenu } from '@/components/ui/select-menu';
import type { ProbingOutputLang } from '@/lib/probing-prompts';

export type SourceKind = 'mic' | 'tab';

const GOAL_MAX = 2_000;

const SOURCE_OPTIONS: { value: SourceKind; label: string }[] = [
  { value: 'mic', label: '마이크' },
  { value: 'tab', label: '탭 오디오' },
];

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
          {/* min-w: 옛 native select 은 widest-option 고정폭 — 선택 값에 따라
              trigger 폭이 출렁이지 않도록 하한만 고정 */}
          <div className="min-w-24">
            <SelectMenu
              aria-label="입력 소스"
              value={source}
              onChange={(next) => onSourceChange(next as SourceKind)}
              options={SOURCE_OPTIONS}
              disabled={controlsDisabled}
            />
          </div>
        </Field>
        <Field label="언어">
          <div className="min-w-24">
            <SelectMenu
              aria-label="분석 출력 언어"
              value={outputLang}
              onChange={(next) => onOutputLangChange(next as ProbingOutputLang)}
              options={OUTPUT_LANG_OPTIONS}
              disabled={controlsDisabled}
            />
          </div>
        </Field>
      </div>
    </>
  );
}

// ─── 상시 컨트롤 패널 — 조사 목적 / 소스 / 언어 + 세션 CTA ───
// isLive 무관 항상 노출. CTA 만 idle→🚀 세션 시작, live→정지 로 전환.
// 조사 목적은 라이브 중에도 편집 가능(goalDisabled 는 hydration 대기용);
// 입력 소스·언어는 세션 중(controlsDisabled) disabled + 안내 문구.
export function ProbingControlPanel({
  researchGoal,
  onResearchGoalChange,
  goalDisabled,
  source,
  onSourceChange,
  outputLang,
  onOutputLangChange,
  controlsDisabled,
  isLive,
  onStart,
  startDisabled,
  onStop,
  stopDisabled,
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
  isLive: boolean;
  onStart: () => void;
  startDisabled: boolean;
  onStop: () => void;
  stopDisabled: boolean;
  statusLabel: string | null;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-4 px-5 py-4">
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
      {controlsDisabled && (
        <p className="text-xs text-mute-soft">
          세션 중에는 입력 소스·언어를 바꿀 수 없어요 — 다음 세션부터 적용됩니다.
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-mute">{statusLabel ?? ''}</span>
        {isLive ? (
          <ChromeButton size="lg" onClick={onStop} disabled={stopDisabled}>
            정지
          </ChromeButton>
        ) : (
          <ChromeButton
            variant="default"
            size="lg"
            onClick={onStart}
            disabled={startDisabled}
          >
            🚀 세션 시작
          </ChromeButton>
        )}
      </div>
    </div>
  );
}
