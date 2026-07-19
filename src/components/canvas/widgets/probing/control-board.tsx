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
import { useTranslations } from 'next-intl';
import { ControlBoardPanel } from '@/components/canvas/shell/control-board-panel';
import { Field } from '@/components/canvas/shell/field';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ChromeButton } from '@/components/ui/chrome-button';
import { SelectMenu } from '@/components/ui/select-menu';
import { CONTROL_TRIGGER_CLASS } from '@/components/ui/control-trigger';
import { ProjectPicker } from '@/components/project-picker';
import type { ProbingOutputLang } from '@/lib/probing-prompts';
import { PersonaSectionConfigurator } from './persona-section-configurator';
import type { ProbingCustomSection } from '../probing-types';

// mic(진행자) / tab(응답자) / both(진행자+응답자 병렬 — 원격 화상 인터뷰 양방향).
// both 는 mic+tab 두 병렬 realtime 세션을 띄우고 화자분리한다
// (pr-probing-mic-plus-tab-dual-capture).
export type SourceKind = 'mic' | 'tab' | 'both';

const GOAL_MAX = 2_000;

// 분석 출력 언어 옵션 — translate 의 LANGS 6종과 동일. 입력 (STT) 언어와
// 독립적으로 분석 결과 언어를 선택 (예: 한국어 인터뷰 → 영어 분석).
// 라벨은 언어 endonym (각 언어를 자국어 표기로 노출) — 번역하지 않는다.
const OUTPUT_LANG_OPTIONS: { value: ProbingOutputLang; label: string }[] = [
  // i18n-allow-korean -- 언어 선택기 endonym (자국어 표기 유지, 번역 안 함)
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
  { value: 'es', label: 'Español' },
  { value: 'th', label: 'ไทย' },
];

// 조사 목적 + 프로젝트/소스/언어 필드 묶음 — idle 보드와 active slim bar 가 공유.
function ControlFields({
  researchGoal,
  onResearchGoalChange,
  goalDisabled,
  source,
  onSourceChange,
  outputLang,
  onOutputLangChange,
  controlsDisabled,
  projectId,
  onProjectChange,
}: {
  researchGoal: string;
  onResearchGoalChange: (next: string) => void;
  goalDisabled: boolean;
  // 미선택('') 기본 — placeholder "선택" 노출. 선택 시에만 실제 value 발화.
  source: SourceKind | '';
  onSourceChange: (next: SourceKind) => void;
  outputLang: ProbingOutputLang | '';
  onOutputLangChange: (next: ProbingOutputLang) => void;
  controlsDisabled: boolean;
  // 프로젝트 설정 (#542) — 언어/입력소스와 같은 flex 행 첫 필드로 합류(#593,
  // 동시통역 #587 통일). value/onChange 는 부모(probing-card) 소유.
  projectId: string | null;
  onProjectChange: (projectId: string | null) => void;
}) {
  const t = useTranslations('Probing');
  // 라벨은 동시통역(#537)과 통일. value(mic/tab)는 STT/분석 분기용이라 유지,
  // 표시 라벨만 로케일별로.
  const SOURCE_OPTIONS: { value: SourceKind; label: string }[] = [
    { value: 'mic', label: t('control.sourceMic') },
    { value: 'tab', label: t('control.sourceTab') },
    // both = 진행자(mic) + 응답자(tab) 병렬 캡처 + 화자분리.
    { value: 'both', label: t('control.sourceBoth') },
  ];
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
      {/* 순서: 프로젝트 → 언어 → 입력 소스 한 행 (동시통역 #587 과 통일 —
          사용자 결정 2026-07-12, #593). 옛 별도 프로젝트 행을 이 flex 행 첫
          필드로 합류. flex flex-wrap gap-4 유지 → 데스크 3열 한 줄, 좁은 폭
          자연 wrap. 언어/입력소스는 기본 미선택('') + placeholder "선택" —
          하나라도 미선택이면 세션 시작 CTA 가 비활성(게이트는 부모 probing-card
          소유). 프로젝트는 미선택=로컬 fallback 이라 게이트 대상 아님.
          드롭다운 간 간격·정렬은 ControlBoardPanel.Settings 슬롯 SSOT
          (SETTINGS_ROW_GAP + items-end) — 손코딩 flex gap 제거. */}
      <ControlBoardPanel.Settings>
        {/* 프로젝트 설정 (#542) — 페르소나 섹션 구성을 프로젝트별로 분리.
            위젯 슬롯 'probing' 의 독립 선택. 미선택이면 이 기기(localStorage)
            에만 저장되고, 프로젝트를 고르면 그 프로젝트의 DB 설정으로 read/write.
            세션 중 disabled 게이트 없음 — 기존 동작 그대로(레이아웃만 변경). */}
        <Field label={t('control.fieldProject')}>
          <ProjectPicker
            widget="probing"
            value={projectId}
            onChange={onProjectChange}
          />
        </Field>
        <Field label={t('control.fieldLanguage')}>
          <div className="min-w-24">
            <SelectMenu
              aria-label={t('control.outputLangAria')}
              value={outputLang}
              placeholder={t('control.select')}
              onChange={(next) => onOutputLangChange(next as ProbingOutputLang)}
              options={OUTPUT_LANG_OPTIONS}
              disabled={controlsDisabled}
              buttonClassName={CONTROL_TRIGGER_CLASS}
            />
          </div>
        </Field>
        <Field label={t('control.fieldInputSource')}>
          {/* min-w: 옛 native select 은 widest-option 고정폭 — 선택 값에 따라
              trigger 폭이 출렁이지 않도록 하한만 고정 */}
          <div className="min-w-24">
            <SelectMenu
              aria-label={t('control.fieldInputSource')}
              value={source}
              placeholder={t('control.select')}
              onChange={(next) => onSourceChange(next as SourceKind)}
              options={SOURCE_OPTIONS}
              disabled={controlsDisabled}
              buttonClassName={CONTROL_TRIGGER_CLASS}
            />
          </div>
        </Field>
      </ControlBoardPanel.Settings>
      {/* 조사 목적 = 핵심 입력, 드롭다운 아래 배치. 밸런스 튜닝(desk 미러):
          넓어진 클러스터 대비 왜소함을 해소하려 rows 2 → 3 으로 확대 — 데스크
          키워드 input 확대(min-h 44→52) 와 같은 계열. 폭은 fullWidth 로 이미
          클러스터를 채운다. 라벨↔컨트롤 간격은 .Input(Field mb-1.5) SSOT. */}
      <ControlBoardPanel.Input label={t('control.fieldResearchGoal')}>
        <Textarea
          value={goalDraft}
          onChange={(e) => setGoalDraft(e.target.value.slice(0, GOAL_MAX))}
          rows={3}
          maxLength={GOAL_MAX}
          disabled={goalDisabled}
          placeholder={t('control.goalPlaceholder')}
          className="resize-none text-md"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="text-xs text-mute" aria-live="polite">
            {goalDirty ? t('control.unappliedChange') : ''}
          </p>
          <Button
            variant="primary"
            size="sm"
            onClick={applyGoal}
            disabled={!canApplyGoal}
            title={t('control.applyGoalTitle')}
          >
            {t('control.apply')}
          </Button>
        </div>
      </ControlBoardPanel.Input>
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
  slotKinds,
  slotActive,
  customSections,
  hiddenSectionKeys,
  onHideSection,
  onRestoreSection,
  onRemoveCustomSection,
  onAddCustomSection,
  customSectionsFull,
  sectionConfigDisabled,
  projectId,
  onProjectChange,
}: {
  researchGoal: string;
  onResearchGoalChange: (next: string) => void;
  goalDisabled: boolean;
  source: SourceKind | '';
  onSourceChange: (next: SourceKind) => void;
  outputLang: ProbingOutputLang | '';
  onOutputLangChange: (next: ProbingOutputLang) => void;
  controlsDisabled: boolean;
  isLive: boolean;
  onStop: () => void;
  stopDisabled: boolean;
  statusLabel: string | null;
  // ─── 슬롯별 라이브 표시등 (pr-probing-mic-plus-tab-dual-capture) ───
  // 실행 중인 캡처 모드의 각 슬롯을 화자 역할(🎤 진행자=mic / 📺 응답자=tab)로
  // 표시. both 면 두 배지가 나란히, 단일 모드면 그 슬롯 하나만. slotActive[slot]
  // = PC connected 여부 → 점 색으로 라이브/연결중 구분. isLive 일 때만 렌더.
  slotKinds: ('mic' | 'tab')[];
  slotActive: Record<'mic' | 'tab', boolean>;
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
  // ─── 프로젝트 설정 (#542) — 페르소나 섹션 구성의 프로젝트별 소스 ───
  // 선택된 projectId(없으면 null=로컬 fallback). 위젯별 독립 선택
  // (ProjectSelectionProvider 의 'probing' 슬롯) — 통역 등 타 위젯과 강제 sync X.
  projectId: string | null;
  onProjectChange: (projectId: string | null) => void;
}) {
  const t = useTranslations('Probing');
  // 프레임(외곽 padding/폭/정렬/세로채움)은 ControlBoardPanel SSOT 소유 —
  // 여기서 px-5 py-4 / shrink-0 를 직접 지정하지 않는다 (idle=active 프레임
  // 불변). 슬롯 간 세로 리듬도 손코딩(gap-5)하지 않고 cluster gap="field"
  // (부모 probing-card 에서 지정) 이 소유한다. 이 컴포넌트는 named 슬롯
  // (.Settings/.Input/.Region/.Action) 을 조합만 한다. idle·active 모두
  // <ControlBoardPanel> 경유.
  return (
    <>
      {/* 프로젝트/언어/입력소스는 ControlFields 안의 한 flex 행으로 통합
          (#593, 동시통역 #587 통일). 옛 별도 프로젝트 행은 제거. */}
      <ControlFields
        researchGoal={researchGoal}
        onResearchGoalChange={onResearchGoalChange}
        goalDisabled={goalDisabled}
        source={source}
        onSourceChange={onSourceChange}
        outputLang={outputLang}
        onOutputLangChange={onOutputLangChange}
        controlsDisabled={controlsDisabled}
        projectId={projectId}
        onProjectChange={onProjectChange}
      />
      {controlsDisabled && (
        <p className="text-xs text-mute-soft">
          {t('control.controlsLockedNote')}
        </p>
      )}
      {/* 슬롯별 라이브 표시등 — 실행 중인 캡처 모드의 각 슬롯을 화자 역할로
          표시(🎤 진행자=mic / 📺 응답자=tab). both 면 두 배지, 단일 모드면 하나.
          점 색으로 라이브(text-amore)/연결중(text-mute-soft) 구분. */}
      {isLive && slotKinds.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-3"
          role="group"
          aria-label={t('slotIndicator.groupAria')}
        >
          {slotKinds.map((slot) => {
            const isHost = slot === 'mic';
            const on = slotActive[slot];
            return (
              <span
                key={slot}
                className="inline-flex items-center gap-1.5 text-xs text-mute"
                aria-label={
                  isHost
                    ? t('slotIndicator.hostAria')
                    : t('slotIndicator.guestAria')
                }
              >
                <span aria-hidden>{isHost ? '🎤' : '📺'}</span>
                <span>
                  {isHost ? t('slotIndicator.host') : t('slotIndicator.guest')}
                </span>
                <span
                  aria-hidden
                  className={on ? 'text-amore' : 'text-mute-soft'}
                  title={
                    on
                      ? t('slotIndicator.live')
                      : t('slotIndicator.connecting')
                  }
                >
                  ●
                </span>
              </span>
            );
          })}
        </div>
      )}
      {/* 페르소나 섹션 구성 — 옛 전체보기 좌패널 (× / 위젯 추가 / 숨김 복원)
          을 컨트롤 패널로 이전. 세션 중에도 편집 가능 (다음 갱신 tick 에 반영).
          data-canvas-body 밖 (컨트롤 패널) 이라 ModeButton 이 amore/paper
          토큰 룩으로 렌더 (globals.css memphis chrome 미적용). .Region =
          "규격 프레임 + 콘텐츠 자유" — 그리드 내부 레이아웃은 위젯 자유. */}
      <ControlBoardPanel.Region>
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
      </ControlBoardPanel.Region>
      {/* 세션 CTA — live: 정지 (여기 유지). idle: 세션 시작 은 WidgetPrimaryCta
          (우측 중앙 고정 앵커) 로 이동 = 6 위젯 주 CTA 통일. 정렬은 .Action
          SSOT(between: 상태 좌 + 버튼 우). */}
      <ControlBoardPanel.Action align="between">
        <span className="text-xs text-mute">{statusLabel ?? ''}</span>
        {isLive && (
          <ChromeButton size="lg" onClick={onStop} disabled={stopDisabled}>
            {t('control.stop')}
          </ChromeButton>
        )}
      </ControlBoardPanel.Action>
    </>
  );
}
