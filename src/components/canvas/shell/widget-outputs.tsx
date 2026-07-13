/* ────────────────────────────────────────────────────────────────────
   WidgetOutputs — 위젯 본문 하단의 "최근 산출물" 영역 공통 컴포넌트.

   SSOT: 전사록 (quotes-card-body) 의 "최근 산출물" 패턴. 다른 산출물
   생성 위젯 (데스크 리서치 등) 도 동일 시각/동작을 갖도록 본 컴포넌트를
   사용. 데이터 fetching/액션 동작은 호출부 책임 — 본 컴포넌트는 외곽
   컨테이너 (border-t + SectionLabel + 총 N건 + "더보기") 와 단일 row
   시각만 책임진다.
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

// 카드 셸의 라벨 패턴 — uppercase tracking-wider mute-soft. quotes 안에
// local 로 있던 SectionLabel 을 여기로 이전 — primitive Label 과 시각 동일
// 하지만 산출물 영역 의도를 명확히 하기 위해 별도 이름으로 export.
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className="text-xs uppercase tracking-[0.22em] text-mute-soft"
      data-ds-primitive="SectionLabel"
    >
      {children}
    </div>
  );
}

export type WidgetOutputsProps<T> = {
  label: string;
  // 호출부는 전체 산출물 배열을 그대로 전달. 카드 안에는 최근 2건만,
  // 초과분은 onMoreClick 으로 (모달 등) — slicing 은 primitive 책임.
  items: T[];
  // 단일 row 렌더링. WidgetOutputRow 를 반환하면 시각 통일 — key 는
  // renderItem 안에서 부여 (호출부가 안정 id 를 안다).
  renderItem: (item: T) => ReactNode;
  // 2건 초과 시 "더보기 (N건 더)" 버튼 노출. 미지정 시 더보기 안 그림.
  onMoreClick?: () => void;
  // items.length === 0 일 때 노출할 안내. 미지정 시 기본 메시지.
  emptyText?: string;
};

// 카드에 노출할 최근 산출물 개수 — primitive 가 강제. 매직넘버 OK (PR-F SSOT).
const VISIBLE_COUNT = 2;

export function WidgetOutputs<T>({
  label,
  items,
  renderItem,
  onMoreClick,
  emptyText = '아직 생성된 산출물이 없습니다',
}: WidgetOutputsProps<T>) {
  const isEmpty = items.length === 0;
  const shown = items.slice(0, VISIBLE_COUNT);
  const remaining = items.length - shown.length;

  return (
    <div className="shrink-0 border-t border-line-soft px-5 py-5">
      <div className="mb-2 flex items-center justify-between">
        <SectionLabel>{label}</SectionLabel>
        <span className="text-xs text-mute-soft">총 {items.length}건</span>
      </div>
      {isEmpty ? (
        <div className="rounded-xs border-[2px] border-dashed border-ink bg-paper px-4 py-6 text-center text-md text-mute-soft">
          {emptyText}
        </div>
      ) : (
        <ul className="space-y-3">{shown.map((item) => renderItem(item))}</ul>
      )}
      {remaining > 0 && onMoreClick && (
        <div className="mt-3 flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={onMoreClick}
            className="uppercase tracking-[0.18em]"
          >
            더보기 ({remaining}건 더)
          </Button>
        </div>
      )}
    </div>
  );
}

export type WidgetOutputRowProps = {
  title: ReactNode;
  // 좌측 최선두 슬롯 — 선택 체크박스 등. 미지정 시 렌더 안 함 (기존 row 무영향).
  leading?: ReactNode;
  // 상태 pill / 사이즈 / duration 등 보조 정보. 자식들은 자동으로
  // gap-3 으로 배치됨.
  meta?: ReactNode;
  // 좌측 컬럼 (title/meta) 아래로 들어가는 추가 콘텐츠 — 진행률 바
  // 같은 좌측 width 기준 블록. 행 전체 width 가 아님.
  extra?: ReactNode;
  // Download / Share / Preview / Delete 등 액션. 호출부에서 자유 구성.
  actions?: ReactNode;
  // 행 아래로 펼쳐지는 추가 콘텐츠 (예: preview body). 자식 안의 첫
  // 요소가 border-t 를 책임지면 시각 분리 자연스러움.
  children?: ReactNode;
};

// 산출물 row — `<li>` 자체. WidgetOutputs 의 `<ul>` 직속 자식으로
// 사용. 전사록 JobRow 가 SSOT.
export function WidgetOutputRow({
  title,
  leading,
  meta,
  extra,
  actions,
  children,
}: WidgetOutputRowProps) {
  return (
    <li className="border-[2px] border-ink bg-paper shadow-[3px_3px_0_black] rounded-sm transition-all duration-[120ms] hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0_black]">
      <div className="flex items-start gap-4 px-5 py-3">
        {leading && <div className="mt-1 shrink-0">{leading}</div>}
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg text-ink-2">{title}</div>
          {meta && (
            <div className="mt-0.5 flex flex-wrap items-center gap-3 text-sm text-mute-soft tabular-nums">
              {meta}
            </div>
          )}
          {extra}
        </div>
        {actions}
      </div>
      {children}
    </li>
  );
}
