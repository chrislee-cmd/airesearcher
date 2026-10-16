'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainInspectorField — 인스펙터 설정 폼의 **공용 렌더러 1개**.

   비주얼 SSOT = `chain-inspector-scenes.dc.html` I2 · I3 · I3b.
   형식 SSOT = `design-handoff/chain-inspector/README.md` §4.4(요소 표) · §5(잠금).

   **위젯별 분기 0** (CD §10 Done-when): `ui-meta.inspectorSchema` 의 `kind`
   하나로만 컨트롤을 고른다. 노드가 추가돼도 이 파일은 그대로다 — 새 컨트롤이
   필요하면 `ChainStepFieldKind` 에 kind 를 더하는 것이 유일한 변경 지점이다.

   **잠금은 `opacity` 를 쓰지 않는다**(§5 · §10 Done-when "opacity 0건").
   면을 `--fill` 로, 글자를 `--faint` 로 바꾸고 테두리를 없앤다. 래퍼에 opacity
   를 걸면 (가) 글자 대비가 지정값과 달라지고 (나) 중첩된 면이 전부 흐려져
   "선택됨" 이 안 읽힌다 — 그래서 선택된 세그먼트 칩만 `--fill-locked-on` 으로
   한 단계 진한 면을 받는다.

   native `<select>`/`<textarea>` 를 쓰는 이유: `Select`/`Textarea` primitive 는
   아직 Memphis 값(`rounded-sm` 14 · `border-line` ink/10 · focus amore)이고 CD
   는 radius 10 · `--line` · focus ink + `--focus-ring` 를 지정한다. className
   으로 되돌리면 §7.11(컴파일 CSS 소스 순서)에서 base 가 이기는 쪽이 불확정
   이고, primitive 를 Soft 로 바꾸는 것은 전 앱 공유 변경이라 별 PR 이다
   (AUTHORITY: CD 값을 가까운 DS 기본값으로 굽히지 않는다).
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useRef, useState } from 'react';
import type { ChainStepFieldDef } from '@/lib/chains/ui-meta';
import type { ChainTranslate } from '@/lib/chains/card-state';

/** CD §4.4 — 세그먼트 컨트롤은 옵션 4개 이상이면 select 로 바꾼다. */
const SEGMENT_MAX_OPTIONS = 3;

/** orderedList 항목 수 상한의 안전망 — 선언에 없을 때만. */
const DEFAULT_MAX_ITEMS = 30;

export type ChainInspectorFieldProps = {
  field: ChainStepFieldDef;
  /** 지금 값(낙관적 반영 포함). */
  value: unknown;
  /** 이 필드가 필수인가 — 라벨 옆 "필수" 표시. */
  required: boolean;
  /** 실행 중·완료 단계 = 읽기 전용(§5). */
  locked: boolean;
  /** 루트 스코프 번역 — `labelKey` 가 전체 경로다. */
  t: ChainTranslate;
  onChange: (value: unknown) => void;
  /** 읽기 전용 행에 쓰이는 파생 표시값. */
  readonlyRow?: ChainReadonlyRow;
};

/** 읽기 전용 행(§4.4 마지막 행) — 앞 단계 입력 · 체인 공통 값. */
export type ChainReadonlyRow = {
  /** 값 한 줄 — 12.5/600. */
  value: string;
  /** 설명 한 줄 — 11 mute. */
  sub: string;
  /** 오른쪽 칩 문구 — "앞 단계" 또는 "체인 공통". */
  chip: string;
  /** 앞 단계 톤 타일 색. 체인 공통이면 null(중립 면). */
  tone: 'sky' | 'lav' | 'rose' | null;
};

export function ChainInspectorField(props: ChainInspectorFieldProps) {
  const { field, locked, t, required } = props;
  const label = t(field.labelKey);
  const hint = field.hintKey ? t(field.hintKey) : null;

  // 토글만 "라벨 왼쪽 + 스위치 오른쪽 한 줄" 이다(§4.4).
  if (field.kind === 'toggle') {
    return (
      <div
        data-chain-field={field.id}
        data-chain-field-kind="toggle"
        className="flex min-h-[38px] items-center gap-3"
      >
        <span className="flex flex-1 flex-col gap-0.5">
          <span
            className={`text-md font-semibold ${locked ? 'text-soft-mute' : 'text-soft-ink-2'}`}
          >
            {label}
          </span>
          {hint && <span className="text-sm text-soft-faint">{hint}</span>}
        </span>
        <Switch
          on={props.value === true}
          locked={locked}
          label={label}
          onToggle={() => props.onChange(!(props.value === true))}
        />
      </div>
    );
  }

  return (
    <div
      data-chain-field={field.id}
      data-chain-field-kind={field.kind}
      className="flex flex-col gap-1.5"
    >
      <span className="flex items-baseline gap-2">
        <span
          className={`text-md font-semibold ${locked ? 'text-soft-mute' : 'text-soft-ink-2'}`}
        >
          {label}
        </span>
        {required && (
          <span className="text-xs-soft text-soft-faint">
            {t('Chain.inspector.required')}
          </span>
        )}
        {hint && <span className="ml-auto text-sm text-soft-faint">{hint}</span>}
      </span>
      <FieldControl {...props} />
    </div>
  );
}

function FieldControl({
  field,
  value,
  locked,
  t,
  onChange,
  readonlyRow,
}: ChainInspectorFieldProps) {
  switch (field.kind) {
    case 'readonly':
    case 'dropzone':
      // dropzone 도 읽기 전용 행으로 그린다 — 업로드의 거처가 config 가 아니라
      // 기존 업로드 경로(audio-uploads + transcript_jobs)이고, 여기서 받은 파일을
      // 저장할 계약이 없다(step-config 가 쓰기를 거절한다). 동작하지 않는
      // 드롭존을 그리는 대신 그 파일이 어디서 오는지 말한다. PR 본문에 명시한
      // 보수적 해석 — 체인 첫 단계 전사록의 파일 투입 경로는 후속 결정 대상.
      return readonlyRow ? <ReadonlyRow row={readonlyRow} /> : null;

    case 'segment': {
      const options = field.options ?? [];
      if (options.length > SEGMENT_MAX_OPTIONS) {
        return (
          <SelectControl
            field={field}
            value={value}
            locked={locked}
            t={t}
            onChange={onChange}
          />
        );
      }
      return (
        <div
          role="radiogroup"
          aria-label={t(field.labelKey)}
          className="flex rounded-pill bg-soft-fill p-[3px]"
        >
          {options.map((o) => {
            const on = value === o.value;
            return (
              // eslint-disable-next-line react/forbid-elements -- 세그먼트 셀은 트랙이 chrome 을 소유하는 bare 셀이다(§4.4 "--fill 트랙 pad 3 + 흰 선택 칩"). Button primitive 는 셀마다 자기 보더·패딩을 그려 트랙이 성립하지 않는다 — 레인 헤더 ModeCell 과 같은 선례.
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={locked}
                data-chain-action="segment"
                onClick={() => onChange(o.value)}
                className={`flex-1 rounded-pill py-1.5 text-md transition-colors ${
                  on
                    ? locked
                      ? 'bg-soft-fill-locked-on font-semibold text-soft-faint'
                      : 'bg-soft-surface font-semibold text-ink shadow-soft-chip'
                    : locked
                      ? 'text-soft-faint'
                      : 'text-soft-mute hover:text-ink'
                }`}
              >
                {t(o.labelKey)}
              </button>
            );
          })}
        </div>
      );
    }

    case 'select':
      return (
        <SelectControl
          field={field}
          value={value}
          locked={locked}
          t={t}
          onChange={onChange}
        />
      );

    case 'textarea':
      return (
        // eslint-disable-next-line react/forbid-elements -- CD §4.4 textarea 는 min-h 78 · pad 10/12 · radius 10 · 1px --line · focus ink + --focus-ring 이고, Textarea primitive 는 아직 Memphis 값(rounded-sm 14 · border-line ink/10 · focus amore)이다. className 되돌리기는 §7.11 로 불확정 — 파일 머리 주석 참고.
        <textarea
          data-canvas-action
          value={typeof value === 'string' ? value : ''}
          maxLength={field.maxLength}
          disabled={locked}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
          className={`min-h-[78px] w-full resize-y rounded-control px-3 py-2.5 text-lg leading-[1.6] ${
            locked
              ? 'border-0 bg-soft-fill text-soft-faint'
              : 'border border-soft-line bg-soft-surface text-ink placeholder:text-soft-faint focus:outline-none focus-visible:border-ink focus-visible:shadow-soft-focus-ring'
          }`}
        />
      );

    case 'orderedList':
      return (
        <OrderedList
          field={field}
          value={Array.isArray(value) ? (value as unknown[]).map(String) : []}
          locked={locked}
          t={t}
          onChange={onChange}
        />
      );

    default:
      return null;
  }
}

// ── select ──────────────────────────────────────────────────────────────

function SelectControl({
  field,
  value,
  locked,
  t,
  onChange,
}: Pick<
  ChainInspectorFieldProps,
  'field' | 'value' | 'locked' | 't' | 'onChange'
>) {
  const options = field.options ?? [];
  const current = typeof value === 'string' ? value : '';
  return (
    <div className="relative">
      {/* native <select> — `react/forbid-elements` 금지 목록(button/input/
          textarea)에 select 는 없다. Select primitive 를 안 쓰는 이유는 파일 머리
          주석과 같다(Memphis 값 · §7.11). */}
      <select
        data-canvas-action
        aria-label={t(field.labelKey)}
        value={current}
        disabled={locked}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        className={`h-[38px] w-full appearance-none rounded-control pr-8 pl-3 text-lg ${
          locked
            ? 'border-0 bg-soft-fill text-soft-faint'
            : 'border border-soft-line bg-soft-surface text-ink focus:outline-none focus-visible:border-ink focus-visible:shadow-soft-focus-ring'
        }`}
      >
        {/* 빈 값 = 미설정. 체인 단계는 품질을 좌우하는 필드에 기본값을 두지
            않는다(필드정의 §1) — 그래서 "고르지 않음" 이 유효한 상태다. */}
        <option value="">{t('Chain.inspector.selectPlaceholder')}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.labelKey)}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-soft-faint"
      >
        ▼
      </span>
    </div>
  );
}

// ── toggle ──────────────────────────────────────────────────────────────

function Switch({
  on,
  locked,
  label,
  onToggle,
}: {
  on: boolean;
  locked: boolean;
  label: string;
  onToggle: () => void;
}) {
  // 잠금 색은 CD §5 지정값: on → --faint(#9a96a1) · off → --line(#e7e5ea).
  const track = locked
    ? on
      ? 'bg-soft-faint'
      : 'bg-soft-line'
    : on
      ? 'bg-ink'
      : 'bg-soft-line-hover';
  return (
    // eslint-disable-next-line react/forbid-elements -- 스위치 primitive 가 없다(§9 카탈로그에 Switch 미등재). CD §4.4 지정 치수(트랙 36×20 · 노브 16 · on ink / off --line-hover)의 전용 chrome 이라 Button primitive 로는 표현 불가. Checkbox 는 네모 체크박스로 형태가 다르다.
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={locked}
      data-chain-action="toggle"
      onClick={onToggle}
      style={{ width: 36, height: 20 }}
      className={`relative shrink-0 rounded-pill transition-colors ${track} focus:outline-none focus-visible:shadow-soft-focus-ring`}
    >
      <span
        aria-hidden
        style={{ width: 16, height: 16, top: 2, left: on ? 18 : 2 }}
        className="absolute rounded-full bg-soft-surface transition-[left] duration-[var(--dur-fast)] motion-reduce:transition-none"
      />
    </button>
  );
}

// ── 순서 목록 ───────────────────────────────────────────────────────────

function OrderedList({
  field,
  value,
  locked,
  t,
  onChange,
}: {
  field: ChainStepFieldDef;
  value: string[];
  locked: boolean;
  t: ChainTranslate;
  onChange: (next: unknown) => void;
}) {
  const maxItems = field.maxItems ?? DEFAULT_MAX_ITEMS;
  const listRef = useRef<HTMLDivElement | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const commit = useCallback(
    (next: string[]) => {
      // 빈 항목은 저장하지 않는다 — "+ 항목 추가" 직후의 빈 줄이 jsonb 에
      // 쌓이면 다음 사람이 유효한 설정인지 구분할 수 없다. 빈 배열은 `null`
      // 로 보내 그 키를 비운다(RFC 7396 — 선택 필드를 되돌리는 유일한 수단).
      const cleaned = next.map((s) => s.trim()).filter((s) => s.length > 0);
      onChange(cleaned.length === 0 ? null : cleaned);
    },
    [onChange],
  );

  const move = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= value.length || from === to) return;
      const next = [...value];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      commit(next);
    },
    [value, commit],
  );

  /**
   * 드래그 재정렬은 **기하 판정**이다 — `dragenter`/`dragleave` 를 쓰지 않는다
   * (CD §9 · LEARNINGS §2-2: 포함-관계 판정은 자식 진입마다 leave 가 터져
   * 진동한다). 포인터 Y 하나를 행 rect 들과 비교해 목표 index 를 고른다.
   */
  const onHandleMove = useCallback(
    (clientY: number): number | null => {
      const el = listRef.current;
      if (!el) return null;
      const rows = [...el.querySelectorAll<HTMLElement>('[data-chain-list-row]')];
      for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i].getBoundingClientRect();
        if (clientY >= r.top && clientY <= r.bottom) return i;
      }
      return null;
    },
    [],
  );

  return (
    <div ref={listRef} className="flex flex-col gap-1.5">
      {value.map((item, i) => (
        <div
          key={`${i}-${item.slice(0, 12)}`}
          data-chain-list-row={i}
          className={`flex h-[38px] items-center gap-2.5 rounded-icon px-2.5 ${
            locked ? 'bg-soft-fill' : 'border border-soft-hair bg-soft-surface'
          } ${dragFrom === i ? 'shadow-soft-chip' : ''}`}
        >
          <span className="font-soft-mono text-sm text-soft-faint">
            {String(i + 1).padStart(2, '0')}
          </span>
          {locked ? (
            <span className="min-w-0 flex-1 truncate text-md text-soft-faint">
              {item}
            </span>
          ) : (
            // eslint-disable-next-line react/forbid-elements -- 행 안 인라인 편집 필드는 chrome 이 **행**에 있다(§4.4 "행 38 · radius 9 · 1px --hair" 안의 bare 텍스트). Input primitive 는 자기 보더·radius·패딩을 그려 행 안에 이중 프레임이 생긴다.
            <input
              data-canvas-action
              value={item}
              maxLength={field.itemMaxLength}
              aria-label={`${t(field.labelKey)} ${i + 1}`}
              onChange={(e) => {
                const next = [...value];
                next[i] = e.target.value;
                commit(next);
              }}
              className="min-w-0 flex-1 bg-transparent text-md text-ink focus:outline-none"
            />
          )}
          {!locked && (
            // eslint-disable-next-line react/forbid-elements -- ⋮ 재정렬 핸들(§4.4 "mono 번호 + 텍스트 + ⋮"). 그림자·보더·패딩 없는 bare 글리프 + 포인터 드래그 + 화살표 키 이동을 들고 다녀야 해 IconButton(자기 chrome·고정 치수)으로는 표현되지 않는다.
            <button
              type="button"
              data-chain-action="reorder"
              aria-label={t('Chain.inspector.reorder', { n: i + 1 })}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragFrom(i);
              }}
              onPointerMove={(e) => {
                if (dragFrom === null) return;
                const to = onHandleMove(e.clientY);
                if (to !== null && to !== dragFrom) {
                  move(dragFrom, to);
                  setDragFrom(to);
                }
              }}
              onPointerUp={() => setDragFrom(null)}
              onPointerCancel={() => setDragFrom(null)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  move(i, i - 1);
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  move(i, i + 1);
                }
              }}
              className="shrink-0 cursor-grab text-lg text-soft-disabled transition-colors hover:text-soft-mute focus:outline-none focus-visible:text-ink"
            >
              <span aria-hidden>⋮</span>
            </button>
          )}
        </div>
      ))}
      {!locked && value.length < maxItems && (
        // eslint-disable-next-line react/forbid-elements -- "+ 항목 추가" 는 CD §4.4 가 "텍스트 버튼" 으로 지정한 bare 텍스트(12.5/600 ink-2 · 패딩 4/2)다. Button variant="link" 는 size padding + hover 밑줄 + mute 색을 강제한다(§7.11 로 되돌리기 불확정).
        <button
          type="button"
          data-chain-action="list-add"
          onClick={() => onChange([...value, ''])}
          className="self-start px-0.5 py-1 text-md font-semibold text-soft-ink-2 transition-colors hover:text-ink"
        >
          {t('Chain.inspector.addItem')}
        </button>
      )}
    </div>
  );
}

// ── 읽기 전용 행 ────────────────────────────────────────────────────────

const ROW_TONE: Record<'sky' | 'lav' | 'rose', string> = {
  sky: 'bg-sky',
  lav: 'bg-lav',
  rose: 'bg-rose',
};

function ReadonlyRow({ row }: { row: ChainReadonlyRow }) {
  return (
    <div
      data-chain-el="readonly-row"
      className="flex items-center gap-2.5 rounded-control border border-soft-hair bg-soft-surface-2 px-3 py-2.5"
    >
      <span
        aria-hidden
        style={{ width: 26, height: 26 }}
        className={`flex shrink-0 items-center justify-center rounded-tile ${
          row.tone ? ROW_TONE[row.tone] : 'bg-soft-fill'
        }`}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-md font-semibold text-ink">{row.value}</span>
        <span className="text-sm text-soft-mute">{row.sub}</span>
      </span>
      <span className="shrink-0 rounded-pill bg-soft-fill px-2 py-0.5 text-xs-soft font-semibold whitespace-nowrap text-soft-mute">
        {row.chip}
      </span>
    </div>
  );
}
