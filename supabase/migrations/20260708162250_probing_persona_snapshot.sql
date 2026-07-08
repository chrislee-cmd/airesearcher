-- probing_sessions.persona_snapshot — 공유 시점 페르소나 스냅샷
-- (PR: probing-persona-share-snapshot-persist).
--
-- 배경: probing_sessions 는 research_context(goal/hypotheses/KRQ)만 저장한다.
-- 사용자가 공유 뷰어(#476)에서 보고 싶어하는 **페르소나 reflection 8+custom
-- 패널 + 생성된 프로빙 질문**은 probing-card.tsx 의 in-memory state 라 DB
-- 어디에도 persist 되지 않는다. 공유 뷰어가 그걸 read-only 로 렌더하려면 먼저
-- 스냅샷을 저장해야 한다.
--
-- 설계: 세션 1:1 이라 신규 테이블 대신 probing_sessions 에 jsonb 컬럼을
-- 비파괴로 추가한다(옵션1). 공유 생성/갱신 시점에 클라이언트가 현재 상태를
-- persona_snapshot 에 저장하고 snapshot_at 을 찍는다. shape 계약 SSOT 은
-- src/lib/probing-persona-snapshot.ts.
--
-- RLS: 기존 probing_sessions_own_* 정책(소유자 select/insert/update/delete)이
-- 컬럼 무관하게 그대로 커버 — 소유자만 자기 스냅샷을 write 한다. 공유 뷰어의
-- read 경로는 서버(service_role)가 토큰 게이트 통과 후 로드(#476)이므로 이
-- PR 은 추가 정책이 불필요.

alter table public.probing_sessions
  add column if not exists persona_snapshot jsonb,
  add column if not exists snapshot_at timestamptz;
