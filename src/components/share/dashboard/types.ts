// 공유 관리 대시보드 — 프레젠테이션 계약 (camelCase `ShareLinkItem`).
//
// CD BUILD-SPEC 전제: dumb 컴포넌트는 `ShareLinkItem[]` + `canViewOrgScope` +
// onCopy/onRevoke/onOpenInviteManage 만 받는다. wire 포맷(snake_case, /api/share/
// mine)은 컨테이너 어댑터(share-dashboard-container.tsx)가 이 camelCase 로
// 매핑한다 — 프레젠테이션은 camelCase 만 안다.
//
// 역할 문자열(§5-9)을 컴포넌트가 들지 않는다: 스코프 분기는 `canViewOrgScope`
// boolean 하나, 정체성은 `tone`(6종 파스텔 토큰) 하나. resourceType 은 초대
// 모달 배선(resourceType/resourceId)에만 쓰고 레이아웃 분기에는 안 쓴다.

export type ShareStatus = 'active' | 'expired' | 'revoked';

// tokens.json pastel 6종과 1:1 (BUILD-SPEC §0.2). 새 색 없음.
export type ShareTone = 'rose' | 'sky' | 'lav' | 'peach' | 'aqua' | 'sun';

// 스코프 축(§0.5) — canViewOrgScope=true 일 때만 두 값 사이를 오간다.
export type ShareScope = 'mine' | 'org';

export type ShareIssuer = {
  // resolve 실패(탈퇴 등)면 null → "(탈퇴한 멤버)" 로 렌더 (DECISIONS §6-7).
  name: string | null;
  isMine: boolean;
};

export type ShareLinkItem = {
  id: string;
  token: string;
  url: string;
  // 초대 모달 배선용 — 레이아웃 분기엔 쓰지 않는다.
  resourceType: string;
  resourceId: string;
  resourceTitle: string | null;
  // 서버가 로컬라이즈해 제공(§5-1). 클라 타입→라벨 맵 금지.
  resourceLabel: string;
  tone: ShareTone;
  status: ShareStatus;
  invitedEmails: string[];
  // null = 미집계("—"), 0 = "0회". 둘은 다르게 렌더한다(§0.3).
  viewCount: number | null;
  lastViewedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  issuer: ShareIssuer;
};

// 상태 세그먼트 카운트 — 클라 계산(§5-5, v1 페이지네이션 없음).
export type ShareStatusCounts = {
  alive: number; // active
  expired: number;
  revoked: number;
  all: number;
};
