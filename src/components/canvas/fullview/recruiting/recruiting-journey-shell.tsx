'use client';

/* ────────────────────────────────────────────────────────────────────
   RecruitingJourneyShell — recruiting 풀뷰의 3탭 저니 셸 (CD recruiting-
   journey 번들 N1 헤더/탭). 공유 <FullviewShell>(프레임+240px 사이드바)
   안에서 본문 slot 에 portal 되며, 이 컨테이너가:

   1. 탭 상태(응답/명단/일정)를 소유하고 활성 탭 본문을 렌더한다.
   2. §F3 헤더를 `FullviewHeaderSlot` 로 publish — 데드포털 fix(기존
      recruiting 본문은 renderInHeaderStart/End 로 주입했으나 셸이 그 포털
      타깃을 세팅하지 않아 pill/CSV/refresh 가 렌더되지 않았다 —
      CONTEXTRECRUITINGFULLVIEW A1). 이제 desk/interpreter 와 동일한
      publish-up 채널로 헤더밴드에 주입한다:
        - projectPill : 인터랙티브 프로젝트 pill(셸 onSelect 모드).
        - actions     : 마스터링크 chip · Share · CSV · refresh.
        - tabs        : row-2 3탭 폴더 내비(active=surface-canvas · count pill).

   재사용(로직/데이터만): 탭① 본문 = 기존 RecruitingFullviewBody(state 08)
   를 그대로 re-home(회귀 0, raw=레거시 ResponsesSpreadsheet 상시 마운트
   유지 R3 — 탭 전환 시에도 hidden 으로 마운트 유지해 데이터 파이프 불변).
   탭②·③ 는 신규 골격(웨이브2 워커가 채움).

   P0(백엔드) 미머지 graceful: 마스터링크 chip(`masterLink` null → 숨김) ·
   count pill(`counts` 없으면 숨김) · Share(`shareButton` 미주입 → 숨김).
   셸 구조·탭 전환·re-home 은 P0 없이도 동작(스펙 §제약).
   ──────────────────────────────────────────────────────────────────── */

import {
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { FullviewProjectPill } from '../fullview-header';
import { useFullviewHeaderSlotPublisher } from '@/components/canvas/shell/fullview-header-slot-context';
import { JourneyCandidatesTab } from './journey-candidates-tab';
import { JourneyScheduleTab } from './journey-schedule-tab';

export type JourneyTab = 'responses' | 'candidates' | 'schedule';

// per-tab count(P0 counts API 소비). 값이 있는 탭만 count pill 노출, 로딩/
// 미머지 시 숨김.
export type JourneyCounts = {
  responses?: number;
  candidates?: number;
  schedule?: number;
};

export function RecruitingJourneyShell({
  projectName,
  projects,
  activeProjectId,
  onSelectProject,
  masterLink,
  counts,
  shareButton,
  onRefresh,
  onDownloadCsv,
  hasResponses,
  responsesTab,
  formId,
}: {
  // 헤더 프로젝트 pill — projects.length>1 이면 인터랙티브 스위처, 아니면
  // display-only 폴백(FullviewProjectPill 내부 규칙).
  projectName: string | null;
  projects: { id: string; name: string }[];
  activeProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  // 헤더 마스터링크 chip(sky) — P0 lazy 프로비저닝이 풀뷰 오픈 시 토큰 확보.
  // 미머지 시 null → chip 숨김(graceful).
  masterLink: { url: string } | null;
  // per-tab count(P0). 미머지 시 undefined → count pill 숨김.
  counts?: JourneyCounts;
  // Share 버튼 — 라이브 collab-share 컴포넌트 재사용(R11). 접근통일 웨이브가
  // orgId+members 를 주입하면 활성. 미주입 시 숨김(graceful).
  shareButton?: ReactNode;
  // 헤더 액션 — 전 탭 refresh(각 탭 새로고침 대상 존재, GAP-AUDIT §3) + CSV
  // (comps 미작화지만 §5.4 계약, 기존 스타일). P1 에선 응답(탭①) 대상.
  onRefresh: () => void;
  onDownloadCsv: () => void;
  hasResponses: boolean;
  // 탭① 본문 — 기존 RecruitingFullviewBody(re-home). 상시 마운트(R3).
  responsesTab: ReactNode;
  // 활성 폼 id — 탭②(명단)·탭③(일정)이 form-anchored 저니 데이터를 조회하는
  // 앵커: 탭② candidates/batches/source-sheet · 탭③
  // /api/scheduling/journey/schedule(form→project lazy resolve). 폼 미선택 시
  // null → 해당 탭 안내 empty.
  formId: string | null;
}) {
  const t = useTranslations('Recruiting');
  const publishHeaderSlot = useFullviewHeaderSlotPublisher();
  const [activeTab, setActiveTab] = useState<JourneyTab>('responses');

  // ── 헤더 slot publish (§F3) — pill · actions · row-2 탭. 셸 헤더밴드
  // (sun 톤)·타이틀·닫기✕ 는 셸이 소유, 위젯 종속 조각만 주입.
  useEffect(() => {
    const tabDefs: {
      key: JourneyTab;
      icon: string;
      label: string;
      count?: number;
    }[] = [
      {
        key: 'responses',
        icon: '📥',
        label: t('journey.tabResponses'),
        count: counts?.responses,
      },
      {
        key: 'candidates',
        icon: '📋',
        label: t('journey.tabCandidates'),
        count: counts?.candidates,
      },
      {
        key: 'schedule',
        icon: '🗓️',
        label: t('journey.tabSchedule'),
        count: counts?.schedule,
      },
    ];

    publishHeaderSlot({
      projectPill: (
        <FullviewProjectPill
          name={projectName ?? t('journey.projectNone')}
          projects={projects}
          onSelect={onSelectProject}
          selectedId={activeProjectId}
          menuLabel={t('journey.projectMenuLabel')}
        />
      ),
      actions: (
        <div className="flex items-center gap-2.5">
          {masterLink ? (
            <MasterLinkChip
              url={masterLink.url}
              copyLabel={t('journey.masterLinkCopy')}
              copiedLabel={t('journey.masterLinkCopied')}
            />
          ) : null}
          {shareButton}
          {/* CSV(§5.4 계약, GAP-AUDIT §3 "기존 스타일") — pill chrome. */}
          {/* eslint-disable-next-line react/forbid-elements -- CD §F3 CSV 는 radius-pill·border-ink·memphis-sm 전용 chrome 으로 Button primitive 와 불일치(§7.11). 헤더 조각과 동일 선례. */}
          <button
            type="button"
            onClick={onDownloadCsv}
            disabled={!hasResponses}
            title={t('fv.csvTitle')}
            className="inline-flex items-center gap-1.5 rounded-pill border-[1.5px] border-ink bg-paper px-3 py-1.5 text-sm font-bold text-ink shadow-memphis-sm disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            ↓ CSV
          </button>
          {/* refresh(전 탭) — CD N1 32×32 스퀘어 아이콘(radius-close(9)·mute). */}
          {/* eslint-disable-next-line react/forbid-elements -- CD §F3 refresh 는 32px·radius-close(9)·memphis-sm 스퀘어 chrome 으로 IconButton 고정 radius variant 와 불일치(§7.11). 셸 닫기✕ 와 동일 선례. */}
          <button
            type="button"
            onClick={onRefresh}
            aria-label={t('fv.refresh')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--fv-radius-close)] border-[1.5px] border-ink bg-paper text-md text-mute-soft shadow-memphis-sm hover:text-ink"
          >
            ↻
          </button>
        </div>
      ),
      tabs: tabDefs.map((tab) => {
        const active = tab.key === activeTab;
        return (
          // eslint-disable-next-line react/forbid-elements -- CD row-2 폴더 탭은 border-2 ink(bottom-none)·rounded-t(11)·-2px overlap·active=surface-canvas fill 전용 chrome 으로 Button primitive 의 고정 radius/variant 와 불일치(§7.11). 셸 조각(nav/close✕)과 동일 선례.
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setActiveTab(tab.key)}
            className={`relative -mb-[2px] flex items-center gap-2 rounded-t-[var(--fv-radius-card)] border-2 border-b-0 border-ink px-[18px] py-[9px] ${
              active ? 'bg-surface-canvas' : 'bg-paper/35'
            }`}
          >
            <span aria-hidden className="text-sm leading-none">
              {tab.icon}
            </span>
            <span
              className={`text-sm ${
                active
                  ? 'font-extrabold text-ink'
                  : 'font-semibold text-mute-soft'
              }`}
            >
              {tab.label}
            </span>
            {typeof tab.count === 'number' ? (
              <span
                className={`rounded-pill px-2 py-px font-mono-label text-xs font-bold ${
                  active
                    ? 'bg-paper text-amore-deep'
                    : 'bg-paper/60 text-mute-soft'
                }`}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      }),
    });
    return () => publishHeaderSlot({});
  }, [
    publishHeaderSlot,
    t,
    projectName,
    projects,
    activeProjectId,
    onSelectProject,
    masterLink,
    counts,
    shareButton,
    onRefresh,
    onDownloadCsv,
    hasResponses,
    activeTab,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-canvas">
      {/* 탭① 응답 — 상시 마운트(R3: ResponsesSpreadsheet 데이터 파이프 SSOT
          가 이 본문 안에 있으므로 탭 전환 시에도 hidden 으로 유지). min-w-0 = 폭 봉쇄
          체인의 최상단 링크(568) — 본문이 판단테이블/스프레드시트의 intrinsic
          폭으로 팽창해 셸 슬롯(overflow-hidden)을 뚫고 브리지 CTA 를 클립
          밖으로 밀어내던 회귀 차단. 가로 스크롤은 테이블 wrapper 한 겹에만. */}
      <div
        className={
          activeTab === 'responses' ? 'flex min-h-0 min-w-0 flex-1' : 'hidden'
        }
      >
        {responsesTab}
      </div>
      {/* 탭②·③ — 각 탭은 자체 내부 스크롤 소유. 탭②(명단)·탭③(일정) 모두
          form-anchored 데이터를 조회한다. */}
      {activeTab === 'candidates' ? (
        <JourneyCandidatesTab formId={formId} />
      ) : null}
      {activeTab === 'schedule' ? (
        // key on the form so a form switch remounts the tab fresh (loading
        // reset happens via mount, not an in-effect setState).
        <JourneyScheduleTab key={formId ?? 'none'} formId={formId} />
      ) : null}
    </div>
  );
}

// ── 마스터링크 chip(CD N1: sky bg · 🔗 · mono url · Copy) ──────────────────
// P0 lazy 프로비저닝된 /schedule/<token> 링크. Copy = 클립보드 복사(best-
// effort, UX 피처). masterLink null 이면 상위에서 미렌더(graceful).
function MasterLinkChip({
  url,
  copyLabel,
  copiedLabel,
}: {
  url: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    void navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  };
  return (
    <span className="inline-flex items-center gap-[7px] rounded-pill border-[1.5px] border-ink bg-sky px-3 py-[5px] shadow-memphis-sm">
      <span aria-hidden className="text-xs">
        🔗
      </span>
      <span className="max-w-[180px] truncate font-mono-label text-xs font-bold text-ink">
        {url}
      </span>
      {/* eslint-disable-next-line react/forbid-elements -- CD N1 마스터링크 Copy 는 chip 내부 인라인 텍스트 액션(amore-deep) 으로 Button primitive 형태와 불일치(§7.11). 셸 조각과 동일 선례. */}
      <button
        type="button"
        onClick={onCopy}
        className="shrink-0 text-xs font-bold text-amore-deep"
      >
        {copied ? copiedLabel : copyLabel}
      </button>
    </span>
  );
}
