'use client';

import { useEffect } from 'react';
import mixpanel from 'mixpanel-browser';
import { createClient } from '@/lib/supabase/client';

let initialized = false;

// 피처 키 → 한글 라벨. 사이드바·생성 이벤트에서 동적으로 조립할 때 사용.
const FEATURE_KO: Record<string, string> = {
  quotes: '전사록',
  transcripts: '스크립트',
  interviews: '인터뷰',
  reports: '리포트',
  scheduler: '스케줄러',
  moderator: '모더레이터',
  analyzer: '분석기',
  desk: '데스크리서치',
  keywords: '키워드',
  recruiting: '리쿠르팅',
  survey: '설문',
  quant: '정량분석',
  affinity_bubble: '친화도 버블',
};

// 정적 이벤트 키 → 한글 이벤트명.
const EVENT_KO: Record<string, string> = {
  // Auth
  auth_signin_click: '로그인 - 이메일 시도 클릭',
  auth_signup_click: '회원가입 - 이메일 시도 클릭',
  auth_signin_success: '로그인 성공',
  auth_signup_success: '회원가입 성공',
  auth_google_signin_click: '로그인 - 구글 클릭',
  auth_signout_click: '로그아웃 클릭',
  sidebar_signin_link_click: '사이드바 - 로그인 링크 클릭',
  // Sidebar / 설정
  sidebar_group_toggle_click: '사이드바 - 그룹 토글 클릭',
  sidebar_projects_click: '사이드바 - 프로젝트 클릭',
  settings_menu_open_click: '설정 - 메뉴 열기 클릭',
  settings_locale_change_click: '설정 - 언어 변경 클릭',
  settings_members_click: '설정 - 멤버 클릭',
  settings_buy_credits_click: '설정 - 크레딧 구매 클릭',
  // 크레딧
  credits_contact_sales_click: '크레딧 - 영업문의 클릭',
  credits_bundle_purchase_click: '크레딧 - 번들 구매 클릭',
  // 리쿠르팅
  recruiting_survey_generate_click: '리쿠르팅 - 설문 생성 클릭',
  recruiting_survey_generate_success: '리쿠르팅 - 설문 생성 성공',
  recruiting_publish_success: '리쿠르팅 - 발행 성공',
  recruiting_extract_click: '리쿠르팅 - 추출 클릭',
  recruiting_extract_success: '리쿠르팅 - 추출 성공',
  generate_success: '리쿠르팅 - 시작 성공',
  // 전사/인터뷰/데스크/리포트
  transcripts_upload_start: '스크립트 - 업로드 시작',
  interviews_convert_start: '인터뷰 - 변환 시작',
  interviews_analyze_auto_start: '인터뷰 - 자동 분석 시작',
  interviews_analyze_click: '인터뷰 - 분석 클릭',
  desk_generate_click: '데스크리서치 - 생성 클릭',
  desk_generate_success: '데스크리서치 - 생성 성공',
  desk_export_md_click: '데스크리서치 - MD 내보내기 클릭',
  desk_export_docx_click: '데스크리서치 - DOCX 내보내기 클릭',
  reports_generate_click: '리포트 - 생성 클릭',
  reports_generate_success: '리포트 - 생성 성공',
};

function localizeEvent(event: string): string {
  // 정적 매핑 우선
  const direct = EVENT_KO[event];
  if (direct) return direct;
  // 동적 패턴: sidebar_nav_<key>_click
  const navMatch = event.match(/^sidebar_nav_(.+)_click$/);
  if (navMatch) {
    const ko = FEATURE_KO[navMatch[1]] ?? navMatch[1];
    return `사이드바 - ${ko} 이동 클릭`;
  }
  // 동적 패턴: <feature>_generate_click / _success
  const genMatch = event.match(/^(.+)_generate_(click|success)$/);
  if (genMatch) {
    const ko = FEATURE_KO[genMatch[1]] ?? genMatch[1];
    const suffix = genMatch[2] === 'click' ? '생성 클릭' : '생성 성공';
    return `${ko} - ${suffix}`;
  }
  // 매핑 없으면 원본 그대로
  return event;
}

export function track(event: string, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  if (!initialized) return;
  mixpanel.track(localizeEvent(event), { ...(props ?? {}), event_key: event });
}

// 이메일을 distinct_id 로 쓴다. uuid 보다 사람이 식별하기 쉬워 Mixpanel
// 대시보드/리포트에서 바로 누구인지 알 수 있다. uuid 는 user_id 프로퍼티로
// 같이 보존해 조인이 필요할 때 활용한다.
function identifyUser(u: { id: string; email?: string | null }) {
  if (typeof window === 'undefined' || !initialized) return;
  const email = u.email ?? undefined;
  const distinctId = email && email.length > 0 ? email : u.id;
  mixpanel.identify(distinctId);
  mixpanel.people.set({
    $email: email,
    user_id: u.id,
    ...(email ? { $name: email } : {}),
  });
}

export function MixpanelProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;
    if (!token) return;
    if (!initialized) {
      mixpanel.init(token, {
        track_pageview: 'full-url',
        persistence: 'localStorage',
        // autocapture 는 끈다. 자동 수집된 $autocapture/$click 이벤트가
        // 명시 track 이벤트와 섞여 식별이 어려워진다는 피드백이 있어
        // 명시 track() 만 신뢰 소스로 사용한다.
        autocapture: false,
      });
      initialized = true;
    }

    const supabase = createClient();
    let active = true;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!active || !user?.id) return;
      identifyUser({ id: user.id, email: user.email });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user;
      if (event === 'SIGNED_OUT') {
        if (typeof window !== 'undefined' && initialized) mixpanel.reset();
        return;
      }
      if (u?.id) identifyUser({ id: u.id, email: u.email });
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return <>{children}</>;
}
