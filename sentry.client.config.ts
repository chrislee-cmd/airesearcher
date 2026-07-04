// sentry.client.config.ts — Sentry init for the browser (PR-SEC12).
//
// Loaded by `instrumentation-client.ts`. `NEXT_PUBLIC_SENTRY_DSN` is
// the browser-exposed DSN — distinct from server `SENTRY_DSN` so we can
// disable client capture without touching server reporting.

import * as Sentry from '@sentry/nextjs';
import { sanitizeSentryEvent, SENTRY_TRACES_SAMPLE_RATE } from '@/lib/sentry-pii';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
  sendDefaultPii: false,
  beforeSend: sanitizeSentryEvent,
  integrations: [
    // 사용자 명시 버그 신고 위젯 — 우측 하단 "피드백" 버튼 → dialog.
    // spec 의 buttonLabel 은 @sentry/nextjs v10 에 없어 트리거 버튼 라벨
    // 정식 필드 triggerLabel 로 보수적 매핑함.
    Sentry.feedbackIntegration({
      colorScheme: 'system',
      showBranding: false, // Sentry 로고 숨김
      autoInject: true, // 우측 하단 "피드백" 버튼 자동 노출
      // z-index — Sentry 기본값은 100000 이라 루트에 주입된 이 버튼이 모든
      // 모달 위에 뜬다. 특히 프로빙 fullview 우하단 질문 popup 과 위치가
      // 겹쳐, 모달 stacking context(z-modal:50) 안에 갇힌 popup 의 액션
      // 버튼이 이 버튼에 덮여 클릭이 안 됐다 (2026-07-04 사용자 보고).
      // 앱 z 스케일(globals.css: fab 40 / modal 50 / toast 60 / overlay 70)
      // 에 맞춰 modal 바로 아래(45)로 내린다 — 피드백은 페이지 chrome 위엔
      // 뜨되 모달/토스트/오버레이 표면 아래에 위치하는 게 올바른 순서.
      zIndex: 45,
      enableScreenshot: true, // 스크린샷 첨부 허용
      triggerLabel: '피드백',
      submitButtonLabel: '전송',
      formTitle: '무슨 일이 있었나요?',
      messagePlaceholder: '문제 상황을 자세히 설명해 주세요',
      nameLabel: '이름',
      emailLabel: '이메일',
      messageLabel: '설명',
      successMessageText: '피드백이 전송되었습니다. 감사합니다!',
      isNameRequired: false,
      isEmailRequired: false,
    }),
  ],
});
