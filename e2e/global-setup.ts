import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { login } from './lib/auth';
import {
  ARTIFACTS_DIR,
  RESULTS_DIR,
  STEPS_DIR,
  STORAGE_STATE,
  ensureDir,
  loadScript,
  readEnv,
  redactEmail,
} from './lib/config';

// 실행 전 1회:
//   1. 이전 실행 아티팩트 청소(결과/스텝 스크린샷) — 리포트가 이번 실행만 반영.
//   2. env(preview URL) 검증 — 없으면 즉시 중단(상대경로 goto 가 무의미하므로).
//   3. QA 스크립트에 로그인 필요한 표면이 하나라도 있으면 로그인 → storageState 저장.
//      순수 익명 표면만이면 로그인 스킵(계정 없이도 스모크 가능).

async function globalSetup(): Promise<void> {
  const env = readEnv();

  // 이번 실행 아티팩트 초기화.
  fs.rmSync(RESULTS_DIR, { recursive: true, force: true });
  fs.rmSync(STEPS_DIR, { recursive: true, force: true });
  ensureDir(RESULTS_DIR);
  ensureDir(STEPS_DIR);
  ensureDir(path.dirname(STORAGE_STATE));
  // config.use.storageState 가 이 파일을 항상 참조하므로, 로그인 전에
  // 빈 세션을 먼저 써 둔다(익명 표면만이거나 0개인 경우에도 파일 존재 보장).
  fs.writeFileSync(STORAGE_STATE, JSON.stringify({ cookies: [], origins: [] }), 'utf8');

  if (!env.previewUrl) {
    throw new Error(
      'QA_PREVIEW_URL 미설정 — 하네스는 배포된 preview URL 을 대상으로만 동작합니다. ' +
        '(로컬 dev 서버 대상 아님)',
    );
  }

  const script = loadScript();
  // 이후 스텝에서 재사용하도록 도출 결과를 파일로 남긴다(테스트 프로세스와 공유).
  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, 'resolved-script.json'),
    JSON.stringify(script, null, 2),
    'utf8',
  );

  if (script.surfaces.length === 0) {
    // 변경 표면을 못 찾음 — 로그인/브라우저 띄울 필요 없음. teardown 이
    // "변경 표면 없음" 리포트를 쓴다.
    console.log('[qa-harness] 대상 표면 0개 — 스모크 생략, 리포트만 생성.');
    return;
  }

  const needsAuth = script.surfaces.some((s) => s.requiresAuth !== false);
  if (!needsAuth) {
    console.log('[qa-harness] 모든 대상 표면이 익명 — 로그인 생략.');
    return;
  }

  console.log(
    `[qa-harness] preview=${env.previewUrl} 로그인 시도(계정 ${redactEmail(env.email)})…`,
  );
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: env.previewUrl });
  const page = await context.newPage();
  try {
    await login(page, env);
    await context.storageState({ path: STORAGE_STATE });
    console.log('[qa-harness] 로그인 성공 — 세션 저장.');
  } finally {
    await browser.close();
  }
}

export default globalSetup;
