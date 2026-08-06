'use client';

/* ────────────────────────────────────────────────────────────────────
   FullviewHeader — 풀뷰 V2 공유 셸의 헤더 스캐폴드 (design-handoff/
   FULLVIEW-SHELL.md §F3).

   셸은 밴드 레이아웃 + 타이틀 + 닫기 ✕ 만 소유하고, 프로젝트 pill · 상태
   chip · End-session 등 위젯 종속 액션은 slot(props)으로 위젯이 주입한다
   ("셸은 스캐폴드"). 재사용 가능한 프레젠테이션 조각(pill/chip/end-session)
   은 CD 클래스맵대로 여기서 export — 후속 위젯 전환 PR 이 그대로 조합한다.

   band: border-b-2 ink · pad 13/24 · bg = per-widget 파스텔(tone prop).
   title: Outfit 800 · --fv-title-size(22) · ls -0.5 (29px 카드 타이틀 아님).
   close ✕: 32px · fv-radius-close(9) · border 1.5 ink · memphis-sm.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { DropdownMenu, type DropdownItem } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { isComposingEnter } from '@/components/ui/chip-input';
import { useToast } from '@/components/toast-provider';

// 타이틀은 카드(29px) 와 구분되는 풀뷰 전용 타입 — Outfit 800 / --fv-title-size
// / ls -0.5. font-family 는 widget-shell 카드 타이틀과 동일한 런타임 var 소비.
const FV_TITLE_STYLE = {
  fontFamily: 'var(--font-outfit), var(--font-sans)',
  fontSize: 'var(--fv-title-size)',
  fontWeight: 800,
  letterSpacing: '-0.5px',
  lineHeight: 1.1,
} as const;

export function FullviewHeader({
  title,
  tone,
  projectPill,
  statusChip,
  actions,
  tabs,
  onClose,
  closeLabel,
}: {
  title: ReactNode;
  // 헤더밴드 배경 톤 — CSS 값(예: 'var(--widget-header-bg-sky)'). 미지정 시
  // 기본 밴드(투명 → 프레임 bg 상속).
  tone?: string;
  // 위젯 주입 슬롯 — 프로젝트 pill(타이틀 옆) · 상태 chip · 액션(End-session
  // 등). 셸은 자리만 잡고 위젯이 내용/동작을 소유한다.
  projectPill?: ReactNode;
  statusChip?: ReactNode;
  actions?: ReactNode;
  // 옵션 row-2 — 밴드 안쪽 아래줄. recruiting 저니 셸이 3탭 폴더 내비를
  // 여기로 주입(CD row-2). 미지정 위젯은 단일 행(하위호환).
  tabs?: ReactNode;
  // 닫기 ✕ (모달 닫기). 미지정 시 ✕ 미렌더 (풀페이지 chrome 등).
  onClose?: () => void;
  closeLabel?: string;
}) {
  const tCommon = useTranslations('Common');
  const resolvedCloseLabel = closeLabel ?? tCommon('close');
  return (
    // 밴드 = border-b-2 ink + per-widget 파스텔 톤. row-1(액션) 은 항상,
    // row-2(탭) 는 tabs 주입 시에만. 탭이 밴드 하단 border 를 -2px 로 덮어
    // 폴더 오버랩(active=surface-canvas)을 만든다(CD).
    <header
      className="shrink-0 border-b-2 border-ink"
      // tone 은 배경이자, 헤더 하위 DuotoneIcon(프로젝트 pill 등)의 채움 소스.
      // `--widget-tone` 을 여기서 노출하면 pill 아이콘이 각 위젯 헤더 톤을
      // 상속한다(widget-shell 카드의 헤더↔아이콘 매칭과 동일 단일 소스). 미지정
      // 시 DuotoneIcon 기본 폴백(rose 파스텔).
      style={
        tone
          ? ({ background: tone, '--widget-tone': tone } as CSSProperties)
          : undefined
      }
    >
      <div className="flex items-center gap-[11px] px-6 py-[13px]">
        <div className="flex min-w-0 flex-1 items-center gap-[14px]">
          <div className="min-w-0">
            <h2 className="truncate text-ink" style={FV_TITLE_STYLE}>
              {title}
            </h2>
          </div>
          {projectPill}
        </div>
        {statusChip}
        {actions}
        {onClose ? (
          // eslint-disable-next-line react/forbid-elements -- CD §F3 close ✕ 는 32px·fv-radius-close(9)·memphis-sm 스퀘어 chrome 으로 IconButton 의 고정 radius(rounded-xs/full) variant 와 맞지 않음(§7.11: className 으로 variant radius override 불가). 레거시 셸의 닫기 처리와 동일 선례.
          <button
            type="button"
            onClick={onClose}
            aria-label={resolvedCloseLabel}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--fv-radius-close)] border-[1.5px] border-ink bg-paper text-xl font-bold text-ink shadow-memphis-sm"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : null}
      </div>
      {tabs ? (
        <div className="flex items-center gap-1 px-6">{tabs}</div>
      ) : null}
    </header>
  );
}

// ── 재사용 프레젠테이션 조각 (§F3 클래스맵) ─────────────────────────────
// 위젯이 header 슬롯으로 주입한다. 셸은 기본 렌더 안 함 — 위젯 종속.

// 보관 액션 아이콘 — 행 hover 시 노출되는 archive 글리프(뚜껑 달린 상자). 오조작
// 방지를 위해 hover/focus 에서만 보인다(DropdownMenu action 이 opacity 로 제어).
const ARCHIVE_ICON = (
  <svg
    className="h-[15px] w-[15px]"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M2 2.5h12v2.5H2zM3.25 5V13h9.5V5M6.25 8h3.5"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// 프로젝트 pill — project 듀오톤 아이콘 + 이름 + ▾. paper · border 1.5 ink ·
// radius-pill · memphis-sm. (아이콘은 헤더 --widget-tone 상속 — §6-5c.)
//
// 두 모드 (CD closed-state 비주얼은 동일, 동작만 위젯 소유 — BUILD-SPEC §26
// "project dropdown = worker owns"):
//   - display-only (`onSelect`/`projects` 미지정): 정적 <span> — 회귀 0 폴백.
//     아직 피커를 배선 안 한 뷰(desk/quotes/moderator)가 그대로 씀.
//   - interactive (`onSelect` + `projects` 지정): <button> 트리거 + DropdownMenu.
//     클릭 시 프로젝트 목록에서 전환. `onCreateProject` 를 주면 하단에 "+ 새
//     프로젝트" 인라인 생성행, `onArchiveProject` 를 주면 각 행 hover 시 보관
//     액션(undo 토스트 포함)이 붙는다 — 위젯뷰 ProjectPicker 와 동일 UX.
//     드롭다운 open-state 는 CD 미제공(worker-owned) → 공용 DropdownMenu(Memphis).
//
// 생성/보관 뮤테이션은 부모(useInterviewV2Projects 인스턴스 소유)가 콜백으로
// 주입한다 — 부모가 뮤테이션 직후 목록을 refetch 해 `projects` prop 이 갱신되게
// SSOT 를 부모에 유지(별도 훅 인스턴스로 인한 desync 방지).
export function FullviewProjectPill({
  name,
  trailing,
  projects,
  onSelect,
  selectedId,
  menuLabel,
  onCreateProject,
  onArchiveProject,
  onUnarchiveProject,
}: {
  name: ReactNode;
  // 옵션: 이름 뒤 글리프 (기본 ▾ 드롭다운 힌트).
  trailing?: ReactNode;
  // 인터랙티브 모드 — 전환 가능한 프로젝트 목록. `onCreateProject` 가 없으면
  // 목록이 비었을 때 display-only 로 폴백(열어봐야 고를 게 없으므로). 생성 콜백이
  // 있으면 목록이 비어도 "+ 새 프로젝트" 만 담은 드롭다운을 연다(첫 프로젝트 생성).
  projects?: { id: string; name: string }[];
  // 프로젝트 선택 콜백. `projects` 와 함께 지정돼야 인터랙티브해진다. 선택 중
  // 프로젝트를 보관하면 다른 활성 프로젝트로 이동(없으면 null → 미선택)하므로
  // null 을 받는다.
  onSelect?: (projectId: string | null) => void;
  // 현재 선택된 프로젝트 id — 메뉴에서 강조 표시.
  selectedId?: string | null;
  // 인터랙티브 트리거의 접근성 라벨 (예: "프로젝트 메뉴").
  menuLabel?: string;
  // 새 프로젝트 생성 — 이름을 받아 생성된 프로젝트({id})나 null(실패) 반환.
  // 부모의 useInterviewV2Projects().create 배선. 지정 시 "+ 새 프로젝트" 노출.
  onCreateProject?: (name: string) => Promise<{ id: string } | null>;
  // 프로젝트 보관(soft). 지정 시 각 행 hover 에 보관 액션 노출.
  onArchiveProject?: (id: string) => Promise<void> | void;
  // 보관 취소(undo 토스트에서 호출). 지정 시 보관 토스트에 "실행취소" 버튼 노출.
  onUnarchiveProject?: (id: string) => Promise<void> | void;
}) {
  const tPicker = useTranslations('ProjectPicker');
  const { push } = useToast();

  // 인라인 생성행 상태 — ProjectPicker(위젯뷰)와 동일. "+ 새 프로젝트" 클릭 시
  // pill 아래에 floating 입력행이 펼쳐진다(헤더 지오메트리 불변 = pill 외형 유지).
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState(false);

  const content = (
    <>
      {/* 프로젝트 pill 아이콘 — 📁 이모지 대체(§6-5c). 채움은 헤더가 노출한
          `--widget-tone`(각 위젯 헤더 톤) 상속, 셸 1곳 수정으로 6위젯 동시 정리. */}
      <DuotoneIcon name="project" size={16} />
      <span className="text-md font-bold text-ink">{name}</span>
      <span aria-hidden className="text-xs text-ink">
        {trailing ?? '▾'}
      </span>
    </>
  );

  const interactive =
    !!onSelect && !!projects && (projects.length > 0 || !!onCreateProject);
  if (!interactive) {
    return (
      <span className="inline-flex shrink-0 items-center gap-[7px] rounded-pill border-[1.5px] border-ink bg-paper px-3 py-[5px] shadow-memphis-sm">
        {content}
      </span>
    );
  }

  function resetCreate() {
    setCreating(false);
    setDraftName('');
    setSubmitting(false);
    setCreateError(false);
  }

  async function submitCreate() {
    const trimmed = draftName.trim();
    if (!trimmed || submitting || !onCreateProject) return;
    setSubmitting(true);
    setCreateError(false);
    try {
      const created = await onCreateProject(trimmed);
      if (created) {
        // 생성 직후 이 위젯의 선택을 새 프로젝트로 이동 — 방금 만든 걸 바로 쓰게.
        onSelect?.(created.id);
        resetCreate();
        return;
      }
      setCreateError(true);
      setSubmitting(false);
    } catch {
      setCreateError(true);
      setSubmitting(false);
    }
  }

  async function handleArchive(id: string, projectName: string) {
    if (!onArchiveProject) return;
    // 선택 중이던 프로젝트를 보관하면 다른 활성 프로젝트로 선택을 옮긴다(없으면
    // null → 미선택). 존재하지 않는 프로젝트를 가리키는 선택 상태 금지.
    const wasSelected = id === selectedId;
    if (wasSelected) {
      const next = (projects ?? []).find((p) => p.id !== id);
      onSelect?.(next ? next.id : null);
    }
    await onArchiveProject(id);
    push(tPicker('archivedToast', { name: projectName }), {
      ttlMs: 6000,
      action: onUnarchiveProject
        ? {
            label: tPicker('undo'),
            onClick: () => {
              void onUnarchiveProject(id);
              // 보관 전 선택 상태였으면 복원.
              if (wasSelected) onSelect?.(id);
            },
          }
        : undefined,
    });
  }

  // "+ 새 프로젝트" 를 목록 맨 앞에 고정(구분선으로 프로젝트 목록과 분리) —
  // 프로젝트 수와 무관하게 항상 같은 위치라 근육기억이 생긴다(위젯뷰 ProjectPicker
  // 와 동일 규칙). 프로젝트가 0개면 마지막 항목이라 구분선은 자동 생략된다.
  const items: DropdownItem[] = [
    ...(onCreateProject
      ? [
          {
            key: '__create__',
            label: tPicker('newProject'),
            onSelect: () => {
              setCreateError(false);
              setDraftName('');
              setCreating(true);
            },
            separatorAfter: true,
          } satisfies DropdownItem,
        ]
      : []),
    ...(projects ?? []).map((p) => ({
      key: p.id,
      label: (
        <span
          className={p.id === selectedId ? 'font-semibold text-ink' : undefined}
        >
          {p.name}
        </span>
      ),
      onSelect: () => onSelect?.(p.id),
      action: onArchiveProject
        ? {
            icon: ARCHIVE_ICON,
            onAction: () => void handleArchive(p.id, p.name),
            ariaLabel: tPicker('archive'),
          }
        : undefined,
    })),
  ];

  return (
    <span className="relative inline-flex shrink-0">
      <DropdownMenu
        items={items}
        align="start"
        trigger={({ onClick, ...aria }) => (
          // eslint-disable-next-line react/forbid-elements -- 프로젝트 pill 은 CD §F3 전용 chrome(📁 + 이름 + ▾ · radius-pill · border 1.5 ink · memphis-sm)으로 Button primitive variant(고정 radius·형태)와 불일치. 셸 close ✕ / End-session pill 과 동일 선례(native chrome).
          <button
            type="button"
            onClick={onClick}
            aria-label={menuLabel}
            {...aria}
            className="inline-flex shrink-0 items-center gap-[7px] rounded-pill border-[1.5px] border-ink bg-paper px-3 py-[5px] shadow-memphis-sm transition-colors hover:bg-paper-soft focus:outline-none focus-visible:bg-paper-soft"
          >
            {content}
          </button>
        )}
      />
      {creating ? (
        // floating 인라인 생성행 — pill 아래 anchor. 헤더 레이아웃(pill 외형)을
        // 건드리지 않도록 absolute + z-overlay(드롭다운과 동일 레이어).
        <div className="absolute left-0 top-full z-overlay mt-1 flex min-w-[240px] flex-col gap-1.5 rounded-sm border-2 border-ink bg-paper p-2 shadow-memphis-md">
          <div className="flex items-center gap-2">
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value.slice(0, 200))}
              onKeyDown={(e) => {
                // IME 조합 중 Enter 는 음절 확정 — 조기 submit 방지.
                if (e.key === 'Enter' && !isComposingEnter(e)) {
                  e.preventDefault();
                  void submitCreate();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  resetCreate();
                }
              }}
              placeholder={tPicker('createPlaceholder')}
              aria-label={tPicker('newProject')}
              maxLength={200}
              size="sm"
              disabled={submitting}
              autoFocus
            />
            <Button
              variant="primary"
              size="sm"
              onClick={submitCreate}
              disabled={!draftName.trim() || submitting}
              className="shrink-0 whitespace-nowrap"
            >
              {submitting ? tPicker('creating') : tPicker('createConfirm')}
            </Button>
            <IconButton
              aria-label={tPicker('createCancel')}
              size="sm"
              variant="ghost"
              onClick={resetCreate}
              disabled={submitting}
              className="shrink-0"
            >
              <span aria-hidden>✕</span>
            </IconButton>
          </div>
          {createError ? (
            <p className="text-xs text-warning">{tPicker('createFailed')}</p>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}

// 상태 chip — mono 11/700, dot(live=amore · rec=rec). paper · border 1.5 ink
// · radius-pill.
export function FullviewStatusChip({
  label,
  tone = 'live',
}: {
  label: ReactNode;
  tone?: 'live' | 'rec';
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border-[1.5px] border-ink bg-paper px-[11px] py-1 font-mono-label text-sm font-bold text-ink">
      <span
        aria-hidden
        className={`h-[7px] w-[7px] rounded-full ${
          tone === 'rec' ? 'bg-rec' : 'bg-amore'
        }`}
      />
      {label}
    </span>
  );
}

// Done 배지 — 완료 상태 표시(§F3 Done badge / CD state 05 헤더). bg success-bg
// · border 1.4 success-line · text success-text · ✓ in success circle. 상태
// chip 과 달리 dot 이 아니라 ✓ 원형. 세션/상태 없는 정적 완료 표식.
export function FullviewDoneBadge({ label }: { label: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border-[1.4px] border-success-line bg-success-bg px-3 py-[5px] text-sm font-bold text-success-text">
      <span
        aria-hidden
        className="inline-flex h-[15px] w-[15px] items-center justify-center rounded-full bg-success text-xs text-paper"
      >
        ✓
      </span>
      {label}
    </span>
  );
}

// End-session 버튼 — border 2 amore-deep · text amore-deep · radius-pill ·
// fv-shadow-crimson. behavior(위젯 stop 액션 미러)는 소비처가 onClick 으로.
export function FullviewEndSessionButton({
  onClick,
  label,
}: {
  onClick?: () => void;
  label: ReactNode;
}) {
  return (
    // eslint-disable-next-line react/forbid-elements -- CD §F3 End-session 은 amore-deep pill(border 2·text·fv-shadow-crimson) 전용 chrome 으로 Button primitive variant 와 불일치. destructive variant 는 solid fill 이라 CD 의 outline+crimson-memphis 와 다름.
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-[7px] rounded-pill border-2 border-amore-deep bg-paper px-3.5 py-1.5 text-md font-extrabold text-amore-deep shadow-[var(--fv-shadow-crimson)]"
    >
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rounded-2xs bg-amore-deep"
      />
      {label}
    </button>
  );
}
