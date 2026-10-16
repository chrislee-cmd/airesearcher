import { cache } from 'react';
import { createClient } from './server';

// React cache() dedupes within a single RSC request lifecycle, so a
// layout + page combo that both need the user only pays one
// supabase.auth.getUser() round-trip. The proxy (src/proxy.ts) still
// runs its own getUser() to refresh cookies — that's a separate request
// and not deduplicable from here.
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});

// 유저 뷰 선호 (캔버스 ⇄ 리스트) — profiles.view_mode SSOT. 라이트/다크처럼
// 헤더 토글로 스왑되고 여기서 초기값을 서버에서 읽어 ViewModeProvider 로 hydrate
// 한다 (기기 간 동기). 미인증 / row 없음 / 미지원 값은 전부 'canvas' 로 폴백해
// 기존 유저 경험을 보존한다 (마이그 default 와 정합).
export type ViewMode = 'canvas' | 'list';

export const getViewMode = cache(async (): Promise<ViewMode> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 'canvas';
  const { data } = await supabase
    .from('profiles')
    .select('view_mode')
    .eq('id', user.id)
    .single();
  return data?.view_mode === 'list' ? 'list' : 'canvas';
});

/* ────────────────────────────────────────────────────────────────────
   캔버스 전환 온보딩 (P4) — `profiles.canvas_palette_onboarding` SSOT.

   그리드 캔버스가 퇴역하고 위젯이 팔레트로 옮겨 가는 전환을 **대상자에게 1회**
   알린다(canvas-modular/full §8). 값 3종: 'skip'(대상 아님 = 신규 사용자) ·
   'pending'(아직 안 봤음) · 'done'(봤음). 대상자 판정은 마이그가 기존 row 를
   'pending' 으로 채워 못박았으므로 여기서 추론하지 않는다.

   미인증 / row 없음 / 미지원 값은 전부 **미노출**로 폴백한다 — 안내가 괜히
   튀어나오는 쪽이 안 뜨는 쪽보다 나쁘다.
   ──────────────────────────────────────────────────────────────────── */
export const getCanvasOnboardingPending = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from('profiles')
    .select('canvas_palette_onboarding')
    .eq('id', user.id)
    .single();
  return data?.canvas_palette_onboarding === 'pending';
});

