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
import { useProjectSelection } from '@/components/project-selection-provider';

// 통합 프로젝트 기반 — 공용 ProjectPicker (V2 세팅 STEP1 피커, PR-C).
//
// 프로젝트 목록(interview_projects SSOT, useInterviewV2Projects)을 드롭다운으로
// 고르는 공용 피커. 각 프로젝트 행은 [이름 | 체크박스] 구조 —
//   - 이름 클릭   → 이 위젯만 그 프로젝트로 선택(onChange)
//   - 오른쪽 체크박스 → 그 프로젝트를 전체 위젯에 1회 적용(applyToAll). 등장한
//     모든 위젯이 같은 프로젝트면 그 행이 체크됨(라디오처럼 하나만).
// 메뉴 하단에 안내문(체크=일괄, 미체크=이 위젯)을 footer 로 노출. "＋ 새
// 프로젝트" 는 모달이 아니라 필드 아래 **인라인 입력행**으로 즉석 생성
// (기존 useInterviewV2Projects().create() 경로 재사용). 인터뷰 결과 생성기의
// 프로젝트 드롭다운 톤(ControlTrigger = Memphis ghost)에 정합.
//
// value/onChange 는 caller 소유 — 위젯은 보통 이걸 useProjectSelection 의
// getSelection(widget)/setSelection(widget, id) 에 바인딩해 "선택은 위젯별 독립"
// 을 실현한다(강제 sync 없음). "전체 위젯에 적용" 만 context 의 applyToAll 을
// 직접 호출한다. probing / translate 두 위젯이 이 피커를 공유한다.

export function ProjectPicker({
  widget,
  value,
  onChange,
  className,
  fullWidth = false,
}: {
  // 이 피커가 제어하는 위젯 키('probing' | 'translate' | ...). "전체 위젯에 적용"
  // 은 위젯 무관 전역 동작이라 이 값과 독립이지만, 향후 라벨/분석에 쓰이므로 받음.
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
  const { projects, isLoading, create } = useInterviewV2Projects();
  const { applyToAll, selection } = useProjectSelection();

  // 인라인 생성행 상태 — "＋ 새 프로젝트" 클릭 시 필드 아래 입력행이 펼쳐진다.
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState(false);

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
      onSelect: () => {
        setCreateError(false);
        setDraftName('');
        setCreating(true);
      },
    },
  ];

  return (
    <div className={className} data-widget={widget}>
      <DropdownMenu
        items={items}
        footer={t('applyToAllHint')}
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
