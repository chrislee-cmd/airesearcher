'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DropdownMenu, type DropdownItem } from '@/components/ui/dropdown-menu';
import { ControlTrigger } from '@/components/ui/control-trigger';
import { IconButton } from '@/components/ui/icon-button';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { useProjectSelection } from '@/components/project-selection-provider';
import { CreateProjectModal } from '@/components/interviews-v2/create-project-modal';

// 통합 프로젝트 기반 — 공용 ProjectPicker.
//
// 프로젝트 목록(interview_projects SSOT, useInterviewV2Projects)을 드롭다운으로
// 고르고, 인라인으로 "+ 새 프로젝트" 생성, 그리고 kebab 메뉴의 "전체 위젯에 적용"
// (1회성 applyToAll) 을 제공한다. 인터뷰 결과 생성기의 프로젝트 드롭다운 톤
// (ControlTrigger = Memphis ghost)에 정합.
//
// value/onChange 는 caller 소유 — 위젯은 보통 이걸 useProjectSelection 의
// getSelection(widget)/setSelection(widget, id) 에 바인딩해 "선택은 위젯별 독립"
// 을 실현한다(강제 sync 없음). "전체 위젯에 적용" 만 context 의 applyToAll 을
// 직접 호출한다.
//
// 이 PR = 기반만 — 실제 위젯(프로빙 #542 · 통역 #543) wire 는 후속. 여기선
// 컴포넌트/Provider/훅/스키마까지만 만들고 위젯엔 붙이지 않는다.

export function ProjectPicker({
  widget,
  value,
  onChange,
  className,
}: {
  // 이 피커가 제어하는 위젯 키('probing' | 'translate' | ...). "전체 위젯에 적용"
  // 은 위젯 무관 전역 동작이라 이 값과 독립이지만, 향후 라벨/분석에 쓰이므로 받음.
  widget: string;
  value: string | null;
  onChange: (projectId: string | null) => void;
  className?: string;
}) {
  const t = useTranslations('ProjectPicker');
  const { projects, isLoading, create } = useInterviewV2Projects();
  const { applyToAll } = useProjectSelection();
  const [createOpen, setCreateOpen] = useState(false);

  const selected = projects.find((p) => p.id === value) ?? null;
  const label = selected?.name ?? t('placeholder');

  // 목록 아이템 + 맨 아래 "+ 새 프로젝트" 액션. 선택된 프로젝트엔 ✓ hint.
  const items: DropdownItem[] = [
    ...projects.map((p) => ({
      key: p.id,
      label: p.name,
      hint: p.id === value ? <span aria-hidden>✓</span> : undefined,
      onSelect: () => onChange(p.id),
    })),
    {
      key: '__create__',
      label: t('newProject'),
      onSelect: () => setCreateOpen(true),
    },
  ];

  // "전체 위젯에 적용" — 현재 선택 프로젝트를 모든 위젯에 1회성 반영. 선택이
  // 없으면 적용할 대상이 없으므로 비활성.
  const applyItems: DropdownItem[] = [
    {
      key: 'apply-all',
      label: t('applyToAll'),
      disabled: !value,
      onSelect: () => {
        if (value) applyToAll(value);
      },
    },
  ];

  return (
    <div className={className} data-widget={widget}>
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <DropdownMenu
            items={items}
            trigger={({ onClick, ...aria }) => (
              <ControlTrigger
                {...aria}
                onClick={onClick}
                disabled={isLoading}
              >
                {label}
              </ControlTrigger>
            )}
          />
        </div>
        <DropdownMenu
          align="end"
          items={applyItems}
          trigger={({ open, onClick, ...aria }) => (
            <IconButton
              {...aria}
              data-open={open}
              aria-label={t('menu')}
              variant="ghost"
              size="md"
              onClick={onClick}
            >
              <span aria-hidden>⋯</span>
            </IconButton>
          )}
        />
      </div>

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={async (name, description) => {
          const { project } = await create(name, description);
          if (project) {
            // 생성 직후 이 위젯의 선택을 새 프로젝트로 이동 — 방금 만든 걸 바로 쓰게.
            onChange(project.id);
            setCreateOpen(false);
            return project.id;
          }
          return null;
        }}
      />
    </div>
  );
}
