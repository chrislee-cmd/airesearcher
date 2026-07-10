import { posthog } from './posthog-client';

// 표준 event 정의 (type-safe, 오타 방지).
// 이벤트 이름 규칙: snake_case 명사_동사 + domain prefix
//   widget_*  = 위젯 UI 이벤트
//   job_*     = 백그라운드 job 이벤트
//   session_* = 사용자 세션 (login/logout/etc)
//   admin_*   = 관리자 액션
type WidgetKey =
  | 'desk'
  | 'probing'
  | 'quotes'
  | 'interviews'
  | 'recruiting'
  | 'translate'
  | 'insights';

type EventMap = {
  widget_viewed: { widget: WidgetKey; fullview?: boolean };
  widget_clicked: { widget: WidgetKey; target: string };
  widget_action: { widget: WidgetKey; action: string; metadata?: Record<string, unknown> };
  job_started: { widget: WidgetKey; job_type: string; cost_credits?: number };
  job_completed: { widget: WidgetKey; job_type: string; duration_ms: number };
  job_failed: { widget: WidgetKey; job_type: string; error: string };
  session_login: { method: string };
  session_logout: Record<string, never>;
  admin_page_viewed: { path: string };
};

// 표준 이벤트 발사 helper. EventMap 에 없는 이름이나 잘못된 props 는 컴파일 실패.
export function track<K extends keyof EventMap>(event: K, props: EventMap[K]) {
  if (typeof window === 'undefined') return;
  try {
    posthog.capture(event, props as Record<string, unknown>);
  } catch (e) {
    // Silent — analytics 실패가 앱 crash 원인 안 되게
    console.warn('[analytics] track failed', event, e);
  }
}
