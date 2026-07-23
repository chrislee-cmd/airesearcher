'use client';

/* ────────────────────────────────────────────────────────────────────
   UtSetupAccordion — AI UT(moderator_ai) idle/setup 을 유스케이스 4-스텝
   아코디언으로 (V2 세팅, U1). live/공유/리뷰 표면은 감싸지 않는다
   (캡처/세션 로직 회귀 0 — 이 컴포넌트는 setup 만).

   STEP1 프로젝트(공유 ProjectPicker/useProjectSelection — probing 과 동형,
   생성 payload 불변). STEP2 테스트 방식(CaptureUseCaseCards 패턴 재사용 —
   host="내 기기"→로컬 / guest="참가자 기기"→원격, mode 매핑의 유일 배타 축).
   STEP3 예상 언어(기존 UtLanguageSelect, 필수). STEP4 대상 URL + 과제
   (방식별 분기: host=URL 필수·사이트오디오 / guest=과제 필수·URL 선택).

   moderated/unmoderated 스텝은 없다 — 런타임 축으로 강등(합의). CTA/푸터는
   부모(UtSessionBody)가 WidgetPrimaryCta 로 렌더 — 이 컴포넌트는 스텝만.

   토큰만: 색/모서리/그림자 전부 design-system 어휘. 아이콘은 듀오톤(peach).
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import {
  WidgetAccordion,
  useWidgetAccordion,
  type AccordionStepConfig,
} from '@/components/canvas/shell/widget-accordion';
import { useState } from 'react';
import { Field } from '@/components/canvas/shell/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { ProjectPicker } from '@/components/project-picker';
import {
  CaptureUseCaseCards,
  type CaptureUseCaseOption,
} from '@/components/ui/capture-usecase-cards';
import { DuotoneIcon, type DuotoneIconName } from '@/components/ui/icons/duotone-icon';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { UtLanguageSelect } from './ut-language-select';
import { normalizeTargetUrl } from './use-ut-session';

// 테스트 방식 = 캡처 대상 기기(유일 배타 축). host→로컬(내 화면 self-capture),
// guest→원격(참가자 초대). 값 자체가 mode 매핑 키.
export type UtMethod = 'host' | 'guest';

// 듀오톤 아이콘 채움 = peach(스펙 §4). var(--widget-tone) 대신 명시 peach 토큰 —
// AI UT 세팅 카드/아이콘 톤 통일. 하드코딩 hex 0(토큰만).
const PEACH_FILL = 'var(--widget-header-bg-peach)';

export function UtSetupAccordion({
  surface,
  projectId,
  onProjectChange,
  method,
  onMethodChange,
  inputLanguage,
  onInputLanguage,
  targetUrl,
  onTargetUrl,
  taskGoal,
  onTaskGoal,
  supported,
}: {
  // card/fullview — input id 유일성 확보(양 표면 동시 마운트).
  surface: 'card' | 'fullview';
  projectId: string | null;
  onProjectChange: (projectId: string | null) => void;
  method: UtMethod | '';
  onMethodChange: (next: UtMethod) => void;
  inputLanguage: string;
  onInputLanguage: (next: string) => void;
  targetUrl: string;
  onTargetUrl: (next: string) => void;
  taskGoal: string;
  onTaskGoal: (next: string) => void;
  // 로컬 화면공유 지원 여부 — 미지원이면 host 입력 disabled(기존 가드).
  supported: boolean;
}) {
  const t = useTranslations('AiUt');
  const { projects } = useInterviewV2Projects();
  const accordion = useWidgetAccordion();

  // 테스트 방식 2-카드 — host/guest 두 옵션(CaptureUseCaseOption 슬롯 재사용).
  // desc 한 줄로 다른 방식 카드(인터뷰/전사)와 텍스트 양식 통일 — 고정 128
  // 카드에 제목만 있으면 빈약해 보여 친근한 한 줄 설명을 붙인다(desc → clamp-2).
  const METHOD_OPTIONS: CaptureUseCaseOption[] = [
    {
      id: 'host',
      icon: <DuotoneIcon name="host" size={24} fill={PEACH_FILL} />,
      title: t('method.hostTitle'),
      desc: t('method.hostDesc'),
    },
    {
      id: 'guest',
      icon: <DuotoneIcon name="guest" size={24} fill={PEACH_FILL} />,
      title: t('method.guestTitle'),
      desc: t('method.guestDesc'),
    },
  ];

  const projectName =
    projects.find((p) => p.id === projectId)?.name ??
    t('setup.step1Selected');
  const methodTitle =
    METHOD_OPTIONS.find((o) => o.id === method)?.title ?? '';

  const isGuest = method === 'guest';
  // 접힘 요약행 방식 아이콘 = 선택 방식(host/guest). CD `IV('guest'|'host', …)`.
  const methodIconName: DuotoneIconName = isGuest ? 'guest' : 'host';
  const urlValid = normalizeTargetUrl(targetUrl) !== null;

  const steps: AccordionStepConfig[] = [
    {
      key: 'project',
      eyebrow: t('setup.stepEyebrow', { n: 1, label: t('setup.step1Short') }),
      title: t('setup.step1Title'),
      summary: projectName,
      summaryIcon: <DuotoneIcon name="project" size={15} />,
      body: (
        <Field label={t('setup.step1Short')}>
          <ProjectPicker
            widget="moderator_ai"
            value={projectId}
            onChange={onProjectChange}
            fullWidth
          />
        </Field>
      ),
    },
    {
      key: 'method',
      eyebrow: t('setup.stepEyebrow', { n: 2, label: t('setup.step2Short') }),
      title: t('setup.step2Title'),
      summary: methodTitle,
      summaryIcon: <DuotoneIcon name={methodIconName} size={15} />,
      body: (
        <Field label={t('method.sectionLabel')}>
          <CaptureUseCaseCards
            ariaLabel={t('method.groupAria')}
            columns={2}
            value={method}
            onChange={(id) => onMethodChange(id as UtMethod)}
            options={METHOD_OPTIONS}
          />
        </Field>
      ),
    },
    {
      key: 'language',
      eyebrow: t('setup.stepEyebrow', { n: 3, label: t('setup.step3Short') }),
      title: t('setup.step3Title'),
      summary: t('language.label'),
      summaryIcon: <DuotoneIcon name="language" size={15} />,
      body: (
        <Field label={t('language.label')}>
          <UtLanguageSelect
            value={inputLanguage}
            onChange={onInputLanguage}
          />
        </Field>
      ),
    },
    {
      key: 'target',
      eyebrow: t('setup.stepEyebrow', { n: 4, label: t('setup.step4Short') }),
      title: t('setup.step4Title'),
      summary: isGuest
        ? taskGoal.trim().slice(0, 40) || t('setup.step4Short')
        : targetUrl || t('setup.step4Short'),
      summaryIcon: <DuotoneIcon name="target" size={15} />,
      body: (
        // CD utOpen(L369~373) 정합 — 모드 무관 고정 순서 URL → task.
        // 이전엔 guest task 를 URL 앞, host task 를 URL 뒤에 둔 두 per-mode
        // 블록이라 순서가 역전됐다. 단일 블록으로 합쳐 순서 통일 —
        // 모드별 정당한 차이(URL disabled/ariaLabel, task label/placeholder/게이트)만 유지.
        <div className="flex flex-col gap-4">
          <UrlAddField
            id={`ut-url-${surface}`}
            value={targetUrl}
            onChange={onTargetUrl}
            disabled={!isGuest && !supported}
            addLabel={t('url.add')}
            removeLabel={t('url.remove')}
            ariaLabel={isGuest ? t('remote.url.label') : t('url.label')}
          />
          {/* 과제 입력 — 단일 블록, URL 뒤 무조건. guest=참가자 과제(필수,
              게이트) / host=테스트 과제(옵셔널, 분석 컨텍스트). state 는 공통 taskGoal. */}
          <Field label={isGuest ? t('remote.task.label') : t('host.task.label')}>
            <Textarea
              id={`ut-task-${surface}`}
              value={taskGoal}
              onChange={(e) => onTaskGoal(e.target.value)}
              placeholder={
                isGuest ? t('remote.task.placeholder') : t('host.task.placeholder')
              }
              rows={3}
            />
          </Field>
        </div>
      ),
    },
  ];

  // 완료 판정 (요약 접힘 vs 펼침 + 노드 색). STEP4 는 방식별 게이트 짝:
  // host=URL 유효 / guest=과제 입력. 프로젝트는 게이트 아님(선택=로컬 fallback)
  // 이지만 선택 시 요약 접힘.
  const isComplete = (index: number): boolean =>
    index === 0
      ? projectId != null
      : index === 1
        ? method !== ''
        : index === 2
          ? inputLanguage !== ''
          : method === 'guest'
            ? taskGoal.trim().length > 0
            : method === 'host'
              ? urlValid
              : false;

  return (
    <WidgetAccordion
      steps={steps}
      isExpanded={accordion.isExpanded}
      isComplete={isComplete}
      onOpenStep={accordion.open}
      onCollapseStep={accordion.collapse}
      changeLabel={t('setup.change')}
      optionalLabel={t('setup.optional')}
    />
  );
}

// 대상 URL 입력 — interpreter glossary(GlossaryField) 와 동형의 "타입 후 Add"
// 어포던스. 단 URL 은 단일값이라 maxItems=1: 추가하면 제거 가능한 칩 1개로 고정되고
// 입력행은 숨는다(칩 ✕ 로 제거하면 다시 입력행). 데이터 모델은 기존 단일 string
// (targetUrl) 그대로 — 세션 payload/normalizeTargetUrl 계약 불변.
// 라벨(Field)은 두지 않는다(사용자 요청: "target site url" 서브텍스트 제거).
// 접근성용 aria-label 은 input/chip 에 부여.
function UrlAddField({
  id,
  value,
  onChange,
  disabled,
  addLabel,
  removeLabel,
  ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  addLabel: string;
  removeLabel: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState('');

  function add() {
    if (disabled) return;
    const url = draft.trim();
    if (!url) return;
    onChange(url);
    setDraft('');
  }

  // 이미 추가된 URL → 제거 가능한 칩 (glossary 칩과 동일 스타일 토큰).
  if (value) {
    return (
      <ul className="flex flex-wrap gap-2">
        <li className="inline-flex items-center gap-1 rounded-pill border border-ink bg-paper-soft py-1 pl-3 pr-1 text-sm text-ink">
          <span className="break-all" aria-label={ariaLabel}>
            {value}
          </span>
          {/* CD kwChip 정합(제자리 교정): border-line→border-ink(먹색 아웃라인),
              boxed ghost ✕ → 무박스 plain × + text-mute-soft 그레이(#a3a7ad
              매핑). glossary 칩과 동일 토큰(형제 일관). */}
          <IconButton
            aria-label={`${removeLabel}: ${value}`}
            size="sm"
            variant="plain"
            disabled={disabled}
            onClick={() => onChange('')}
            className="shrink-0 text-mute-soft"
          >
            <span aria-hidden>×</span>
          </IconButton>
        </li>
      </ul>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <Input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        placeholder="https://example.com"
        aria-label={ariaLabel}
        inputMode="url"
        autoComplete="off"
        disabled={disabled}
        size="sm"
      />
      <Button
        variant="primary"
        size="sm"
        onClick={add}
        disabled={disabled || !draft.trim()}
        className="shrink-0 whitespace-nowrap"
      >
        {addLabel}
      </Button>
    </div>
  );
}
