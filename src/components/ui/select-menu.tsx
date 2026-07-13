'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Checkbox } from './checkbox';
import { CONTROL_TRIGGER_CLASS, ControlTriggerChevron } from './control-trigger';

// ─── SelectMenu — 범용 dropdown primitive ───────────────────────────────────
// desk-card-body 의 local SelectMenu 를 승격 (위젯 컨트롤 primitive 통일 spec).
// `multi` 면 체크박스 토글, 아니면 선택 시 즉시 닫는 radio-like 동작.
// widget-shell 의 `overflow:hidden` 안에서 absolute 패널이 잘리므로 portal +
// position:fixed 로 escape. 기존 `ui/select.tsx` (native <select> 계열) 과는
// 별개 — 이쪽은 multi/체크박스/커스텀 옵션 렌더가 필요한 listbox 계열.
//
// 역할 구분 (3 계보): SelectMenu = 값 선택(single/multi, listbox/option aria),
// DropdownMenu(ui/dropdown-menu.tsx) = 액션 실행(항목 클릭 → 동작, menu/menuitem
// aria, 선택 시 자동 닫힘), Select(ui/select.tsx) = native <select> 단일선택.
// 새 "값 선택" 컨트롤은 이 프리미티브를 쓰고 자체 포털 드롭다운을 만들지 말 것.

export type SelectMenuOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

type BaseProps = {
  options: SelectMenuOption[];
  placeholder?: string;
  disabled?: boolean;
  buttonClassName?: string;
  renderSummary?: (values: string[]) => ReactNode;
  // Field 의 label 이 <div> (SectionLabel) 일 때 trigger 의 접근성 이름 보강.
  'aria-label'?: string;
};

type SingleProps = BaseProps & {
  multi?: false;
  value: string;
  onChange: (next: string) => void;
};

type MultiProps = BaseProps & {
  multi: true;
  value: string[];
  onChange: (next: string[]) => void;
};

export function SelectMenu(props: SingleProps | MultiProps) {
  const {
    options,
    placeholder,
    disabled,
    buttonClassName,
    renderSummary,
    'aria-label': ariaLabel,
  } = props;
  const values = props.multi ? props.value : props.value ? [props.value] : [];
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const update = () => setRect(wrapRef.current!.getBoundingClientRect());
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function down(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function esc(e: KeyboardEvent | globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', esc as EventListener);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', esc as EventListener);
    };
  }, [open]);

  function toggle(v: string) {
    if (props.multi) {
      props.onChange(
        values.includes(v) ? values.filter((x) => x !== v) : [...values, v],
      );
    } else {
      props.onChange(v);
      setOpen(false);
    }
  }

  const summaryNode = renderSummary
    ? renderSummary(values)
    : values.length === 0
      ? placeholder
      : values.length <= 2
        ? values
            .map((v) => options.find((o) => o.value === v)?.label ?? v)
            .join(', ')
        : `${values.length}개 선택`;

  return (
    <div ref={wrapRef} className="relative" data-ds-primitive="SelectMenu">
      {/* native <button> 허용 — src/components/ui/ 안 (primitive 내부).
          listbox trigger semantics + form-control border/chevron shape. */}
      <button
        type="button"
        data-canvas-action
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel}
        className={buttonClassName ?? CONTROL_TRIGGER_CLASS}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{summaryNode}</span>
        <ControlTriggerChevron />
      </button>
      {open && rect && typeof window !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-multiselectable={props.multi}
            className="menu-in fixed z-overlay max-h-72 overflow-y-auto rounded-xs border-[2px] border-ink bg-paper shadow-memphis-md-card"
            style={{
              left: rect.left,
              top: rect.bottom + 4,
              minWidth: rect.width,
            }}
          >
            {options.map((opt) => {
              const checked = values.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  disabled={opt.disabled}
                  onClick={() => toggle(opt.value)}
                  className={
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-md disabled:opacity-40 ' +
                    (checked ? 'bg-amore-bg text-ink' : 'text-ink hover:bg-paper-soft')
                  }
                >
                  {props.multi ? (
                    <Checkbox
                      checked={checked}
                      readOnly
                      tabIndex={-1}
                      onChange={() => {}}
                    />
                  ) : (
                    <span
                      aria-hidden
                      className={
                        'inline-block h-3 w-3 rounded-full border-[1.5px] ' +
                        (checked ? 'border-amore bg-amore' : 'border-line')
                      }
                    />
                  )}
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
