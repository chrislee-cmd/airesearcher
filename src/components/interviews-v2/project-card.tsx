'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import DuotoneIcon from '@/components/ui/icons/duotone-icon';

// ════════════════════════════════════════════════════════════════════════
// 인터뷰 프로젝트 목록 카드 — CD S6·6a 프레젠테이션 (fresh build, BUILD-SPEC §1.4).
// 프레임: border 2px ink · radius 12(rounded-panel) · shadow 3px3px0 ink/14
//         (shadow-memphis-md-faint). 헤더 스트립 = 상태 틴트 + 프로젝트 듀오톤
//         아이콘 + 이름 + 상태 뱃지. 본문은 컨테이너(project-list)가 목록 훅
//         데이터로 채워 children 으로 넘긴다 — 이 컴포넌트는 순수 프레젠테이션.
//
// 색·radius·shadow 는 파운데이션 승격 토큰(유틸). 1.5px 헤더 하단선은 CD 정밀값
// 이라 인라인 스타일(.dc.html 관례 — card-parts CardControlBar 와 동일 패턴).
//
// 상태 4종(done/generating/none/error)은 CD 프레임을 전수 지원한다. 라이브
// 배선은 컨테이너 소유 — 목록 훅이 topline 상태를 제공하지 않으므로(훅/API
// 무변경 제약) 현재는 파일 존재로 done/none 만 파생한다(project-list 주석).
// ════════════════════════════════════════════════════════════════════════

export type ProjectCardStatus = 'done' | 'generating' | 'none' | 'error';

const TINT: Record<ProjectCardStatus, string> = {
  done: 'bg-rose-bg',
  generating: 'bg-lav-bg',
  none: 'bg-paper-soft',
  error: 'bg-error-bg',
};

// 상태 뱃지 — mono micro-chip (CD: 9.5/800 · radius 6 · border 1.4).
function StatusBadge({ status }: { status: ProjectCardStatus }) {
  const t = useTranslations('InterviewsV2');
  const common =
    'inline-flex shrink-0 items-center gap-1 rounded-chip border font-mono-label font-bold';
  const style = { fontSize: 9.5, padding: '2px 7px' };
  if (status === 'done') {
    return (
      <span
        className={`${common} border-success-line bg-success-bg text-success-text`}
        style={style}
      >
        {t('cardStatusDone')}
      </span>
    );
  }
  if (status === 'generating') {
    return (
      <span
        className={`${common} border-processing/30 bg-paper text-lav-text`}
        style={style}
      >
        <span
          aria-hidden
          className="inline-block size-[5px] rounded-full bg-processing"
        />
        {t('cardStatusGenerating')}
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span
        className={`${common} border-error-line bg-paper text-error-text`}
        style={style}
      >
        {t('cardStatusError')}
      </span>
    );
  }
  return (
    <span
      className={`${common} border-line-strong bg-paper text-mute-soft`}
      style={style}
    >
      {t('cardStatusNone')}
    </span>
  );
}

function onEnterOrSpace(handler: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };
}

export function ProjectCard({
  name,
  status,
  onOpen,
  ariaLabel,
  menu,
  children,
}: {
  name: string;
  status: ProjectCardStatus;
  onOpen: () => void;
  ariaLabel?: string;
  // kebab 메뉴 (DropdownMenu) — 헤더 스트립 우측 끝. 자체 stopPropagation 소유.
  menu?: ReactNode;
  // 본문 — 컨테이너가 목록 훅 데이터(설명·메타·태그)로 채운다.
  children: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel ?? name}
      onClick={onOpen}
      onKeyDown={onEnterOrSpace(onOpen)}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-panel border-2 border-ink bg-paper shadow-memphis-md-faint transition-transform focus-visible:outline-none focus-visible:-translate-y-0.5 hover:-translate-y-0.5"
    >
      {/* 헤더 스트립 — 상태 틴트 + 아이콘 + 이름 + 뱃지 + kebab. */}
      <div
        className={`flex items-center gap-2.5 ${TINT[status]}`}
        style={{
          padding: '11px 15px',
          borderBottom: '1.5px solid var(--color-line)',
        }}
      >
        <DuotoneIcon name="project" size={16} fill="var(--color-rose)" />
        <span
          className="min-w-0 flex-1 truncate font-extrabold text-ink"
          style={{ fontSize: 13.5 }}
        >
          {name}
        </span>
        <StatusBadge status={status} />
        {menu}
      </div>
      {/* 본문 — 컨테이너 소유. */}
      <div className="flex flex-col gap-2.5" style={{ padding: '13px 15px' }}>
        {children}
      </div>
    </div>
  );
}
