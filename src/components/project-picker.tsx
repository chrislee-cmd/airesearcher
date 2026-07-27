'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DropdownMenu, type DropdownItem } from '@/components/ui/dropdown-menu';
import { ControlTrigger } from '@/components/ui/control-trigger';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { isComposingEnter } from '@/components/ui/chip-input';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { useToast } from '@/components/toast-provider';

// 보관 액션 아이콘 — 행 hover 시 노출되는 archive 글리프. 풀뷰 pill 과 동일한
// 뚜껑 상자 형태(FullviewProjectPill ARCHIVE_ICON 미러 — 두 표면 UX 일치).
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

// 통합 프로젝트 기반 — 공용 ProjectPicker (V2 세팅 STEP1 피커, PR-C).
//
// 프로젝트 목록(interview_projects SSOT, useInterviewV2Projects)을 드롭다운으로
// 고르는 공용 피커. 각 프로젝트 행은 [이름 | 보관(hover)] 구조 —
//   - 이름 클릭 → 이 위젯만 그 프로젝트로 선택(onChange)
// "＋ 새 프로젝트" 는 모달이 아니라 필드 아래 **인라인 입력행**으로 즉석 생성
// (기존 useInterviewV2Projects().create() 경로 재사용). 인터뷰 결과 생성기의
// 프로젝트 드롭다운 톤(ControlTrigger = Memphis ghost)에 정합.
//
// value/onChange 는 caller 소유 — 위젯은 보통 이걸 useProjectSelection 의
// getSelection(widget)/setSelection(widget, id) 에 바인딩해 "선택은 위젯별 독립"
// 을 실현한다(강제 sync 없음). probing / translate 두 위젯이 이 피커를 공유한다.

export function ProjectPicker({
  widget,
  value,
  onChange,
  className,
  fullWidth = false,
}: {
  // 이 피커가 제어하는 위젯 키('probing' | 'translate' | ...). 라벨/분석 및
  // data-widget 속성에 쓰인다.
  widget: string;
  value: string | null;
  onChange: (projectId: string | null) => void;
  className?: string;
  // 세팅 아코디언 STEP1 에서 트리거를 컬럼 풀폭으로 렌더(언어 SelectMenu·질문
  // Input 과 정렬). DropdownMenu 기본 래퍼는 inline-block(내용폭)이라 그 안의
  // ControlTrigger w-full 이 내용폭이 됨 — fullWidth 로 래퍼를 block w-full 화.
  // 라이브 컨트롤보드(가로 배치)는 미지정 → 기존 내용폭 유지(회귀 0).
  fullWidth?: boolean;
}) {
  const t = useTranslations('ProjectPicker');
  const { projects, isLoading, create, archive, unarchive } =
    useInterviewV2Projects();
  const { push } = useToast();

  // 인라인 생성행 상태 — "＋ 새 프로젝트" 클릭 시 필드 아래 입력행이 펼쳐진다.
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState(false);

  const selected = projects.find((p) => p.id === value) ?? null;
  const label = selected?.name ?? t('placeholder');

  function resetCreate() {
    setCreating(false);
    setDraftName('');
    setSubmitting(false);
    setCreateError(false);
  }

  async function submitCreate() {
    const name = draftName.trim();
    if (!name || submitting) return;
    setSubmitting(true);
    setCreateError(false);
    try {
      const { project } = await create(name);
      if (project) {
        // 생성 직후 이 위젯의 선택을 새 프로젝트로 이동 — 방금 만든 걸 바로 쓰게.
        onChange(project.id);
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
    // 선택 중이던 프로젝트를 보관하면 다른 활성 프로젝트로 선택을 옮긴다(없으면
    // null → 미선택). 풀뷰 pill 과 동일 규칙 — 존재하지 않는 프로젝트 참조 금지.
    const wasSelected = id === value;
    if (wasSelected) {
      const next = projects.find((p) => p.id !== id);
      onChange(next ? next.id : null);
    }
    await archive(id);
    push(t('archivedToast', { name: projectName }), {
      ttlMs: 6000,
      action: {
        label: t('undo'),
        onClick: () => {
          void unarchive(id);
          if (wasSelected) onChange(id);
        },
      },
    });
  }

  // 맨 위 "+ 새 프로젝트"(구분선으로 프로젝트 목록과 분리) + 각 프로젝트 행
  // = [이름(선택) | 보관(hover)]. 생성 액션을 최상단에 고정해 프로젝트 수와
  // 무관하게 항상 같은 위치 → 근육기억 형성. 현재 선택은 이름을 강조.
  const items: DropdownItem[] = [
    {
      key: '__create__',
      label: t('newProject'),
      onSelect: () => {
        setCreateError(false);
        setDraftName('');
        setCreating(true);
      },
      // 생성 액션이 프로젝트 행처럼 안 보이게 아래에 구분선. 프로젝트가 0개면
      // 마지막 항목이라 primitive 쪽에서 구분선을 자동 생략(dangling 방지).
      separatorAfter: true,
    },
    ...projects.map((p) => ({
      key: p.id,
      label: (
        <span className={p.id === value ? 'font-semibold text-ink' : undefined}>
          {p.name}
        </span>
      ),
      onSelect: () => onChange(p.id),
      action: {
        icon: ARCHIVE_ICON,
        onAction: () => void handleArchive(p.id, p.name),
        ariaLabel: t('archive'),
      },
    })),
  ];

  return (
    <div className={className} data-widget={widget}>
      <DropdownMenu
        items={items}
        fullWidth={fullWidth}
        trigger={({ onClick, ...aria }) => (
          <ControlTrigger {...aria} onClick={onClick} disabled={isLoading}>
            {label}
          </ControlTrigger>
        )}
      />

      {creating ? (
        <div className="mt-2 flex flex-col gap-1.5">
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
              placeholder={t('createPlaceholder')}
              aria-label={t('newProject')}
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
              {submitting ? t('creating') : t('createConfirm')}
            </Button>
            <IconButton
              aria-label={t('createCancel')}
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
            <p className="text-xs text-warning">{t('createFailed')}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
