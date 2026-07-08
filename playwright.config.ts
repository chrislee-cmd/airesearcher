import { defineConfig, devices } from '@playwright/test';
import { ARTIFACTS_DIR, STORAGE_STATE } from './e2e/lib/config';
import path from 'node:path';

// PR preview QA 하네스 (PROJECT.md §5.5 체크포인트를 실행형으로).
//
// 이 config 는 로컬 dev 서버를 띄우지 않습니다 — 항상 배포된 preview URL
// (QA_PREVIEW_URL) 을 대상으로 원격 스모크만 돕니다. webServer 필드가 없는
// 이유가 그것입니다. baseURL 이 비어 있으면(env 미주입) global-setup 이
// 명확한 에러를 던집니다.
//
// 관전 증거(사용자가 눈으로 QA 과정을 보는 것)가 목적이므로 video/trace/
// screenshot 을 항상 켭니다. 아티팩트는 모두 e2e/artifacts/ 아래로 모읍니다
// (gitignore 처리 — 생성물이라 커밋 안 함).
//
// storageState 는 global-setup 이 매 실행마다 반드시 써 두는 고정 경로.
// (익명 표면만이면 빈 세션을, 로그인 표면이 있으면 QA 계정 세션을 저장.)

const PREVIEW_URL = process.env.QA_PREVIEW_URL?.trim() || undefined;

export default defineConfig({
  testDir: path.join(ARTIFACTS_DIR, '..', 'tests'),
  // 변경 표면만 타겟하므로 스모크는 작다 — 워커 1개로 순차 실행해서
  // 트레이스/비디오가 서로 섞이지 않게, 관전 순서를 예측 가능하게.
  workers: 1,
  fullyParallel: false,
  // preview 는 이미 배포된 정적 대상이라 재시도로 얻을 게 없음. 실패는
  // 그대로 리포트에 남겨 사용자가 판단.
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(ARTIFACTS_DIR, 'html-report'), open: 'never' }],
    ['json', { outputFile: path.join(ARTIFACTS_DIR, 'playwright-results.json') }],
  ],
  outputDir: path.join(ARTIFACTS_DIR, 'test-output'),
  globalSetup: path.join(ARTIFACTS_DIR, '..', 'global-setup.ts'),
  globalTeardown: path.join(ARTIFACTS_DIR, '..', 'global-teardown.ts'),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: PREVIEW_URL,
    // 관전 증거 3종 — 항상 켬.
    video: 'on',
    trace: 'on',
    screenshot: 'on',
    storageState: STORAGE_STATE,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
