'use client';

/* ────────────────────────────────────────────────────────────────────
   TranscriptSetupAccordion — 전사록(quotes) 위젯 idle/setup 을 유스케이스
   4-스텝 아코디언으로 (위젯 세팅 V2, Canvas 1c). 진행/완료 표면(StageFlow·
   완료 히어로·산출물)은 감싸지 않는다 — 전사 잡 로직 회귀 0.

   STEP1 프로젝트(공유 ProjectPicker) · STEP2 전사 방식(2-카드,
   TranscriptMethodCards) · STEP3 분석 언어(원본 오디오 언어 드롭다운) ·
   STEP4 업로드/녹음(드롭존 + — or — + 직접 녹음, 부모 배선 슬롯).

   업로드/녹음/잡 생성은 부모(quotes-card-body)가 소유 — 이 컴포넌트는 세팅
   컨트롤을 아코디언 스텝으로 재배치만 한다. 방식 2-카드는 기존 mode
   ('research'|'meeting') 로 매핑(mic=research / minutes=meeting).
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  WidgetAccordion,
  useWidgetAccordion,
  type AccordionStepConfig,
} from '@/components/canvas/shell/widget-accordion';
import { Field } from '@/components/canvas/shell/field';
import { ProjectPicker } from '@/components/project-picker';
import { DropdownMenu } from '@/components/ui/dropdown-menu';
import { ControlTrigger } from '@/components/ui/control-trigger';
import {
  TranscriptMethodCards,
  type TranscriptMethodOption,
} from '@/components/ui/transcript-method-cards';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { LANGUAGES } from '@/lib/transcripts/languages';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';

// 전사 방식 = 기존 mode enum. mic → 정성 인터뷰(research) / minutes → 회의록
// (meeting). 값 자체는 create/start 페이로드의 mode 로 그대로 전달된다(회귀 0).
export type TranscriptMethod = 'research' | 'meeting';

export function TranscriptSetupAccordion({
  projectId,
  onProjectChange,
  method,
  onMethodChange,
  language,
  onLanguageChange,
  dropzone,
  recordButton,
  audioReady,
}: {
  projectId: string | null;
  onProjectChange: (projectId: string | null) => void;
  method: TranscriptMethod;
  onMethodChange: (next: TranscriptMethod) => void;
  // 원본 오디오 언어 코드 (LANGUAGES). 미선택은 없음 — 부모가 브라우저 로케일로
  // 기본 선택하므로 항상 값이 있다.
  language: string;
  onLanguageChange: (code: string) => void;
  // STEP4 업로드/녹음 — 부모가 배선(드롭/녹음 → startUploads). 아코디언은 배치만.
  dropzone: ReactNode;
  recordButton: ReactNode;
  // STEP4 완료 신호(업로드 대기/진행 파일 존재). idle 에선 false → 스텝 열림 유지.
  audioReady: boolean;
}) {
  const t = useTranslations('Features.transcriptsView');
  const tLang = useTranslations('Languages');
  const { projects } = useInterviewV2Projects();
  const accordion = useWidgetAccordion();

  const METHOD_OPTIONS: TranscriptMethodOption[] = [
    {
      id: 'research',
      icon: <DuotoneIcon name="mic" size={24} />,
      title: t('method.micTitle'),
      subtitle: t('method.micSub'),
    },
    {
      id: 'meeting',
      icon: <DuotoneIcon name="minutes" size={24} />,
      title: t('method.minutesTitle'),
      subtitle: t('method.minutesSub'),
    },
  ];

  const languageItems = LANGUAGES.map((l) => ({
    key: l.code,
    label: `${l.flag} ${tLang(l.code)}`,
    onSelect: () => onLanguageChange(l.code),
  }));
  const currentLanguageLabel =
    languageItems.find((o) => o.key === language)?.label ?? language;

  const projectName =
    projects.find((p) => p.id === projectId)?.name ?? t('setup.step1Selected');
  const methodTitle =
    METHOD_OPTIONS.find((o) => o.id === method)?.title ?? '';

  const steps: AccordionStepConfig[] = [
    {
      key: 'project',
      eyebrow: t('setup.stepEyebrow', { n: 1, label: t('setup.step1Short') }),
      title: t('setup.step1Title'),
      summary: projectName,
      body: (
        <Field label={t('fieldProject')}>
          <ProjectPicker
            widget="quotes"
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
      summary: methodTitle,
      body: (
        <Field label={t('method.sectionLabel')}>
          <TranscriptMethodCards
            ariaLabel={t('method.groupAria')}
            value={method}
            onChange={(id) => onMethodChange(id as TranscriptMethod)}
            options={METHOD_OPTIONS}
          />
        </Field>
      ),
    },
    {
      key: 'language',
      eyebrow: t('setup.stepEyebrow', { n: 3, label: t('setup.step3Short') }),
      title: t('setup.step3Title'),
      summary: currentLanguageLabel,
      body: (
        <Field label={t('setup.step3Field')}>
          <div className="min-w-24">
            <DropdownMenu
              items={languageItems}
              trigger={({ open, onClick, ...aria }) => (
                <ControlTrigger
                  {...aria}
                  data-open={open}
                  onClick={onClick}
                  aria-label={t('setup.step3Field')}
                >
                  {currentLanguageLabel}
                </ControlTrigger>
              )}
            />
          </div>
        </Field>
      ),
    },
    {
      key: 'audio',
      eyebrow: t('setup.stepEyebrow', { n: 4, label: t('setup.step4Short') }),
      title: t('setup.step4Title'),
      body: (
        <div className="flex flex-col gap-3">
          {dropzone}
          {/* — or — 구분자. 드롭존/녹음 둘 중 하나 선택. */}
          <div className="flex items-center gap-3 text-xs text-mute-soft">
            <span aria-hidden className="h-px flex-1 bg-line-soft" />
            <span>{t('setup.orDivider')}</span>
            <span aria-hidden className="h-px flex-1 bg-line-soft" />
          </div>
          {recordButton}
        </div>
      ),
    },
  ];

  // 완료 판정 — 프로젝트 선택 / 방식·언어는 기본값이 있어 항상 완료(요약 접힘) /
  // 오디오는 업로드 대기·진행 파일이 있을 때. 노드 색(active/todo)은 WidgetAccordion.
  const isComplete = (index: number): boolean =>
    index === 0
      ? projectId != null
      : index === 1
        ? method !== undefined
        : index === 2
          ? language !== ''
          : audioReady;

  return (
    <WidgetAccordion
      steps={steps}
      isExpanded={accordion.isExpanded}
      isComplete={isComplete}
      onOpenStep={accordion.open}
      onCollapseStep={accordion.collapse}
      changeLabel={t('setup.change')}
      optionalLabel=""
    />
  );
}
