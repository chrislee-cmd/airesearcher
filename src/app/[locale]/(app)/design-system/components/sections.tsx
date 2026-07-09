'use client';

import { useState, type ReactNode } from 'react';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useCountUp } from '@/hooks/use-count-up';
import { Button, type ButtonVariant, type ButtonSize } from '@/components/ui/button';
import { IconButton, type IconButtonVariant, type IconButtonSize } from '@/components/ui/icon-button';
import { ChromeButton, type ChromeButtonVariant, type ChromeButtonSize } from '@/components/ui/chrome-button';
import { Input } from '@/components/ui/input';
import { ChromeInput } from '@/components/ui/chrome-input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { StageFlow, type Stage } from '@/components/ui/stage-flow';
import { Label } from '@/components/ui/label';
import { Field } from '@/components/canvas/shell/field';
import { Banner } from '@/components/canvas/shell/banner';
import { ControlBoard } from '@/components/canvas/shell/control-board';
import { WidgetSubHeader } from '@/components/canvas/shell/widget-subheader';
import { SectionLabel } from '@/components/canvas/shell/widget-outputs';
import { PrimitivePage, Subsection } from './primitive-page';
import {
  ModalDemo,
  WidgetFullviewModalDemo,
  FileDropZoneDemo,
  ControlDropzoneDemo,
  DropdownMenuDemo,
  SliderDemo,
  ChipInputDemo,
  ModeButtonDemo,
} from '../demos';

export type SectionId =
  | 'color'
  | 'radius'
  | 'font-size'
  | 'z-index'
  | 'motion'
  | 'button'
  | 'icon-button'
  | 'chrome-button'
  | 'input'
  | 'chrome-input'
  | 'chip-input'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'slider'
  | 'mode-button'
  | 'modal'
  | 'widget-fullview-modal'
  | 'file-drop-zone'
  | 'control-dropzone'
  | 'dropdown-menu'
  | 'label'
  | 'skeleton'
  | 'stage-flow'
  | 'canvas-widget-primitives';

type SectionEntry = {
  id: SectionId;
  label: string;
  render: () => ReactNode;
};

type SectionGroup = {
  title: string;
  sections: SectionEntry[];
};

export const SECTION_GROUPS: SectionGroup[] = [
  {
    title: 'Foundations',
    sections: [
      { id: 'color', label: 'Color', render: () => <ColorTokens /> },
      { id: 'radius', label: 'Radius', render: () => <RadiusTokens /> },
      { id: 'font-size', label: 'Font Size', render: () => <FontSizeTokens /> },
      { id: 'z-index', label: 'Z-index', render: () => <ZIndexTokens /> },
      { id: 'motion', label: 'Motion', render: () => <MotionSection /> },
    ],
  },
  {
    title: 'Form primitives',
    sections: [
      { id: 'button', label: 'Button', render: () => <ButtonSection /> },
      { id: 'icon-button', label: 'IconButton', render: () => <IconButtonSection /> },
      { id: 'chrome-button', label: 'ChromeButton', render: () => <ChromeButtonSection /> },
      { id: 'input', label: 'Input', render: () => <InputSection /> },
      { id: 'chrome-input', label: 'ChromeInput', render: () => <ChromeInputSection /> },
      { id: 'chip-input', label: 'ChipInput', render: () => <ChipInputSection /> },
      { id: 'textarea', label: 'Textarea', render: () => <TextareaSection /> },
      { id: 'select', label: 'Select', render: () => <SelectSection /> },
      { id: 'checkbox', label: 'Checkbox', render: () => <CheckboxSection /> },
      { id: 'slider', label: 'Slider', render: () => <SliderSection /> },
      { id: 'mode-button', label: 'ModeButton', render: () => <ModeButtonSection /> },
    ],
  },
  {
    title: 'Layout primitives',
    sections: [
      { id: 'modal', label: 'Modal', render: () => <ModalSection /> },
      {
        id: 'widget-fullview-modal',
        label: 'WidgetFullviewModal',
        render: () => <WidgetFullviewModalSection />,
      },
      { id: 'file-drop-zone', label: 'FileDropZone', render: () => <FileDropZoneSection /> },
      {
        id: 'control-dropzone',
        label: 'ControlDropzone',
        render: () => <ControlDropzoneSection />,
      },
      { id: 'dropdown-menu', label: 'DropdownMenu', render: () => <MenuSection /> },
      { id: 'label', label: 'Label', render: () => <LabelSection /> },
      { id: 'skeleton', label: 'Skeleton', render: () => <SkeletonSection /> },
    ],
  },
  {
    title: 'Widget primitives',
    sections: [
      { id: 'stage-flow', label: 'StageFlow', render: () => <StageFlowSection /> },
      {
        id: 'canvas-widget-primitives',
        label: 'Canvas Widget Primitives',
        render: () => <CanvasWidgetPrimitivesSection />,
      },
    ],
  },
];

export const SECTION_INDEX: Record<SectionId, SectionEntry> = SECTION_GROUPS.reduce(
  (acc, group) => {
    for (const s of group.sections) acc[s.id] = s;
    return acc;
  },
  {} as Record<SectionId, SectionEntry>,
);

export const DEFAULT_SECTION_ID: SectionId = 'color';

export function isSectionId(value: string): value is SectionId {
  return value in SECTION_INDEX;
}

function RadiusTokens() {
  const tokens = [
    { name: 'rounded-2xs', value: '2px', usage: 'slider track · 얇은 progress bar' },
    { name: 'rounded-xs', value: '4px', usage: 'chip · badge · 작은 카드' },
    { name: 'rounded-sm', value: '14px', usage: '카드 · 모달 · 입력창 (기본)' },
    { name: 'rounded-md', value: '24px', usage: '대형 카드' },
    { name: 'rounded-full', value: '∞', usage: 'pill · 원형 버튼' },
  ];
  return (
    <PrimitivePage
      title="Radius"
      hint="rounded-{name} 사용. [border-radius:Npx] 직접 사용은 lint 차단."
    >
      <div className="grid grid-cols-5 gap-3">
        {tokens.map((t) => (
          <div
            key={t.name}
            className="flex flex-col items-center gap-2 border border-line bg-paper p-4 rounded-sm"
          >
            <div className={`h-16 w-16 bg-amore-bg ${t.name}`} />
            <code className="text-sm text-ink">{t.name}</code>
            <p className="text-sm text-mute-soft tabular-nums">{t.value}</p>
            <p className="text-center text-xs-soft text-mute">{t.usage}</p>
          </div>
        ))}
      </div>
    </PrimitivePage>
  );
}

function FontSizeTokens() {
  const tokens = [
    { name: 'text-xs', px: '10px', usage: '극소 caps/labels', absorbs: '9, 9.5, 10' },
    { name: 'text-xs-soft', px: '10.5px', usage: 'amore-soft eyebrow', absorbs: '10.5' },
    { name: 'text-sm', px: '11.5px', usage: '작은 UI 텍스트', absorbs: '11, 11.5' },
    { name: 'text-md', px: '12.5px', usage: '기본 본문', absorbs: '12, 12.5' },
    { name: 'text-lg', px: '13px', usage: '강조 본문', absorbs: '13, 13.5' },
    { name: 'text-xl', px: '15px', usage: '소제목', absorbs: '14, 15' },
    { name: 'text-2xl', px: '18px', usage: '제목', absorbs: '16, 17, 18' },
    { name: 'text-3xl', px: '22px', usage: '대제목', absorbs: '20, 22, 24' },
    { name: 'text-display', px: '32px', usage: '히어로/디스플레이', absorbs: '26, 28, 42' },
  ];
  return (
    <PrimitivePage
      title="Font Size"
      hint="text-{name} 사용. text-[Npx] 직접 사용은 lint 차단 예정 (B-1 마이그 완료 후)."
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {tokens.map((t) => (
          <div
            key={t.name}
            className="flex flex-col gap-2 border border-line bg-paper p-3 rounded-sm"
          >
            <div className={`text-ink-2 ${t.name}`}>표준 텍스트 샘플</div>
            <div className="flex items-center justify-between border-t border-line-soft pt-2">
              <code className="text-sm text-ink">{t.name}</code>
              <span className="text-xs-soft tabular-nums text-mute-soft">{t.px}</span>
            </div>
            <p className="text-xs-soft text-mute">{t.usage}</p>
            <p className="text-xs text-mute-soft">흡수: {t.absorbs}</p>
          </div>
        ))}
      </div>
    </PrimitivePage>
  );
}

function ColorTokens() {
  const groups = [
    {
      heading: 'Brand · Surfaces',
      tokens: [
        { name: 'amore', cls: 'bg-amore', hex: '#ff5c8a' },
        { name: 'amore-soft', cls: 'bg-amore-soft', hex: '#ff96b6' },
        { name: 'amore-bg', cls: 'bg-amore-bg', hex: '#ffe1eb' },
        { name: 'paper', cls: 'bg-paper border-line border', hex: '#fbf7f2' },
        { name: 'paper-soft', cls: 'bg-paper-soft border-line border', hex: '#fefaf5' },
      ],
    },
    {
      heading: 'Text · Lines',
      tokens: [
        { name: 'ink', cls: 'bg-ink', hex: '#1d1b20' },
        { name: 'ink-2', cls: 'bg-ink-2', hex: '#2a262f' },
        { name: 'mute', cls: 'bg-mute', hex: '#5b5965' },
        { name: 'mute-soft', cls: 'bg-mute-soft', hex: '#8a8693' },
        { name: 'line', cls: 'bg-line', hex: 'ink/10%' },
        { name: 'line-soft', cls: 'bg-line-soft', hex: 'ink/6%' },
      ],
    },
    {
      heading: 'Bento Pastels',
      tokens: [
        { name: 'lav', cls: 'bg-lav', hex: '#e7defe' },
        { name: 'peach', cls: 'bg-peach', hex: '#ffd9c9' },
        { name: 'mint', cls: 'bg-mint', hex: '#cdebd9' },
        { name: 'sun', cls: 'bg-sun', hex: '#fff1b6' },
        { name: 'sky', cls: 'bg-sky', hex: '#cfe6ff' },
        { name: 'rose', cls: 'bg-rose', hex: '#ffd0e2' },
      ],
    },
    {
      heading: 'Signal',
      tokens: [
        { name: 'success', cls: 'bg-success', hex: '#16a34a' },
        { name: 'warning', cls: 'bg-warning', hex: '#fb923c' },
        { name: 'warning-bg', cls: 'bg-warning-bg', hex: '#fff1e6' },
        { name: 'warning-line', cls: 'bg-warning-line', hex: '#ffd9bf' },
        { name: 'am-accent', cls: 'bg-am-accent', hex: '#fb923c' },
        { name: 'pm-accent', cls: 'bg-pm-accent', hex: '#6c7aff' },
      ],
    },
  ];
  return (
    <PrimitivePage
      title="Color"
      hint="bg-{name} / text-{name} / border-{name} 형태로 사용. 새 색은 globals.css 의 @theme 블록에 토큰으로 추가 후 사용."
    >
      <div className="flex flex-col gap-6">
        {groups.map((g) => (
          <div key={g.heading}>
            <div className="eyebrow-mute mb-3">{g.heading}</div>
            <div className="grid grid-cols-7 gap-3">
              {g.tokens.map((t) => (
                <div key={t.name} className="flex flex-col items-center gap-1.5 rounded-xs">
                  <div className={`h-12 w-12 rounded-xs ${t.cls}`} />
                  <code className="text-xs-soft text-ink">{t.name}</code>
                  <p className="text-xs text-mute-soft tabular-nums">{t.hex}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </PrimitivePage>
  );
}

function ZIndexTokens() {
  const tokens = [
    { name: 'z-table-sticky', value: 1, usage: '테이블 sticky 헤더' },
    { name: 'z-table-cell-sticky', value: 2, usage: '테이블 sticky 셀' },
    { name: 'z-table-resize', value: 3, usage: '컬럼 resize 핸들' },
    { name: 'z-fab', value: 40, usage: 'voice concierge FAB' },
    { name: 'z-modal', value: 50, usage: '모든 모달 (ui/modal · 페이지 ad-hoc 모달)' },
    { name: 'z-toast', value: 60, usage: 'toast / snackbar (modal 위)' },
    { name: 'z-overlay', value: 70, usage: 'voice concierge tour highlight (최상단)' },
  ];
  return (
    <PrimitivePage
      title="Z-index"
      hint="z-{name} 사용. z-[N] 직접 사용은 lint 차단. 같은 레이어 안에서는 DOM 순서로 정렬."
    >
      <div className="border border-line bg-paper rounded-sm">
        <table className="w-full text-md">
          <thead className="border-b border-line">
            <tr className="text-left">
              <th className="px-4 py-2.5 font-semibold text-ink-2">Token</th>
              <th className="px-4 py-2.5 font-semibold text-ink-2">Value</th>
              <th className="px-4 py-2.5 font-semibold text-ink-2">Usage</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.name} className="border-b border-line-soft last:border-b-0">
                <td className="px-4 py-2 font-mono text-ink">{t.name}</td>
                <td className="px-4 py-2 tabular-nums text-mute">{t.value}</td>
                <td className="px-4 py-2 text-mute">{t.usage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PrimitivePage>
  );
}

function MotionSection() {
  const reduced = useReducedMotion();
  // key 를 증가시켜 데모 노드를 remount → CSS 애니메이션 재생.
  const [replay, setReplay] = useState(0);
  const [countTarget, setCountTarget] = useState(128);
  const count = useCountUp(countTarget, { startFrom: 0 });

  const tokenRows = [
    { group: 'Duration', name: '--dur-fast', value: '120ms', usage: 'press / hover 즉각 피드백' },
    { group: 'Duration', name: '--dur', value: '180ms', usage: '기본 등장 / 전환' },
    { group: 'Duration', name: '--dur-slow', value: '260ms', usage: '강조 등장 (fade-in-up / pop-in)' },
    { group: 'Easing', name: '--ease-out', value: 'cubic-bezier(0.22, 1, 0.36, 1)', usage: '감속 정착 (기본)' },
    { group: 'Easing', name: '--ease-emphasized', value: 'cubic-bezier(0.34, 1.4, 0.64, 1)', usage: '강조 overshoot (pop-in)' },
    { group: 'Distance', name: '--motion-rise', value: '6px', usage: 'fade-in-up 상승 거리' },
  ];

  const utils = [
    { cls: 'fade-in-up', desc: '아래→위 떠오르며 등장' },
    { cls: 'pop-in', desc: 'scale 0.8→1 튕기며 등장' },
    { cls: 'shake', desc: '오류 피드백 좌우 흔들림' },
  ];

  return (
    <PrimitivePage
      title="Motion"
      hint="globals.css 모션 토큰(--dur-*/--ease-*/--motion-rise) + 공용 유틸(.fade-in-up/.pop-in/.shake/.stagger/.press-scale) + 훅(useReducedMotion/useCountUp). 라이브러리 없이 CSS keyframes only · prefers-reduced-motion 전면 존중."
    >
      {reduced ? (
        <div className="rounded-xs border border-warning-line bg-warning-bg px-3 py-2 text-sm text-ink-2">
          OS ‘동작 줄이기(reduce motion)’ 가 켜져 있어 아래 데모가 애니메이션 없이 즉시
          최종 상태로 표시됩니다 — 의도된 접근성 존중.
        </div>
      ) : null}

      <Subsection label="Tokens (globals.css SSOT — 하드코드 duration 금지)">
        <div className="border border-line bg-paper rounded-sm">
          <table className="w-full text-md">
            <thead className="border-b border-line">
              <tr className="text-left">
                <th className="px-4 py-2.5 font-semibold text-ink-2">Group</th>
                <th className="px-4 py-2.5 font-semibold text-ink-2">Token</th>
                <th className="px-4 py-2.5 font-semibold text-ink-2">Value</th>
                <th className="px-4 py-2.5 font-semibold text-ink-2">Usage</th>
              </tr>
            </thead>
            <tbody>
              {tokenRows.map((t) => (
                <tr key={t.name} className="border-b border-line-soft last:border-b-0">
                  <td className="px-4 py-2 text-mute-soft">{t.group}</td>
                  <td className="px-4 py-2 font-mono text-ink">{t.name}</td>
                  <td className="px-4 py-2 font-mono text-mute">{t.value}</td>
                  <td className="px-4 py-2 text-mute">{t.usage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Subsection>

      <Subsection label="유틸 클래스 — 재생">
        <div className="mb-3">
          <Button size="sm" variant="secondary" onClick={() => setReplay((n) => n + 1)}>
            ▶ 다시 재생
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {utils.map((u) => (
            <div
              key={u.cls}
              className="flex flex-col items-center gap-2 border border-line bg-paper p-4 rounded-sm"
            >
              {/* replay key 로 remount → 애니메이션 재생 */}
              <div key={replay} className={`h-12 w-12 rounded-xs bg-amore ${u.cls}`} />
              <code className="text-sm text-ink">.{u.cls}</code>
              <p className="text-center text-xs-soft text-mute">{u.desc}</p>
            </div>
          ))}
        </div>
      </Subsection>

      <Subsection label=".stagger — 직계 자식 순차 등장 (fade-in-up 계단식)">
        <div key={`stagger-${replay}`} className="stagger flex flex-wrap gap-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="flex h-10 w-10 items-center justify-center rounded-xs border border-line bg-amore-bg text-sm text-ink"
            >
              {i + 1}
            </div>
          ))}
        </div>
      </Subsection>

      <Subsection label=".press-scale — 클릭 시 눌림 (프리미티브 밖 임의 요소용)">
        <div className="press-scale inline-flex cursor-pointer select-none items-center rounded-sm border border-line bg-paper px-4 py-2 text-md text-ink">
          여기를 눌러보세요 (mousedown 시 scale 0.97)
        </div>
      </Subsection>

      <Subsection label="useCountUp — 숫자 카운트업/다운 (문서 수 · 크레딧 · N/240)">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-[120px] text-display font-semibold tabular-nums text-ink">
            {count.toLocaleString()}
          </div>
          <div className="flex flex-wrap gap-2">
            {[42, 128, 1240].map((v) => (
              <Button key={v} size="sm" variant="secondary" onClick={() => setCountTarget(v)}>
                → {v.toLocaleString()}
              </Button>
            ))}
          </div>
        </div>
      </Subsection>

      <Subsection label="프리미티브 press 내장 (active:scale-[0.97] — 눌러 확인)">
        <p className="mb-2 text-sm text-mute">
          Button / IconButton / ChromeButton 은 base 에 press-scale 내장. hover(Memphis
          translate/shadow)·focus·클릭 동작은 그대로.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button>Button</Button>
          <ChromeButton>ChromeButton</ChromeButton>
          <IconButton aria-label="press demo" variant="bordered" size="md">
            <CloseIcon />
          </IconButton>
        </div>
      </Subsection>

      <Wave3Demos replay={replay} />
    </PrimitivePage>
  );
}

// Wave3 — 주의 환기(toast slide-in / 배지 bounce / 에러 shake) + 미세 delight
// (empty mascot idle sway / 아이콘 hover). Foundation 유틸(.toast-in/.pop-in/
// .shake/.brand-sway/.icon-nudge) 소비. confetti 비채택. 크레딧 flash 는 기존
// creditBalancePulse(#64) 재사용이라 여기 데모 제외.
function Wave3Demos({ replay }: { replay: number }) {
  const [toastKey, setToastKey] = useState(0);
  const [badgeState, setBadgeState] = useState<'idle' | 'running' | 'done'>('running');
  const [errored, setErrored] = useState(false);

  return (
    <>
      <Subsection label="Wave3 · toast slide-in + fade (.toast-in / .toast-out)">
        <div className="mb-3">
          <Button size="sm" variant="secondary" onClick={() => setToastKey((n) => n + 1)}>
            ▶ 다시 재생
          </Button>
        </div>
        <div
          key={toastKey}
          className="toast-in inline-block min-w-[260px] max-w-[360px] border border-line bg-paper px-4 py-2.5 text-md leading-[1.6] text-ink-2 rounded-sm"
          role="status"
        >
          저장되었습니다 — 우측 edge 에서 slide-in, ttl 만료 시 fade-out.
        </div>
      </Subsection>

      <Subsection label="Wave3 · 배지 / 카운트 변경 bounce (.pop-in, state 변경 시 remount)">
        <div className="flex flex-wrap items-center gap-3">
          <span
            key={`${badgeState}-${replay}`}
            className="pop-in inline-flex items-center gap-1 rounded-xs border-2 border-ink px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider tabular-nums"
            style={{
              background:
                badgeState === 'running'
                  ? 'var(--color-amore)'
                  : badgeState === 'done'
                    ? 'var(--color-mint)'
                    : 'var(--color-paper)',
              color: badgeState === 'running' ? 'var(--canvas-card-bg)' : 'var(--color-ink)',
            }}
          >
            {badgeState.toUpperCase()}
          </span>
          <div className="flex gap-2">
            {(['idle', 'running', 'done'] as const).map((s) => (
              <Button key={s} size="sm" variant="secondary" onClick={() => setBadgeState(s)}>
                {s}
              </Button>
            ))}
          </div>
        </div>
      </Subsection>

      <Subsection label="Wave3 · 입력 에러 shake + error 톤 transition (Input primitive)">
        <div className="max-w-[320px] space-y-3">
          <Input
            label="이메일"
            placeholder="you@example.com"
            error={errored ? '유효한 이메일을 입력하세요.' : undefined}
          />
          <Button size="sm" variant="secondary" onClick={() => setErrored((v) => !v)}>
            {errored ? '에러 해제' : '에러 트리거 (shake)'}
          </Button>
        </div>
      </Subsection>

      <Subsection label="Wave3 · empty 상태 mascot idle sway (.brand-sway)">
        <div className="max-w-[420px]">
          <EmptyState
            tone="subtle"
            mascot
            title="아직 프로젝트가 없어요"
            description="첫 프로젝트를 만들면 여기에 표시됩니다."
          />
        </div>
      </Subsection>

      <Subsection label="Wave3 · 아이콘 hover 미세 회전 (.icon-nudge — 아래 버튼에 hover)">
        <IconButton aria-label="settings demo" variant="subtle" size="md" className="group">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="icon-nudge"
          >
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </IconButton>
      </Subsection>
    </>
  );
}

function ButtonSection() {
  const variants: ButtonVariant[] = [
    'primary',
    'secondary',
    'ghost',
    'destructive',
    'link',
    'destructive-link',
    'subtle',
  ];
  const sizes: ButtonSize[] = ['xs', 'sm', 'md', 'lg', 'cta'];
  return (
    <PrimitivePage
      title="Button"
      hint="src/components/ui/button.tsx · 7 variants × 5 sizes · loading / fullWidth / left|rightIcon · subtle = 헤더 banner 위 pill chip (Topbar SignIn / 탭 / account pill 가족)"
    >
      <Subsection label="Variants (size=md)">
        <div className="flex flex-wrap gap-2">
          {variants.map((v) => (
            <Button key={v} variant={v}>
              {v}
            </Button>
          ))}
        </div>
      </Subsection>

      <Subsection label="Sizes (variant=primary)">
        <div className="flex flex-wrap items-center gap-2">
          {sizes.map((s) => (
            <Button key={s} size={s}>
              {s}
            </Button>
          ))}
        </div>
      </Subsection>

      <Subsection label="States">
        <div className="flex flex-wrap gap-2">
          <Button>Default</Button>
          <Button disabled>Disabled</Button>
          <Button loading loadingLabel="Loading…">
            Submit
          </Button>
        </div>
      </Subsection>

      <Subsection label="fullWidth">
        <Button fullWidth>fullWidth</Button>
      </Subsection>
    </PrimitivePage>
  );
}

function IconButtonSection() {
  const variants: IconButtonVariant[] = [
    'ghost',
    'ghost-danger',
    'ghost-brand',
    'bordered',
    'subtle',
    'plain',
  ];
  const sizes: IconButtonSize[] = ['compact', 'sm', 'md', 'lg'];
  return (
    <PrimitivePage
      title="IconButton"
      hint="src/components/ui/icon-button.tsx · aria-label required (a11y enforced by type) · subtle = 헤더 banner 위 circular pill (Topbar account pill 안의 gear) · plain = bare glyph (박스/배경/그림자 무, hover 색만) · sizes are shape"
    >
      <Subsection label="Variants (size=md)">
        <div className="flex flex-wrap items-center gap-3">
          {variants.map((v) => (
            <IconButton key={v} variant={v} size="md" aria-label={v}>
              <CloseIcon />
            </IconButton>
          ))}
        </div>
      </Subsection>

      <Subsection label="Sizes (variant=bordered)">
        <div className="flex flex-wrap items-center gap-3">
          {sizes.map((s) => (
            <IconButton key={s} variant="bordered" size={s} aria-label={s}>
              <CloseIcon />
            </IconButton>
          ))}
        </div>
      </Subsection>
    </PrimitivePage>
  );
}

function ChromeButtonSection() {
  const variants: ChromeButtonVariant[] = ['default', 'mute', 'primary'];
  const sizes: ChromeButtonSize[] = ['xs', 'sm', 'md', 'lg'];
  return (
    <PrimitivePage
      title="ChromeButton"
      hint="src/components/ui/chrome-button.tsx · 4px radius chrome (별도로 squared) · 보조 액션용. uppercase prop 으로 caps treatment."
    >
      <Subsection label="Variants (size=md)">
        <div className="flex flex-wrap gap-2">
          {variants.map((v) => (
            <ChromeButton key={v} variant={v}>
              {v}
            </ChromeButton>
          ))}
        </div>
      </Subsection>

      <Subsection label="Sizes (variant=default)">
        <div className="flex flex-wrap items-center gap-2">
          {sizes.map((s) => (
            <ChromeButton key={s} size={s}>
              {s}
            </ChromeButton>
          ))}
        </div>
      </Subsection>

      <Subsection label="uppercase=true">
        <ChromeButton uppercase>Create folder</ChromeButton>
      </Subsection>
    </PrimitivePage>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function InputSection() {
  return (
    <PrimitivePage
      title="Input"
      hint="src/components/ui/input.tsx · label / helper / error / size (sm|md) / leftSlot / rightSlot / fullWidth · 14px radius capsule"
    >
      <Subsection label="Sizes (default + label + helper)">
        <div className="grid grid-cols-2 gap-6">
          <Input size="sm" label="size=sm" helper="px-2.5 py-1.5 text-md" placeholder="value" />
          <Input size="md" label="size=md" helper="px-3 py-2 text-lg (default)" placeholder="value" />
        </div>
      </Subsection>

      <Subsection label="States">
        <div className="grid grid-cols-2 gap-6">
          <Input label="Default" placeholder="value" />
          <Input label="Disabled" disabled placeholder="value" />
          <Input label="Error" error="이메일 형식이 올바르지 않습니다." defaultValue="bad" />
          <Input label="Helper text" helper="회사 도메인 권장" placeholder="email@…" />
        </div>
      </Subsection>

      <Subsection label="leftSlot · rightSlot · required">
        <div className="grid grid-cols-2 gap-6">
          <Input label="leftSlot" leftSlot={<span aria-hidden>$</span>} placeholder="0.00" />
          <Input label="rightSlot" rightSlot={<span aria-hidden>%</span>} placeholder="0" />
          <Input label="required" required placeholder="value" />
        </div>
      </Subsection>
    </PrimitivePage>
  );
}

function ChromeInputSection() {
  return (
    <PrimitivePage
      title="ChromeInput"
      hint="src/components/ui/chrome-input.tsx · 4px radius (chrome) · in-row name/rename/URL · label/error 없음 — 인라인 사용 의도"
    >
      <Subsection label="Sizes">
        <div className="flex flex-wrap items-center gap-2">
          <ChromeInput size="xs" placeholder="size=xs" />
          <ChromeInput size="sm" placeholder="size=sm (default)" />
        </div>
      </Subsection>

      <Subsection label="States">
        <div className="flex flex-wrap items-center gap-2">
          <ChromeInput placeholder="default" />
          <ChromeInput disabled placeholder="disabled" />
          <ChromeInput readOnly defaultValue="readonly value" />
        </div>
      </Subsection>
    </PrimitivePage>
  );
}

function TextareaSection() {
  return (
    <PrimitivePage
      title="Textarea"
      hint="src/components/ui/textarea.tsx · Input 과 동일한 label/helper/error/fullWidth contract · rows prop (기본 4) · resize-y"
    >
      <Subsection label="Default + label + helper">
        <Textarea label="설명" helper="자유 형식. 줄바꿈 가능." placeholder="여기에 입력…" />
      </Subsection>

      <Subsection label="States">
        <div className="grid grid-cols-2 gap-6">
          <Textarea label="Disabled" disabled placeholder="value" rows={3} />
          <Textarea label="Error" error="최소 10자 이상 입력하세요." defaultValue="short" rows={3} />
        </div>
      </Subsection>
    </PrimitivePage>
  );
}

function SelectSection() {
  const options = [
    { value: 'admin', label: '관리자 (admin)' },
    { value: 'member', label: '멤버 (member)' },
    { value: 'viewer', label: '뷰어 (viewer)' },
  ];
  return (
    <PrimitivePage
      title="Select"
      hint="src/components/ui/select.tsx · native <select> 위에 appearance-none + 자체 chevron · Input 과 같은 contract"
    >
      <Subsection label="Sizes (options prop + placeholder)">
        <div className="grid grid-cols-2 gap-6">
          <Select size="sm" label="size=sm" placeholder="역할 선택…" options={options} />
          <Select size="md" label="size=md (default)" placeholder="역할 선택…" options={options} />
        </div>
      </Subsection>

      <Subsection label="States">
        <div className="grid grid-cols-2 gap-6">
          <Select label="Default" defaultValue="member" options={options} />
          <Select label="Disabled" disabled defaultValue="member" options={options} />
          <Select label="Error" error="역할을 선택하세요." options={options} />
          <Select label="Helper" helper="조직 전체에 적용됩니다." options={options} />
        </div>
      </Subsection>
    </PrimitivePage>
  );
}

function CheckboxSection() {
  return (
    <PrimitivePage
      title="Checkbox"
      hint="src/components/ui/checkbox.tsx · Memphis 톤 (2px ink border + 1.5px offset shadow) · checked 시 amore 채움 + ✓ SVG · sm 16px / md 20px · 텍스트는 <label> wrapper 로 직접 붙임"
    >
      <Subsection label="Sizes">
        <div className="flex items-center gap-6">
          <label className="inline-flex items-center gap-2 text-md text-ink">
            <Checkbox size="sm" defaultChecked />
            <span>size=sm (default)</span>
          </label>
          <label className="inline-flex items-center gap-2 text-md text-ink">
            <Checkbox size="md" defaultChecked />
            <span>size=md</span>
          </label>
        </div>
      </Subsection>

      <Subsection label="States">
        <div className="flex items-center gap-6">
          <label className="inline-flex items-center gap-2 text-md text-ink">
            <Checkbox />
            <span>Default (off)</span>
          </label>
          <label className="inline-flex items-center gap-2 text-md text-ink">
            <Checkbox defaultChecked />
            <span>Checked</span>
          </label>
          <label className="inline-flex items-center gap-2 text-md text-mute">
            <Checkbox disabled />
            <span>Disabled (off)</span>
          </label>
          <label className="inline-flex items-center gap-2 text-md text-mute">
            <Checkbox disabled defaultChecked />
            <span>Disabled (checked)</span>
          </label>
        </div>
      </Subsection>
    </PrimitivePage>
  );
}

function ModalSection() {
  return (
    <PrimitivePage
      title="Modal"
      hint="src/components/ui/modal.tsx · 3 sizes (sm/md/lg) · Esc 닫기 · backdrop 클릭 닫기 · body scroll lock · focus restore · z-modal(50)"
    >
      <Subsection label="Sizes (interactive)">
        <ModalDemo />
      </Subsection>
    </PrimitivePage>
  );
}

function WidgetFullviewModalSection() {
  return (
    <PrimitivePage
      title="WidgetFullviewModal"
      hint="src/components/canvas/shell/widget-fullview-modal.tsx · Modal(wide|full) wrap + 프로빙 chrome 일반화 · 제목 + 부제 + 닫기(×) header / 본문 slot / 옵션 footer · Esc·backdrop 닫기 + focus restore 는 Modal 에서 상속 · 소비처: probing / interviews / desk / quotes (PR-C wire)"
    >
      <Subsection label="진입 버튼 — 노란 메인 헤더, READY 상태 pill 바로 아래">
        <div className="space-y-3">
          {/* widget-shell.tsx 의 onFullview 진입 버튼과 동일한 시각 + 위치 —
              노란 카드 헤더 안 우측, state pill 아래에 Memphis chip
              (secondary: 흰 bg + 검은 border + offset shadow + arrows-out
              아이콘). 노란 배경 위에서 또렷하게 보이도록. */}
          <div
            className="inline-flex flex-col items-end gap-1.5 px-4 py-3 rounded-sm border-[2px] border-ink"
            style={{ background: 'var(--canvas-card-header-bg)' }}
          >
            <span className="inline-flex items-center px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider bg-paper border-[2px] border-ink rounded-[4px] shadow-[2px_2px_0_var(--canvas-card-border)]">
              READY
            </span>
            <Button
              variant="secondary"
              size="sm"
              className="uppercase tracking-[0.16em]"
              leftIcon={
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              }
            >
              전체 보기
            </Button>
          </div>
          <p className="text-sm text-mute-soft">
            onFullview 를 넘긴 위젯에만 노출 — 클릭 시{' '}
            <code className="font-mono">{'<key>:open-fullview'}</code> window
            이벤트를 dispatch, 각 위젯 본문이 자기 WidgetFullviewModal 을 연다.
          </p>
        </div>
      </Subsection>
      <Subsection label="Interactive (wide + footer / wide no-footer / full)">
        <WidgetFullviewModalDemo />
      </Subsection>
    </PrimitivePage>
  );
}

function SkeletonSection() {
  return (
    <PrimitivePage
      title="Skeleton"
      hint="src/components/ui/skeleton.tsx · 3 variants (text/block/circle) · animate-pulse bg-line-soft"
    >
      <Subsection label="Variants">
        <div className="grid grid-cols-3 gap-6">
          <div className="space-y-2">
            <div className="eyebrow-mute">variant=text</div>
            <Skeleton variant="text" />
            <Skeleton variant="text" width="80%" />
            <Skeleton variant="text" width="60%" />
          </div>
          <div className="space-y-2">
            <div className="eyebrow-mute">variant=block</div>
            <Skeleton variant="block" height={80} />
          </div>
          <div className="space-y-2">
            <div className="eyebrow-mute">variant=circle</div>
            <Skeleton variant="circle" />
            <Skeleton variant="circle" width={48} height={48} />
            <Skeleton variant="circle" width={64} height={64} />
          </div>
        </div>
      </Subsection>
    </PrimitivePage>
  );
}

function StageFlowSection() {
  const midFlow: Stage[] = [
    { id: 'input', label: '입력 수집', status: 'done' },
    { id: 'crawl', label: '크롤링', status: 'active', hint: '47/240 수집중' },
    { id: 'synth', label: '종합', status: 'pending' },
    { id: 'report', label: '리포트', status: 'pending' },
  ];
  const errorFlow: Stage[] = [
    { id: 'input', label: '입력 수집', status: 'done' },
    { id: 'crawl', label: '크롤링', status: 'error' },
    { id: 'synth', label: '종합', status: 'pending' },
  ];
  return (
    <PrimitivePage
      title="StageFlow"
      hint="src/components/ui/stage-flow.tsx · 공정 플로우차트 아티팩트 · 노드(pending/active/done/error)+엣지 · active glow + done→active 엣지 흐름(CSS keyframe, prefers-reduced-motion 존중) · complete=true → 완료 hero · 소비처=데스크 #439 / 인터뷰V2 #440"
    >
      <Subsection label="Horizontal (기본) — done · active(hint) · pending">
        <div className="rounded-sm border border-line-soft bg-paper p-6">
          <StageFlow stages={midFlow} />
        </div>
      </Subsection>
      <Subsection label="Error 톤 (warning 재사용)">
        <div className="rounded-sm border border-line-soft bg-paper p-6">
          <StageFlow stages={errorFlow} />
        </div>
      </Subsection>
      <Subsection label="Vertical (좁은 폭 반응형)">
        <div className="max-w-[220px] rounded-sm border border-line-soft bg-paper p-6">
          <StageFlow stages={midFlow} orientation="vertical" />
        </div>
      </Subsection>
      <Subsection label="Complete (전 단계 done → 완료 hero + 결과 보기 CTA)">
        <div className="rounded-sm border border-line-soft bg-paper p-6">
          <StageFlow
            stages={midFlow}
            complete
            completeLabel="생성이 완료됐어요"
            onResult={() => {}}
          />
        </div>
      </Subsection>
    </PrimitivePage>
  );
}

function LabelSection() {
  return (
    <PrimitivePage
      title="Label"
      hint="src/components/ui/label.tsx · UPPERCASE / tracked / text-sm field label · Input/Textarea/Select 가 내부적으로 사용 · 직접 import 는 드물어야 함"
    >
      <Subsection label="Default / required">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <Label htmlFor="lbl-demo-1">Default</Label>
            <Input id="lbl-demo-1" placeholder="value" />
          </div>
          <div>
            <Label htmlFor="lbl-demo-2" required>
              Required
            </Label>
            <Input id="lbl-demo-2" required placeholder="value" />
          </div>
        </div>
      </Subsection>
    </PrimitivePage>
  );
}

function FileDropZoneSection() {
  return (
    <PrimitivePage
      title="FileDropZone"
      hint="src/components/ui/file-drop-zone.tsx · drag·drop + 클릭 picker · accept / multiple / maxSizeBytes / disabled · 워크스페이스 artifact drop 지원 (onDropRaw)"
    >
      <Subsection label="Default (drag or click)">
        <FileDropZoneDemo />
      </Subsection>
    </PrimitivePage>
  );
}

function ControlDropzoneSection() {
  return (
    <PrimitivePage
      title="ControlDropzone"
      hint="src/components/ui/control-dropzone.tsx · 위젯 컨트롤 보드(ControlBoardPanel) 업로드 dropzone 규격 SSOT · 폭(w-full) + 세로(FILE_DROP_ZONE_PY=py-12) baked-in · 레이아웃 className 미노출(타입 차단) — 위젯은 데이터/동작/카피만 주입 → 같은 문맥 위젯은 픽셀 동일. 모달/애널라이저 등 다른 문맥은 FileDropZone 을 그대로 사용."
    >
      <Subsection label="규격 고정 (위젯이 치수 override 불가)">
        <ControlDropzoneDemo />
      </Subsection>
    </PrimitivePage>
  );
}

function ChipInputSection() {
  return (
    <PrimitivePage
      title="ChipInput"
      hint="src/components/ui/chip-input.tsx · 칩 컨테이너 안에서 다음 값을 입력하는 bare extender input · border/background 없음 (부모 컨테이너의 focus-within 프레임이 소유) · 사용처: desk-research 키워드 입력"
    >
      <Subsection label="Interactive (Enter 또는 쉼표로 추가)">
        <ChipInputDemo />
      </Subsection>
    </PrimitivePage>
  );
}

function SliderSection() {
  return (
    <PrimitivePage
      title="Slider"
      hint="src/components/ui/slider.tsx · native range input wrapper · accent-amore track · h-1 default · 모든 native props pass-through (min/max/step/value/onChange/disabled/aria-label)"
    >
      <Subsection label="Interactive (sync to label)">
        <SliderDemo />
      </Subsection>
    </PrimitivePage>
  );
}

function ModeButtonSection() {
  return (
    <PrimitivePage
      title="ModeButton"
      hint="src/components/ui/mode-button.tsx · 선택 가능한 카드 버튼 그룹 (ModeCardGroup) · selection=single(radiogroup, value/onChange) | multi(toggle, selected[]/onToggle) · icon / description / soon 배지 / disabled · 소비처: 데스크 리서치 목적(single) · 프로빙 섹션 구성기 #470(multi)"
    >
      <Subsection label="Interactive (single radiogroup + multi toggle)">
        <ModeButtonDemo />
      </Subsection>
    </PrimitivePage>
  );
}

function MenuSection() {
  return (
    <PrimitivePage
      title="DropdownMenu"
      hint="src/components/ui/dropdown-menu.tsx · headless menu primitive (render-prop trigger) · 키보드 ↑↓ Enter Esc · click-outside 자동 닫기 · align (start|end) · side (top|bottom) · hint 가능 · optional label"
    >
      <Subsection label="Interactive (align / side / label)">
        <DropdownMenuDemo />
      </Subsection>
      <Subsection label="Compositions in the codebase">
        <div className="text-md text-mute space-y-1.5">
          <p>
            DropdownMenu 위에 도메인 wrapper 두 개가 있습니다 — 직접 dropdown 코드를 작성하지 말고 가능하면 wrapper 사용:
          </p>
          <ul className="ml-4 list-disc space-y-0.5">
            <li>
              <code className="font-mono text-ink-2">DownloadMenu</code> (
              <code className="font-mono">ui/download-menu.tsx</code>) — ExportFormat 별 url / blob / action 항목. 1개일 때는 plain Button 으로 fallback.
            </li>
            <li>
              <code className="font-mono text-ink-2">ShareMenu</code> (
              <code className="font-mono">ui/share-menu.tsx</code>) — Google Docs / Sheets / Notion 전송. 인증 끊긴 경우 connect URL 로 redirect, 토스트로 결과 알림.
            </li>
          </ul>
        </div>
      </Subsection>
    </PrimitivePage>
  );
}

function CanvasWidgetPrimitivesSection() {
  return (
    <PrimitivePage
      title="Canvas Widget Primitives"
      hint="src/components/canvas/shell/* · canvas 위젯 5종 (quotes/desk/interviews/recruiting/probing) 본문에서 공통으로 쓰는 라벨/필드/배너 SSOT. 인라인 className 재현 금지 — 새 위젯도 여기에서 import."
    >
      <Subsection label="SectionLabel — UPPERCASE 라벨 SSOT (widget-outputs.tsx)">
        <div className="border border-line bg-paper p-6 rounded-sm">
          <SectionLabel>최근 산출물</SectionLabel>
          <div className="mt-2 text-md text-mute">
            text-xs uppercase tracking-[0.22em] text-mute-soft — 위젯 본문 헤더 / 영역 구분 라벨에 사용
          </div>
        </div>
      </Subsection>

      <Subsection label="Field — label + children + 선택적 description (field.tsx)">
        <div className="space-y-5 border border-line bg-paper p-6 rounded-sm">
          <Field label="기본 (label only)">
            <div className="text-md text-ink-2">자식 영역 — 입력/버튼/칩 등</div>
          </Field>
          <Field label="required + description" required description=".md / .txt / .docx 지원">
            <div className="text-md text-ink-2">required=true 시 라벨 옆 amore *</div>
          </Field>
          <Field label="htmlFor 로 native control 연결" htmlFor="ds-demo-field">
            <Input
              id="ds-demo-field"
              defaultValue="htmlFor 시 SectionLabel 대신 진짜 <label>"
            />
          </Field>
        </div>
      </Subsection>

      <Subsection label="ControlBoard — 6 위젯 상단 main control 영역 SSOT (control-board.tsx)">
        <div className="space-y-3">
          <p className="text-md text-mute">
            4-layer compound: <code className="font-mono text-ink-2">StatsRow</code> /{' '}
            <code className="font-mono text-ink-2">SettingsRow</code> /{' '}
            <code className="font-mono text-ink-2">Input</code> /{' '}
            <code className="font-mono text-ink-2">Action</code>. 각 layer 는 모두
            optional — 위젯 별 ordering 자유. 공통 padding{' '}
            <code className="font-mono">px-5 py-4</code> + layer 간{' '}
            <code className="font-mono">border-line-soft</code> separator.
          </p>
          <ControlBoard framed>
            <ControlBoard.StatsRow>
              <ControlBoard.StatTile label="처리한 시간" value="3h 42m" />
              <ControlBoard.StatTile label="평균 시간" value="14m" />
              <ControlBoard.StatTile label="라이브러리" value="6건" />
            </ControlBoard.StatsRow>
            <ControlBoard.SettingsRow>
              <Field label="검색 지역">
                <div className="flex flex-wrap gap-1.5">
                  <Button size="xs" variant="primary">KR</Button>
                  <Button size="xs" variant="ghost">US</Button>
                  <Button size="xs" variant="ghost">JP</Button>
                </div>
              </Field>
              <Field label="수집 기간">
                <div className="flex flex-wrap gap-1.5">
                  <Button size="xs" variant="primary">전체</Button>
                  <Button size="xs" variant="ghost">1주</Button>
                  <Button size="xs" variant="ghost">1개월</Button>
                </div>
              </Field>
            </ControlBoard.SettingsRow>
            <ControlBoard.Input>
              <Field label="키워드">
                <Input placeholder="예: 광고, 재구매, 가격" />
              </Field>
            </ControlBoard.Input>
            <ControlBoard.Action>
              <span className="text-sm tabular-nums text-mute-soft">
                3개 키워드 · 25 크레딧
              </span>
              <ChromeButton variant="primary" size="lg">
                검색
              </ChromeButton>
            </ControlBoard.Action>
          </ControlBoard>
          <p className="text-sm text-mute-soft">
            적용 위젯: Desk / Recruiting / Quotes / Probing / Translate. 위젯 별
            element 종류는 자유 — outer layout 만 통일. Field / SectionLabel /
            Banner 와 함께 사용.
          </p>
        </div>
      </Subsection>

      <Subsection label="WidgetSubHeader — 캡처/언어/세션 CTA 등 설정 영역 SSOT (widget-subheader.tsx)">
        <div className="space-y-3">
          <p className="text-md text-mute">
            3-slot compound: <code className="font-mono text-ink-2">inputs</code>{' '}
            (좌) / <code className="font-mono text-ink-2">options</code> (중) /{' '}
            <code className="font-mono text-ink-2">actions</code> (우) + 선택적{' '}
            <code className="font-mono text-ink-2">hint</code> 줄. 외곽{' '}
            <code className="font-mono">border-b-[2px] border-ink</code> +{' '}
            <code className="font-mono">bg-paper-soft</code> +{' '}
            <code className="font-mono">px-5 py-3</code> 표준. translate /
            probing / desk 3 위젯이 같은 시각 룰.
          </p>

          <div className="text-xs uppercase tracking-[0.22em] text-mute-soft">
            Translate — capture + langs + record + CTA + timer
          </div>
          <div className="border border-line bg-paper rounded-sm overflow-hidden">
            <WidgetSubHeader
              inputs={
                <>
                  <Field label="캡처 방식">
                    <select className="h-8 rounded-xs border border-line bg-paper px-2 text-md text-ink">
                      <option>마이크 + 탭 오디오</option>
                    </select>
                  </Field>
                  <Field label="원어">
                    <select className="h-8 rounded-xs border border-line bg-paper px-2 text-md text-ink">
                      <option>한국어</option>
                    </select>
                  </Field>
                  <Field label="번역 언어">
                    <select className="h-8 rounded-xs border border-line bg-paper px-2 text-md text-ink">
                      <option>영어</option>
                    </select>
                  </Field>
                </>
              }
              options={
                <label className="flex items-center gap-2 pb-1 text-md text-mute">
                  <Checkbox defaultChecked readOnly />
                  오디오 + 전사록 저장
                </label>
              }
              actions={
                <>
                  <span className="text-md tabular-nums text-mute">00:00</span>
                  <ChromeButton variant="primary" size="lg">
                    통역 시작
                  </ChromeButton>
                </>
              }
              hint="공유 창에서 탭을 고른 뒤 '탭 오디오 공유' 를 체크하세요. Chrome 데스크톱만 지원합니다."
            />
          </div>

          <div className="mt-4 text-xs uppercase tracking-[0.22em] text-mute-soft">
            Probing — capture + fullview + session CTA + status hint
          </div>
          <div className="border border-line bg-paper rounded-sm overflow-hidden">
            <WidgetSubHeader
              inputs={
                <Field label="입력 소스">
                  <select className="h-8 rounded-xs border border-line bg-paper px-2 text-md text-ink">
                    <option>마이크</option>
                  </select>
                </Field>
              }
              options={
                <IconButton variant="ghost" size="lg" aria-label="전체보기">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                </IconButton>
              }
              actions={
                <ChromeButton variant="primary" size="lg">
                  세션 시작
                </ChromeButton>
              }
              hint={
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-line" aria-hidden />
                  <SectionLabel>세션 대기</SectionLabel>
                </div>
              }
            />
          </div>

          <div className="mt-4 text-xs uppercase tracking-[0.22em] text-mute-soft">
            Desk — regions + range + keywords + 검색 CTA
          </div>
          <div className="border border-line bg-paper rounded-sm overflow-hidden">
            <WidgetSubHeader
              inputs={
                <div className="w-full space-y-4">
                  <Field label="검색 지역">
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="xs" variant="primary">KR</Button>
                      <Button size="xs" variant="ghost">US</Button>
                      <Button size="xs" variant="ghost">JP</Button>
                    </div>
                  </Field>
                  <Field label="기간">
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="xs" variant="primary">전체</Button>
                      <Button size="xs" variant="ghost">1주</Button>
                      <Button size="xs" variant="ghost">1개월</Button>
                    </div>
                  </Field>
                  <Field label="키워드">
                    <Input placeholder="예: 광고, 재구매, 가격" />
                  </Field>
                </div>
              }
              actions={
                <>
                  <span className="text-sm tabular-nums text-mute-soft">
                    3개 키워드 · 25 크레딧
                  </span>
                  <ChromeButton variant="primary" size="lg">
                    검색 시작
                  </ChromeButton>
                </>
              }
            />
          </div>

          <p className="text-sm text-mute-soft">
            적용 위젯: Translate / Probing / Desk. 다른 위젯
            (Interviews / Quotes / Recruiting 등) 은 후속 spec 으로 확장.
            Layout 흐름: <code className="font-mono">WidgetShell header</code>{' '}
            → <code className="font-mono">WidgetSubHeader</code> →{' '}
            <code className="font-mono">위젯 본문</code>.
          </p>
        </div>
      </Subsection>

      <Subsection label="Banner — 위젯 본문 full-bleed 알림 strip (banner.tsx)">
        <div className="border border-line bg-paper rounded-sm overflow-hidden">
          <div className="px-5 py-4 text-md text-mute">
            위쪽 콘텐츠 영역 (예: 입력/스트리밍)
          </div>
          <Banner tone="warning" title="오류">
            <span className="font-mono">network_timeout</span>
          </Banner>
          <Banner tone="info" title="안내">
            처리에는 5–10분이 소요될 수 있습니다.
          </Banner>
          <Banner tone="subtle">취소되었습니다.</Banner>
        </div>
        <div className="mt-2 text-sm text-mute-soft">
          tones: warning (기본) · info · subtle. divider=&apos;top&apos; (기본) 은 위쪽과 시각 분리, &apos;none&apos; 은 border 없이 color 만으로 구분.
        </div>
      </Subsection>
    </PrimitivePage>
  );
}
