'use client';

/* ────────────────────────────────────────────────────────────────────
   CitationBackref — 근거 팝오버 → 원본 파일 역참조 배선 (card 672).

   근거 팝오버(ui/citation-popover.tsx)는 어느 화면(풀뷰 읽기·크로스 검색·파일
   모달·디자인 카탈로그)에서든 마운트되지만, "원본 파일 보기" 진입점은 **좌측
   파일 패널이 실제로 존재하는 컨텍스트**(InterviewReadDetail)에서만 의미가 있다.
   그래서 배선을 prop 으로 SearchChat→QAPair→popover 깊이 관통시키지 않고, 파일
   패널을 소유한 컴포넌트가 이 context 로 핸들러를 publish 한다.

   provider 가 없으면(크로스 검색·파일 모달·카탈로그) 팝오버는 진입점을 렌더하지
   않는다 — 역참조 타깃이 없으므로 조용히 생략(폴백, 회귀 0).
   ──────────────────────────────────────────────────────────────────── */

import { createContext, useContext, type ReactNode } from 'react';

// 역참조 대상 참조 — document_id(검색 Citation) 우선, 없으면 파일명(리졸브
// 청크처럼 id 가 없는 경우) 로 매칭한다.
export type CitationDocRef = {
  documentId?: string | null;
  filename?: string | null;
  // 강조할 청크(있으면 provider 가 문서 내 지점까지 좁힐 수 있다 — 현재 파일
  // 패널엔 문서 본문 뷰가 없어 파일 선택까지만).
  chunkId?: string | null;
};

export type CitationBackref = {
  // 이 참조로 열 수 있는 원본 파일이 아직 존재하는지 — 삭제됐으면 false 로
  // 진입점을 비활성화("원본 파일이 삭제됨").
  has: (ref: CitationDocRef) => boolean;
  // 좌측 파일 패널을 대상 문서로 점프·하이라이트한다. 팝오버는 호출측이 닫는다.
  open: (ref: CitationDocRef) => void;
};

const CitationBackrefCtx = createContext<CitationBackref | null>(null);

export function CitationBackrefProvider({
  value,
  children,
}: {
  value: CitationBackref;
  children: ReactNode;
}) {
  return (
    <CitationBackrefCtx.Provider value={value}>
      {children}
    </CitationBackrefCtx.Provider>
  );
}

// 팝오버가 소비 — provider 밖이면 null 이라 진입점을 렌더하지 않는다.
export function useCitationBackref(): CitationBackref | null {
  return useContext(CitationBackrefCtx);
}
