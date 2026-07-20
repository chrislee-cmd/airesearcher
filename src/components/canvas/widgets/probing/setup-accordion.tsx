'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingSetupAccordion — probing 위젯 idle/setup 을 유스케이스 4-스텝
   아코디언으로 (V2 세팅 PR-B). live 표면은 감싸지 않는다 (라이브 회귀 0).

   STEP1 프로젝트(기존 ProjectPicker/useProjectSelection) · STEP2 인터뷰 방식
   (CaptureUseCaseCards, PR-A 재사용) · STEP3 언어(기존 단일 outputLang —
   결정③: 둘째 드롭다운은 프로토에만 존재, production 은 이미 단일) · STEP4
   질문 리스트(결정②: research_goal freetext 대체).

   시작 게이트(ready)는 기존과 동일 = source + outputLang. 프로젝트/질문은
   게이트 아님(프로젝트=로컬 fallback, 질문=선택). CTA/푸터는 부모(probing-card)
   가 WidgetPrimaryCta 로 렌더 — 이 컴포넌트는 아코디언 스텝만.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import {
  WidgetAccordion,
  useWidgetAccordion,
  type AccordionStepConfig,
} from '@/components/canvas/shell/widget-accordion';
import { Field } from '@/components/canvas/shell/field';
import { SelectMenu } from '@/components/ui/select-menu';
import { CONTROL_TRIGGER_CLASS } from '@/components/ui/control-trigger';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { ProjectPicker } from '@/components/project-picker';
import {
  CaptureUseCaseCards,
  type CaptureUseCaseOption,
} from '@/components/ui/capture-usecase-cards';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { useProjectSelection } from '@/components/project-selection-provider';
import type { ProbingOutputLang } from '@/lib/probing-prompts';
import type { SourceKind } from './control-board';

const QUESTION_MAX = 500;
const QUESTIONS_MAX_COUNT = 30;

// 분석 출력 언어 옵션 — endonym (자국어 표기, 번역 안 함). control-board 와 동일.
const OUTPUT_LANG_OPTIONS: { value: ProbingOutputLang; label: string }[] = [
  // i18n-allow-korean -- 언어 선택기 endonym (자국어 표기 유지, 번역 안 함)
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
  { value: 'es', label: 'Español' },
  { value: 'th', label: 'ไทย' },
];

// 질문 리스트 — 입력 + 추가 버튼 + 번호배지 행 (프로토 D7). ui primitive 만
// (Input/Button/IconButton). 긴 리스트는 내부 스크롤(max-h + overflow).
function InjectedQuestionsField({
  questions,
  onChange,
  draft,
  onDraftChange,
}: {
  questions: string[];
  onChange: (next: string[]) => void;
  draft: string;
  onDraftChange: (next: string) => void;
}) {
  const t = useTranslations('Probing');

  function addQuestion() {
    const v = draft.trim().slice(0, QUESTION_MAX);
    if (!v) return;
    if (questions.length >= QUESTIONS_MAX_COUNT) return;
    onChange([...questions, v]);
    onDraftChange('');
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <Input
          value={draft}
          onChange={(e) => onDraftChange(e.target.value.slice(0, QUESTION_MAX))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addQuestion();
            }
          }}
          maxLength={QUESTION_MAX}
          placeholder={t('setup.questionPlaceholder')}
          aria-label={t('setup.step4Title')}
          size="sm"
        />
        <Button
          variant="primary"
          size="sm"
          onClick={addQuestion}
          disabled={!draft.trim() || questions.length >= QUESTIONS_MAX_COUNT}
          className="shrink-0 whitespace-nowrap"
        >
          {t('setup.questionAdd')}
        </Button>
      </div>
      {questions.length > 0 ? (
        <ul className="flex max-h-40 flex-col gap-2 overflow-y-auto">
          {questions.map((q, i) => (
            <li
              key={`${i}-${q}`}
              className="flex items-center gap-3 rounded-sm border border-line-soft bg-paper-soft px-3 py-2.5"
            >
              <span
                aria-hidden
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-paper"
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 break-words text-sm text-ink">
                {q}
              </span>
              <IconButton
                aria-label={t('setup.questionRemove')}
                size="sm"
                variant="ghost"
                onClick={() => onChange(questions.filter((_, j) => j !== i))}
                className="shrink-0"
              >
                <span aria-hidden>✕</span>
              </IconButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-sm border border-dashed border-line-soft px-4 py-4 text-center text-xs text-mute-soft">
          {t('setup.questionEmpty')}
        </p>
      )}
    </div>
  );
}

export function ProbingSetupAccordion({
  projectId,
  onProjectChange,
  source,
  onSourceChange,
  outputLang,
  onOutputLangChange,
  questions,
  onQuestionsChange,
  questionDraft,
  onQuestionDraftChange,
}: {
  projectId: string | null;
  onProjectChange: (projectId: string | null) => void;
  source: SourceKind | '';
  onSourceChange: (next: SourceKind) => void;
  outputLang: ProbingOutputLang | '';
  onOutputLangChange: (next: ProbingOutputLang) => void;
  questions: string[];
  onQuestionsChange: (next: string[]) => void;
  questionDraft: string;
  onQuestionDraftChange: (next: string) => void;
}) {
  const t = useTranslations('Probing');
  const tc = useTranslations('CaptureUseCase');
  const { projects } = useInterviewV2Projects();
  const { selection } = useProjectSelection();
  const accordion = useWidgetAccordion();

  // 입력 소스 = 유스케이스 3-카드 (CaptureUseCaseCards, PR-A). control-board 와
  // 동일 매핑 — mic→오프라인 / both→온라인 / tab→참관.
  const SOURCE_USECASE_OPTIONS: CaptureUseCaseOption[] = [
    {
      id: 'mic',
      icon: '🤝',
      title: tc('offlineTitle'),
      hostVia: tc('hostVia', { via: tc('viaMic') }),
      guestVia: tc('guestVia', { via: tc('viaMic') }),
      // R6/D4(사용자 결정): 대면 카드 = 2줄만. offlineNote("화자 구분 없음")는
      // 프로토(Canvas 1c) 대로 카드에서 제거 (translate-console 와 동일 정합).
    },
    {
      id: 'both',
      icon: '💻',
      title: tc('onlineTitle'),
      hostVia: tc('hostVia', { via: tc('viaMic') }),
      guestVia: tc('guestVia', { via: tc('viaTab') }),
      note: tc('onlineNote'),
    },
    {
      id: 'tab',
      icon: '👀',
      title: tc('observeTitle'),
      hostVia: tc('hostVia', { via: tc('viaTab') }),
      guestVia: tc('guestVia', { via: tc('viaTab') }),
    },
  ];

  const projectName =
    projects.find((p) => p.id === projectId)?.name ??
    t('setup.step1Selected');
  // 크로스위젯 "일괄 적용" 반영(프로토 A.1) — 등장한 모든 위젯 선택이 이 위젯의
  // 프로젝트와 동일하면 done 요약에 "· 일괄" 태그. applyToAll 로 맞춰진 상태.
  const selValues = Object.values(selection);
  const appliedToAll =
    projectId != null &&
    selValues.length > 0 &&
    selValues.every((v) => v === projectId);
  const projectSummary = appliedToAll
    ? `${projectName} · ${t('setup.step1BulkTag')}`
    : projectName;
  const sourceTitle =
    SOURCE_USECASE_OPTIONS.find((o) => o.id === source)?.title ?? '';
  const langLabel =
    OUTPUT_LANG_OPTIONS.find((o) => o.value === outputLang)?.label ?? '';

  const steps: AccordionStepConfig[] = [
    {
      key: 'project',
      eyebrow: t('setup.stepEyebrow', { n: 1, label: t('setup.step1Short') }),
      title: t('setup.step1Title'),
      summary: projectSummary,
      body: (
        <Field label={t('control.fieldProject')}>
          <ProjectPicker
            widget="probing"
            value={projectId}
            onChange={onProjectChange}
          />
        </Field>
      ),
    },
    {
      key: 'method',
      eyebrow: t('setup.stepEyebrow', { n: 2, label: t('setup.step2Short') }),
      title: t('setup.step2Title'),
      summary: sourceTitle,
      body: (
        <Field label={tc('sectionLabel')}>
          <CaptureUseCaseCards
            ariaLabel={tc('groupAria')}
            value={source}
            onChange={(id) => onSourceChange(id as SourceKind)}
            options={SOURCE_USECASE_OPTIONS}
          />
        </Field>
      ),
    },
    {
      key: 'language',
      eyebrow: t('setup.stepEyebrow', { n: 3, label: t('setup.step3Short') }),
      title: t('setup.step3Title'),
      summary: langLabel,
      body: (
        <Field label={t('control.fieldLanguage')}>
          <SelectMenu
            aria-label={t('control.outputLangAria')}
            value={outputLang}
            placeholder={t('control.select')}
            onChange={(next) => onOutputLangChange(next as ProbingOutputLang)}
            options={OUTPUT_LANG_OPTIONS}
            buttonClassName={CONTROL_TRIGGER_CLASS}
          />
        </Field>
      ),
    },
    {
      key: 'questions',
      eyebrow: t('setup.stepEyebrow', { n: 4, label: t('setup.step4Short') }),
      title: t('setup.step4Title'),
      optional: true,
      summary: t('setup.questionSummary', { count: questions.length }),
      body: (
        <InjectedQuestionsField
          questions={questions}
          onChange={onQuestionsChange}
          draft={questionDraft}
          onDraftChange={onQuestionDraftChange}
        />
      ),
    },
  ];

  // 완료 판정 (요약 접힘 vs 펼침 + 노드 색). 첫 미완=active / 나머지 미완=todo
  // 노드 계산은 WidgetAccordion 이 처리.
  const isComplete = (index: number): boolean =>
    index === 0
      ? projectId != null
      : index === 1
        ? source !== ''
        : index === 2
          ? outputLang !== ''
          : questions.length > 0;

  return (
    <WidgetAccordion
      steps={steps}
      isExpanded={accordion.isExpanded}
      isComplete={isComplete}
      onOpenStep={accordion.open}
      onCollapseAll={accordion.collapseAll}
      changeLabel={t('setup.change')}
      optionalLabel={t('setup.optional')}
    />
  );
}
