'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DropdownMenu, type DropdownItem } from '@/components/ui/dropdown-menu';
import { ControlTrigger } from '@/components/ui/control-trigger';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { useProjectSelection } from '@/components/project-selection-provider';
import { CreateProjectModal } from '@/components/interviews-v2/create-project-modal';

// 통합 프로젝트 기반 — 공용 ProjectPicker.
//
// 프로젝트 목록(interview_projects SSOT, useInterviewV2Projects)을 드롭다운으로
// 고르는 공용 피커. 각 프로젝트 행은 [이름 | 체크박스] 구조 —
//   - 이름 클릭   → 이 위젯만 그 프로젝트로 선택(onChange)
//   - 오른쪽 체크박스 → 그 프로젝트를 전체 위젯에 1회 적용(applyToAll). 등장한
//     모든 위젯이 같은 프로젝트면 그 행이 체크됨(라디오처럼 하나만).
// 맨 아래 "+ 새 프로젝트" 로 인라인 생성. (별도 kebab ⋯ 버튼 / 하단 "전체 적용"
// 메뉴 항목은 제거 — 전체 적용을 행별 체크박스로 이전.) 인터뷰 결과 생성기의
// 프로젝트 드롭다운 톤(ControlTrigger = Memphis ghost)에 정합.
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
  const { applyToAll, selection } = useProjectSelection();
  const [createOpen, setCreateOpen] = useState(false);

  const selected = projects.find((p) => p.id === value) ?? null;
  const label = selected?.name ?? t('placeholder');

  // "전체 적용" 체크 상태 — 지금까지 등장한 모든 위젯 선택이 동일 프로젝트면
  // 그게 전체 적용된 프로젝트(applyToAll 의 결과)다. 하나라도 다르거나 아직
  // 아무 위젯도 선택 안 했으면 적용된 게 없음(null → 어느 행도 체크 안 됨).
  const selValues = Object.values(selection);
  const appliedToAllId =
    selValues.length > 0 && selValues.every((v) => v === selValues[0])
      ? selValues[0]
      : null;

  // 각 프로젝트 행 = [이름(선택) | 체크박스(전체 적용)] + 맨 아래 "+ 새 프로젝트".
  // 이 위젯의 현재 선택은 이름을 강조해서 표시하고, 전체 적용 여부는 체크박스로.
  const items: DropdownItem[] = [
    ...projects.map((p) => ({
      key: p.id,
      label: (
        <span className={p.id === value ? 'font-semibold text-ink' : undefined}>
          {p.name}
        </span>
      ),
      onSelect: () => onChange(p.id),
      toggle: {
        checked: appliedToAllId === p.id,
        // 라디오처럼: 클릭 시 그 프로젝트를 전체 위젯에 1회 적용(idempotent).
        onToggle: () => applyToAll(p.id),
        ariaLabel: t('applyToAll'),
      },
    })),
    {
      key: '__create__',
      label: t('newProject'),
      onSelect: () => setCreateOpen(true),
    },
  ];

  return (
    <div className={className} data-widget={widget}>
      <DropdownMenu
        items={items}
        trigger={({ onClick, ...aria }) => (
          <ControlTrigger {...aria} onClick={onClick} disabled={isLoading}>
            {label}
          </ControlTrigger>
        )}
      />

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
