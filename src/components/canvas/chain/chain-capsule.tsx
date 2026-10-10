'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainCapsule — 엣지 위에 붙는 결정 표면 (fresh 프레젠테이션).

   CD SSOT: `v2/README.md` S2·S2b·S4·S5·S6·S7 · `widget-chain-v2.dc.html` capsule.

   R3: 승인·충전·실패 안내는 **해당 엣지 가운데 위 캡슐 하나**로 처리한다.
   모달과 토스트는 쓰지 않는다. 체인 종료에 확인 모달도 없다(데이터가 지워지지
   않고, 종료 캡슐 문구가 그 사실을 알려준다).

   **캡슐은 아래쪽(엣지에 붙는 쪽)을 기준으로 고정**하고 내용이 늘면 위로 자란다
   — 피커가 들어가는 S2b 에서도 엣지와의 연결 위치가 변하지 않는다.

   데이터 0 — `ChainView` 에서 파생한 값과 콜백만 받는다.
   ──────────────────────────────────────────────────────────────────── */

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PickerTrigger, SingleSelectPanel } from '@/components/ui/picker';
import { usePopoverBase } from '@/components/ui/use-popover-base';

export type ChainCapsuleTone = 'amber' | 'error' | 'success' | 'neutral';

/** 테두리·도트·eyebrow·액션 행 — 톤 4종 (CD CAPT). */
const TONE: Record<
  ChainCapsuleTone,
  { frame: string; dot: string; eyebrow: string; row: string; line: string }
> = {
  amber: {
    frame: 'border-amber',
    dot: 'bg-amber',
    eyebrow: 'text-amber-text',
    row: 'bg-warning-bg',
    line: 'border-amber-line',
  },
  error: {
    frame: 'border-error',
    dot: 'bg-error',
    eyebrow: 'text-error-text',
    row: 'bg-error-bg',
    line: 'border-error-line',
  },
  success: {
    frame: 'border-success',
    dot: 'bg-success',
    eyebrow: 'text-success-text',
    row: 'bg-success-bg',
    line: 'border-success-line',
  },
  neutral: {
    frame: 'border-ink',
    dot: 'bg-mute-soft',
    eyebrow: 'text-mute',
    row: 'bg-paper-soft',
    line: 'border-ink/[0.12]',
  },
};

/** 캡슐 아래 엣지로 내려가는 세로선 색(테두리와 같은 톤). */
const STEM: Record<ChainCapsuleTone, string> = {
  amber: 'bg-amber',
  error: 'bg-error',
  success: 'bg-success',
  neutral: 'bg-ink',
};

export type ChainCapsuleProject = { id: string; name: string };

export type ChainCapsuleProps = {
  tone: ChainCapsuleTone;
  /** mono 대문자 eyebrow — "다음 · 인터뷰 분석" / "멈춤 · …" / "4/4 완료". */
  eyebrow: string;
  /** 우상단 비용 표기. 없으면 생략. */
  cost?: string | null;
  /** 메시지 3분할. 가운데(msgB)만 ink 로 강조한다 — CD 의 msgA · msgB · msgC. */
  msgA: string;
  msgB: string;
  msgC: string;
  /**
   * v3 — eyebrow 앞 24px 원 글리프(? / Ⅱ / ✕ / ✓). CD v3 Geometry.
   * 미지정이면 v2 의 8px 도트를 그린다.
   */
  glyph?: string | null;
  /** 체인 종료 텍스트 버튼 노출. */
  onCancel?: () => void;
  /** 보조 pill (건너뛰기 / 재개 / 닫기). */
  secondary?: { label: string; onClick: () => void };
  /** 주 버튼. locked 면 잠금 형태(선택 전 — S2b). */
  primary: { label: string; onClick: () => void; locked?: boolean };
  busy?: boolean;

  // ── S2b 프로젝트 피커 (데이터는 컨테이너 소유) ──
  picker?: {
    projects: ChainCapsuleProject[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onCreate: () => void;
  };
};

export function ChainCapsule({
  tone,
  eyebrow,
  cost,
  msgA,
  msgB,
  msgC,
  glyph,
  onCancel,
  secondary,
  primary,
  busy = false,
  picker,
}: ChainCapsuleProps) {
  const t = useTranslations('Chain');
  const c = TONE[tone];

  return (
    // 아래쪽 정렬 = "내용이 늘면 위로 자란다" 불변식. 바깥 래퍼는 호스트가 엣지
    // 앵커 기준으로 배치하고, 여기선 정렬만 보장한다.
    <div
      data-chain="capsule"
      data-chain-capsule-tone={tone}
      className="flex w-[400px] flex-col items-center"
    >
      <div
        className={`w-[400px] overflow-hidden rounded-panel border-2 bg-paper shadow-popover ${c.frame}`}
      >
        <div className="flex items-center gap-2 px-[13px] pt-[9px]">
          {glyph ? (
            <span
              aria-hidden
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-sm font-extrabold ${c.frame} ${c.row} ${c.eyebrow}`}
            >
              {glyph}
            </span>
          ) : (
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-full ${c.dot}`}
            />
          )}
          <span
            className={`font-mono text-xs font-extrabold tracking-[0.1em] uppercase ${c.eyebrow}`}
          >
            {eyebrow}
          </span>
          {cost && (
            <span className="ml-auto font-mono text-sm font-extrabold text-ink">
              {cost}
            </span>
          )}
        </div>

        <div className="px-[13px] pt-1.5 pb-2.5 text-md leading-[1.55] text-ink-2">
          {msgA}
          <b className="text-ink">{msgB}</b>
          {msgC}
        </div>

        {picker && (
          <div className="px-[13px] pb-2.5">
            <CapsuleProjectPicker {...picker} />
          </div>
        )}

        <div
          className={`flex items-center gap-2.5 border-t-[1.5px] px-[13px] py-2 ${c.line} ${c.row}`}
        >
          {onCancel && (
            // eslint-disable-next-line react/forbid-elements -- CD 액션 행의 "체인 종료" 는 패딩·보더·밑줄 없는 bare 텍스트(11.5/700 mute). Button variant="link" 는 size padding + hover 밑줄을 강제하고 className 되돌리기는 §7.11(컴파일 CSS 소스 순서) 때문에 불확정.
            <button
              type="button"
              data-chain-action="cancel"
              onClick={onCancel}
              disabled={busy}
              className="text-sm font-bold text-mute transition-colors hover:text-ink disabled:opacity-40"
            >
              {t('action.cancel')}
            </button>
          )}
          <span className="ml-auto" />
          {secondary && (
            // eslint-disable-next-line react/forbid-elements -- CD 보조 pill 은 border 1.5 ink · radius-pill · shadow 2px2px0 ink/12 전용 chrome. Button variant="secondary" 는 border-2.5 · rounded-sm · shadow-memphis-md 고정이라 형태 불일치(규칙 2c AUTHORITY).
            <button
              type="button"
              data-chain-action="secondary"
              onClick={secondary.onClick}
              disabled={busy}
              className="inline-flex shrink-0 items-center rounded-pill border-[1.5px] border-ink bg-paper px-[13px] py-1.5 text-md font-bold text-ink shadow-memphis-sm-faint transition-colors hover:bg-paper-soft disabled:opacity-40"
            >
              {secondary.label}
            </button>
          )}
          {/* eslint-disable-next-line react/forbid-elements -- CD 주 버튼은 border 2 · radius-pill · shadow 2px2px0 ink/28(shadow-memphis-sm-mid) + "잠김" 상태(surface-disabled·faint·그림자 없음)를 가진다. Button primitive 에 없는 형태·상태라 native. */}
          <button
            type="button"
            data-chain-action="primary"
            data-chain-locked={primary.locked ? 'true' : 'false'}
            onClick={primary.onClick}
            disabled={primary.locked || busy}
            className={
              primary.locked
                ? 'inline-flex shrink-0 items-center rounded-pill border-2 border-ink/[0.2] bg-surface-disabled px-[15px] py-1.5 text-md font-extrabold text-mute-soft'
                : 'inline-flex shrink-0 items-center rounded-pill border-2 border-ink bg-ink px-[15px] py-1.5 text-md font-extrabold text-paper shadow-memphis-sm-mid disabled:opacity-40'
            }
          >
            {primary.label}
          </button>
        </div>
      </div>
      {/* 캡슐 ↔ 엣지 연결선 2×12 */}
      <span aria-hidden className={`h-3 w-0.5 ${STEM[tone]}`} />
    </div>
  );
}

// 피커는 기존 Picker 시스템(SSOT §D3) 재사용 — 패널은 body 로 portal 되고
// z-overlay 라 캡슐(z-6) 위로 뜬다.
function CapsuleProjectPicker({
  projects,
  selectedId,
  onSelect,
  onCreate,
}: NonNullable<ChainCapsuleProps['picker']>) {
  const t = useTranslations('Chain');
  const [open, setOpen] = useState(false);
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const { triggerRef, panelRef, anchorRect } = usePopoverBase<
    HTMLDivElement,
    HTMLDivElement
  >({ open, onClose: () => setOpen(false) });

  const picked = projects.find((p) => p.id === selectedId) ?? null;
  const options = [
    { value: '__new', label: t('picker.newProject') },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <div ref={triggerRef} data-chain-el="picker">
      <PickerTrigger
        ref={triggerButtonRef}
        open={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full justify-between"
      >
        {picked?.name ?? t('picker.placeholder')}
      </PickerTrigger>
      {open && anchorRect && (
        <SingleSelectPanel
          panelRef={panelRef}
          anchorRect={anchorRect}
          width={260}
          sectionLabel={t('picker.sectionLabel')}
          options={options}
          value={selectedId ?? ''}
          onSelect={(value) => {
            setOpen(false);
            if (value === '__new') onCreate();
            else onSelect(value);
          }}
          onClose={() => setOpen(false)}
          returnFocusRef={triggerButtonRef}
        />
      )}
    </div>
  );
}

/** 호스트가 캡슐 래퍼를 엣지 앵커에 맞출 때 쓰는 고정 폭(CD 400). */
export const CAPSULE_WIDTH = 400;
