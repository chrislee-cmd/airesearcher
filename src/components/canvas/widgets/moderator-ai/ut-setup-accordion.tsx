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
import { Field } from '@/components/canvas/shell/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { ProjectPicker } from '@/components/project-picker';
import {
  CaptureUseCaseCards,
  type CaptureUseCaseOption,
} from '@/components/ui/capture-usecase-cards';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
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
  includeSiteAudio,
  onIncludeSiteAudio,
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
  includeSiteAudio: boolean;
  onIncludeSiteAudio: (next: boolean) => void;
  // 로컬 화면공유 지원 여부 — 미지원이면 host 입력 disabled(기존 가드).
  supported: boolean;
}) {
  const t = useTranslations('AiUt');
  const { projects } = useInterviewV2Projects();
  const accordion = useWidgetAccordion();

  // 테스트 방식 2-카드 — host/guest 두 옵션(CaptureUseCaseOption 슬롯 재사용).
  const METHOD_OPTIONS: CaptureUseCaseOption[] = [
    {
      id: 'host',
      icon: <DuotoneIcon name="host" size={24} fill={PEACH_FILL} />,
      title: t('method.hostTitle'),
      hostVia: t('method.hostLine1'),
      guestVia: t('method.hostLine2'),
    },
    {
      id: 'guest',
      icon: <DuotoneIcon name="guest" size={24} fill={PEACH_FILL} />,
      title: t('method.guestTitle'),
      hostVia: t('method.guestLine1'),
      guestVia: t('method.guestLine2'),
    },
  ];

  const projectName =
    projects.find((p) => p.id === projectId)?.name ??
    t('setup.step1Selected');
  const methodTitle =
    METHOD_OPTIONS.find((o) => o.id === method)?.title ?? '';

  const isGuest = method === 'guest';
  const urlValid = normalizeTargetUrl(targetUrl) !== null;

  const steps: AccordionStepConfig[] = [
    {
      key: 'project',
      eyebrow: t('setup.stepEyebrow', { n: 1, label: t('setup.step1Short') }),
      title: t('setup.step1Title'),
      summary: projectName,
      body: (
        <Field label={t('setup.step1Short')}>
          <ProjectPicker
            widget="moderator_ai"
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
      body: (
        <div className="flex flex-col gap-4">
          {isGuest && (
            <Field label={t('remote.task.label')}>
              <Textarea
                id={`ut-task-${surface}`}
                value={taskGoal}
                onChange={(e) => onTaskGoal(e.target.value)}
                placeholder={t('remote.task.placeholder')}
                rows={3}
              />
            </Field>
          )}
          <Field label={isGuest ? t('remote.url.label') : t('url.label')}>
            <Input
              id={`ut-url-${surface}`}
              value={targetUrl}
              onChange={(e) => onTargetUrl(e.target.value)}
              placeholder="https://example.com"
              inputMode="url"
              autoComplete="off"
              disabled={!isGuest && !supported}
            />
          </Field>
          {!isGuest && (
            <label className="flex items-start gap-2 text-sm text-mute">
              <Checkbox
                checked={includeSiteAudio}
                onChange={(e) => onIncludeSiteAudio(e.target.checked)}
                disabled={!supported}
                className="mt-[3px]"
                aria-label={t('siteAudio.label')}
              />
              <span>
                <span className="font-semibold text-ink-2">
                  {t('siteAudio.label')}
                </span>
                <br />
                <span className="text-xs-soft text-mute-soft">
                  {t('siteAudio.description')}
                </span>
              </span>
            </label>
          )}
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
