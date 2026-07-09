'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingControlPanel — probing 위젯의 세션 컨트롤 (상시 노출).

   PR (widget-remove-subheader-persistent-controls): 옛 서브헤더 slim bar
   (⚙ 요약 ▼ 로 접었다 펴는) 구조를 완전 폐기. 컨트롤(조사 목적 / 입력 소스 /
   언어)은 phase 무관 항상 카드 상단에 노출되고, CTA 만 세션 상태에 따라
   🚀 세션 시작 ↔ 정지 로 바뀐다. 라이브 중에도 컨트롤이 그대로 보여, 조사
   목적을 편집한 뒤 "적용" 을 누르면 다음 think tick 에 반영된다 (자동저장 →
   명시적 버튼 커밋 — research-context.tsx 전체보기와 동일 패턴).

   입력 소스 / 언어 dropdown 은 ui SelectMenu primitive (위젯 컨트롤 primitive
   통일 spec — 옛 SourcePicker / OutputLangPicker local 함수 폐기). 세션 진행
   중 (idle/error 외) 에는 소스/언어 disabled — 옛 동작 그대로. 조사 목적은
   라이브 중에도 편집 가능.
   ──────────────────────────────────────────────────────────────────── */

import { useState } from 'react';
import { Field } from '@/components/canvas/shell/field';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ChromeButton } from '@/components/ui/chrome-button';
import { SelectMenu } from '@/components/ui/select-menu';
import { CONTROL_TRIGGER_CLASS } from '@/components/ui/control-trigger';
import type { ProbingOutputLang } from '@/lib/probing-prompts';
import { PersonaSectionConfigurator } from './persona-section-configurator';
import type { ProbingCustomSection } from '../probing-types';

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
  // 조사 목적 = draft + 명시적 "적용" 버튼 커밋 (research-context.tsx 전체보기와
  // 동일 패턴). 타이핑은 goalDraft 만 갱신하고 (키 입력마다 자동저장하지 않음),
  // "적용" 클릭 시에만 onResearchGoalChange 를 1회 호출한다. 외부 로드/세션
  // 전환으로 researchGoal prop 이 바뀌면 render 중 감지로 draft 동기
  // (effect 내 동기 setState 를 막는 design-system lint 룰 회피).
  const [goalDraft, setGoalDraft] = useState(researchGoal);
  const [syncedGoal, setSyncedGoal] = useState(researchGoal);
  if (researchGoal !== syncedGoal) {
    setSyncedGoal(researchGoal);
    setGoalDraft(researchGoal);
  }
  const goalDirty = goalDraft !== researchGoal;
  const canApplyGoal = goalDirty && !goalDisabled;

  function applyGoal() {
    if (!canApplyGoal) return;
    const value = goalDraft.trim().slice(0, GOAL_MAX);
    onResearchGoalChange(value);
    setGoalDraft(value);
  }

  return (
    <>
      {/* 입력 소스 / 언어 드롭다운 = 최상단 (전사록 언어 · 인터뷰 프로젝트
          dropdown-first 미러 — 사용자 결정 2026-07-08). 조사 목적 입력은 그
          아래로 이동.
          밸런스 튜닝(desk 미러): SelectMenu 를 기본 h-8 → h-10 으로 확대해
          넓어진 클러스터 대비 왜소함 해소. SelectMenu 는 공유 primitive 라
          SIZE 맵을 건드리지 않고 buttonClassName 로컬 오버라이드(CONTROL_TRIGGER_
          CLASS = 전사록/인터뷰 ControlTrigger 와 동일 chrome)로 프로빙 안에서만
          키운다 (타 위젯 영향 0 = "프로빙 단독" 제약). 데스크 지역/기간
          드롭다운과 동일 h-10 규격. */}
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
              buttonClassName={CONTROL_TRIGGER_CLASS}
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
              buttonClassName={CONTROL_TRIGGER_CLASS}
            />
          </div>
        </Field>
      </div>
      {/* 조사 목적 = 핵심 입력, 드롭다운 아래 배치. 밸런스 튜닝(desk 미러):
          넓어진 클러스터 (max-w-2xl) 대비 왜소함을 해소하려 rows 2 → 3 으로
          확대 — 데스크 키워드 input 확대(min-h 44→52) 와 같은 계열. 폭은
          fullWidth 로 이미 클러스터를 채운다. */}
      <Field label="조사 목적">
        <Textarea
          value={goalDraft}
          onChange={(e) => setGoalDraft(e.target.value.slice(0, GOAL_MAX))}
          rows={3}
          maxLength={GOAL_MAX}
          disabled={goalDisabled}
          placeholder="예: 가성비 vs 프리미엄 선택 기준 이해"
          className="resize-none text-md"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="text-xs text-mute" aria-live="polite">
            {goalDirty ? "미적용 변경 — '적용' 을 눌러 반영" : ''}
          </p>
          <Button
            variant="primary"
            size="sm"
            onClick={applyGoal}
            disabled={!canApplyGoal}
            title="입력한 조사 목적을 지금 반영"
          >
            적용
          </Button>
        </div>
      </Field>
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
  onStop,
  stopDisabled,
  statusLabel,
  customSections,
  hiddenSectionKeys,
  onHideSection,
  onRestoreSection,
  onRemoveCustomSection,
  onAddCustomSection,
  customSectionsFull,
  sectionConfigDisabled,
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
  onStop: () => void;
  stopDisabled: boolean;
  statusLabel: string | null;
  // ─── 페르소나 섹션 구성 (PR #470) — active-section SSOT 구성기 ───
  // 기본 9 on/off (숨김/복원) + custom add/remove 를 컨트롤 패널에서 관리.
  // 이 활성 목록이 전체보기 위젯 렌더 · persona 요청 · 데이터 적재를 관통.
  customSections: ProbingCustomSection[];
  hiddenSectionKeys: Set<string>;
  onHideSection: (key: string) => void;
  onRestoreSection: (key: string) => void;
  onRemoveCustomSection: (key: string) => void;
  onAddCustomSection: (title: string, description?: string) => void;
  customSectionsFull: boolean;
  sectionConfigDisabled: boolean;
}) {
  // 프레임(외곽 padding/폭/정렬/세로채움)은 ControlBoardPanel SSOT 소유 —
  // 여기서 px-5 py-4 / shrink-0 를 직접 지정하지 않는다 (idle=active 프레임
  // 불변). 이 컴포넌트는 컨트롤 클러스터의 내부 3-구성(필드/안내/CTA) 세로
  // 리듬(gap-5)만 소유. idle·active 모두 <ControlBoardPanel> 경유.
  return (
    <div className="flex flex-col gap-5">
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
      {/* 페르소나 섹션 구성 — 옛 전체보기 좌패널 (× / 위젯 추가 / 숨김 복원)
          을 컨트롤 패널로 이전. 세션 중에도 편집 가능 (다음 갱신 tick 에 반영).
          data-canvas-body 밖 (컨트롤 패널) 이라 ModeButton 이 amore/paper
          토큰 룩으로 렌더 (globals.css memphis chrome 미적용). */}
      <PersonaSectionConfigurator
        customSections={customSections}
        hiddenKeys={hiddenSectionKeys}
        onHideDefault={onHideSection}
        onRestoreDefault={onRestoreSection}
        onRemoveCustom={onRemoveCustomSection}
        onAddCustom={onAddCustomSection}
        customFull={customSectionsFull}
        disabled={sectionConfigDisabled}
      />
      {/* 세션 CTA — live: 정지 (여기 유지). idle: 세션 시작 은 WidgetPrimaryCta
          (우측 중앙 고정 앵커) 로 이동 = 6 위젯 주 CTA 통일. */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-mute">{statusLabel ?? ''}</span>
        {isLive && (
          <ChromeButton size="lg" onClick={onStop} disabled={stopDisabled}>
            정지
          </ChromeButton>
        )}
      </div>
    </div>
  );
}
