'use client';

/* ────────────────────────────────────────────────────────────────────
   RecruitingJourneyShell — recruiting 풀뷰의 2탭 저니 셸 (CD recruiting-
   journey 번들 N1 헤더/탭). 공유 <FullviewShell>(프레임+240px 사이드바)
   안에서 본문 slot 에 portal 되며, 이 컨테이너가:

   2탭 IA (사용자 결정 2026-07-26, #579):
     ① 응답  — 응답 확인 + **명단 유입 창구**(CSV·시트·응답연동 밴드가
                 탭① 본문에 이관됨). 소유: RecruitingFullviewBody +
                 JourneyIntakeBand.
     ② 일정  — 명단 조율(로스터/그룹) + 캘린더/채팅/슬롯. 578 로 명단 관리가
                 이 탭에 흡수됨. 소유: JourneyScheduleTab.
   옛 탭②(명단, JourneyCandidatesTab)는 제거됨 — 명단 조율은 ②일정, 유입은
   ①응답으로 각각 이관. CD 번들은 3탭(N1~N3) 기준이나 사용자 결정으로 2탭
   재구성이며 CD 프레임과의 어긋남은 의도된 이탈(WRITER-GAP-AUDIT §IA 개정).

   1. 탭 상태(응답/일정)를 소유하고 활성 탭 본문을 렌더한다.
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
import { JourneyScheduleTab } from './journey-schedule-tab';

// 2탭(#579): 응답 · 일정. 옛 'candidates' 는 제거. 잘못된(레거시) 탭 키로
// 진입하면 아래 render 가 어느 탭에도 매치되지 않아 자연히 ①응답으로 폴백한다.
export type JourneyTab = 'responses' | 'schedule';

// per-tab count(P0 counts API 소비). 값이 있는 탭만 count pill 노출, 로딩/
// 미머지 시 숨김. counts API 스키마는 candidates 를 additive 로 계속 반환하나
// (다른 소비처 회귀 방지) 2탭 클라는 미사용 — 응답/일정만 소비한다.
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
  onCreateProject,
  onArchiveProject,
  onUnarchiveProject,
  masterLink,
  counts,
  shareButton,
  onRefresh,
  responsesTab,
  formId,
  recruitingProjectId,
  activeTab,
  onTabChange,
  onShareToken,
}: {
  // 헤더 프로젝트 pill — projects.length>1 이면 인터랙티브 스위처, 아니면
  // display-only 폴백(FullviewProjectPill 내부 규칙).
  projectName: string | null;
  projects: { id: string; name: string }[];
  activeProjectId: string | null;
  // 선택 중 프로젝트를 보관하면 다른 활성 프로젝트로 이동(없으면 null → 미선택).
  onSelectProject: (projectId: string | null) => void;
  // pill 새 프로젝트 생성 — 생성된 {id} 또는 null(실패). interview_projects 축만.
  onCreateProject: (name: string) => Promise<{ id: string } | null>;
  // pill 보관(soft) / 보관취소(undo). interview_projects 축만 — sched 앵커 무관.
  onArchiveProject: (id: string) => Promise<void> | void;
  onUnarchiveProject: (id: string) => Promise<void> | void;
  // 헤더 마스터링크 chip(sky) — P0 lazy 프로비저닝이 풀뷰 오픈 시 토큰 확보.
  // 미머지 시 null → chip 숨김(graceful).
  masterLink: { url: string } | null;
  // per-tab count(P0). 미머지 시 undefined → count pill 숨김.
  counts?: JourneyCounts;
  // Share 버튼 — 라이브 collab-share 컴포넌트 재사용(R11). 접근통일 웨이브가
  // orgId+members 를 주입하면 활성. 미주입 시 숨김(graceful).
  shareButton?: ReactNode;
  // 헤더 액션 — 전 탭 refresh(각 탭 새로고침 대상 존재, GAP-AUDIT §3). CSV 는
  // 탭①(응답)의 요약/raw 토글 밴드로 이관됨(round-2 feedback #7) — 응답 전용
  // 액션이라 전 탭 공용 헤더엔 부적합.
  onRefresh: () => void;
  // 탭① 본문 — 기존 RecruitingFullviewBody(re-home). 상시 마운트(R3). 유입 3종
  // (명단 소스 밴드)도 이 본문 안(툴바 아래)에 함께 이관됨(#579).
  responsesTab: ReactNode;
  // 활성 폼 id — 탭①(유입 밴드)·탭②(일정)이 form-anchored 저니 데이터를 조회하는
  // 앵커: 유입 밴드 candidates/batches/source-sheet · 일정
  // /api/scheduling/journey/schedule(form→project lazy resolve). 폼 미선택 시
  // null → 해당 영역 안내 empty.
  formId: string | null;
  // 활성 리크루팅 pill 프로젝트 id(interview_projects). form-free intake(583)의
  // 앵커 — 폼 미발행이라도 이 pill 로 유입 밴드·일정 탭이 sched 프로젝트를 resolve.
  // 폼이 있으면 서버가 두 축을 한 sched 프로젝트로 수렴(stamp)한다.
  recruitingProjectId: string | null;
  // 활성 저니 탭 — host(recruiting-card)가 SSOT 로 쥔다(controlled). 2탭화(#579)로
  // 브리지 전송은 탭 전환 없이 선택만 리셋(인제스트분은 ②일정 재진입 시 노출).
  activeTab: JourneyTab;
  onTabChange: (tab: JourneyTab) => void;
  // 마스터링크 배선(#600) — 일정 탭이 로드한 project.share_token 을 host 로 올린다.
  // host 가 이걸로 masterLink 를 구성해 되돌려주면 chip 이 노출된다.
  onShareToken?: (token: string | null) => void;
}) {
  const t = useTranslations('Recruiting');
  const publishHeaderSlot = useFullviewHeaderSlotPublisher();

  // ── 헤더 slot publish (§F3) — pill · actions · row-2 탭. 셸 헤더밴드
  // (sun 톤)·타이틀·닫기✕ 는 셸이 소유, 위젯 종속 조각만 주입.
  useEffect(() => {
    const tabDefs: {
      key: JourneyTab;
      icon: string;
      label: string;
      // 부제/툴팁 — 라벨은 "응답" 유지(사용자 표현)하되, 탭①이 응답 확인 +
      // 명단 유입 창구를 겸함을 hover 툴팁 수준에서 보완(#579).
      hint?: string;
      count?: number;
    }[] = [
      {
        key: 'responses',
        icon: '📥',
        label: t('journey.tabResponses'),
        hint: t('journey.tabResponsesHint'),
        count: counts?.responses,
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
          onCreateProject={onCreateProject}
          onArchiveProject={onArchiveProject}
          onUnarchiveProject={onUnarchiveProject}
          menuLabel={t('journey.projectMenuLabel')}
        />
      ),
      actions: (
        <div className="flex items-center gap-2.5">
          {/* 마스터링크 chip 은 ②일정 탭에서만 노출(#600) — 공유 링크의 목적이
              참여자 `/schedule/<token>` 예약이라 일정(캘린더) 탭 귀속. ①응답 탭엔
              불필요. masterLink 는 host 가 일정 탭 로드 후 share_token 으로 구성. */}
          {activeTab === 'schedule' && masterLink ? (
            <MasterLinkChip
              url={masterLink.url}
              copyLabel={t('journey.masterLinkCopy')}
              copiedLabel={t('journey.masterLinkCopied')}
            />
          ) : null}
          {shareButton}
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
            onClick={() => onTabChange(tab.key)}
            title={tab.hint}
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
    onCreateProject,
    onArchiveProject,
    onUnarchiveProject,
    masterLink,
    counts,
    shareButton,
    onRefresh,
    activeTab,
    onTabChange,
  ]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-surface-canvas">
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
      {/* 탭②(일정) — 자체 내부 스크롤 소유, 폼/pill 앵커 데이터 조회. */}
      {activeTab === 'schedule' ? (
        // key on the anchor (form else pill) so an anchor switch remounts the tab
        // fresh (loading reset via mount, not an in-effect setState). form-free
        // (583): pill 만 있어도 일정 탭이 sched 프로젝트를 resolve.
        <JourneyScheduleTab
          key={formId ?? recruitingProjectId ?? 'none'}
          formId={formId}
          projectId={recruitingProjectId}
          onShareToken={onShareToken}
        />
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
    // url 은 상대(`/schedule/<token>`) — 참여자가 붙여넣어 쓸 수 있게 origin 을 얹어
    // 절대 URL 로 복사한다(window.location.origin + 상대 URL). 이미 절대면 그대로.
    const absolute =
      typeof window !== 'undefined'
        ? new URL(url, window.location.origin).href
        : url;
    void navigator.clipboard
      ?.writeText(absolute)
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
