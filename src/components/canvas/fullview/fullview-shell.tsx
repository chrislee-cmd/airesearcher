'use client';

/* ────────────────────────────────────────────────────────────────────
   FullviewShell — 풀뷰 V2 공유 셸 (design-handoff/FULLVIEW-SHELL.md §F1~F3).
   `<WidgetShell>`(collapsed 604×900 카드)의 peer — expanded "풀뷰" 서피스.
   한 번 짓고 6위젯(Probing/Interpreter/Transcript/AI UT/Recruiting/Desk)이
   공유한다 (§F7.3 anti-drift — 위젯별 재구현 금지).

   구성: 프레임(§F1) + 좌 240px 사이드바(§F2, FullviewSidebar) + 우 슬롯
   (flex-1) — 우 슬롯은 헤더 스캐폴드(§F3, FullviewHeader) + 본문.

   프레임(§F1): outer W/H = 컨테이너 소유(§F7.2 — 기존 wide 모달 슬롯
   90vw×90vh·max 1600×900 유지). 내부: border-3px ink · rounded-sm ·
   fv-frame-shadow · bg-surface-canvas · overflow hidden · flex row.

   메커니즘 재사용(fresh 빌드, 로직만): `<Modal bare>` 가 포털·backdrop·Esc·
   focus trap·scroll lock 을 제공하고, 프레임 비주얼은 이 셸이 소유한다
   (bare = Modal 패널의 자체 border/bg/shadow 를 걷어내 셸 프레임이 유일한
   비주얼 박스가 되게 함 — §F1 fv-frame-shadow/surface-canvas 를 그대로 표현).
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import { Modal } from '@/components/ui/modal';
import type { WidgetContent } from '../widget-types';
import { FullviewSidebar } from './fullview-sidebar';

export function FullviewShell({
  open,
  onClose,
  widgets,
  activeKey,
  onSwitch,
  lockedKeys,
  header,
  footnote,
  children,
}: {
  open: boolean;
  onClose: () => void;
  widgets: WidgetContent[];
  // 현재 풀뷰가 보여주는 위젯 key (사이드바 활성 표시).
  activeKey: string | null;
  // 사이드바에서 다른 위젯으로 전환.
  onSwitch: (key: string) => void;
  // 준비중(gated) 위젯 key 목록. 비었으면 전부 라이브.
  lockedKeys?: string[];
  // 헤더 스캐폴드 — 보통 <FullviewHeader …/>. 우 슬롯 최상단에 렌더.
  header?: ReactNode;
  // 사이드바 하단 안내 카드 (i18n 카피는 소비처 주입).
  footnote?: ReactNode;
  // 본문 슬롯 — 위젯 body 가 여기로 (canvas-board 는 portal 대상 div 주입).
  children: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} size="wide" bare>
      {/* §F1 프레임 — 유일한 비주얼 박스 (bare Modal 위) */}
      <div className="flex h-full w-full overflow-hidden rounded-sm border-[3px] border-ink bg-surface-canvas shadow-[var(--fv-frame-shadow)]">
        <FullviewSidebar
          widgets={widgets}
          activeKey={activeKey}
          onSwitch={onSwitch}
          lockedKeys={lockedKeys}
          footnote={footnote}
        />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {header}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
        </div>
      </div>
    </Modal>
  );
}
