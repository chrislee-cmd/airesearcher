import type { Page } from '@playwright/test';
import { localizedPath, redactEmail, type HarnessEnv } from './config';

// QA 테스터 계정(#149) 로그인 헬퍼.
//
// secret 취급 규칙:
//   - 이메일은 로그에 redactEmail() 마스킹본만 남긴다.
//   - 비밀번호는 절대 로깅/스크린샷/직렬화하지 않는다. page.fill 로만 주입.
//   - 로그인 화면을 지나면 비밀번호 필드가 사라지므로 스텝 스크린샷에도
//     노출되지 않는다.
//
// 로그인 폼 셀렉터는 src/components/email-password-form.tsx 기준:
//   - 이메일: input[type="email"]
//   - 비밀번호: input#password
//   - 제출: button[type="submit"]
// 성공 시 next(기본 /canvas) 로 client-side redirect.

export async function login(page: Page, env: HarnessEnv): Promise<void> {
  if (!env.email || !env.password) {
    throw new Error(
      `QA 테스터 계정 미설정 — QA_TEST_EMAIL / QA_TEST_PASSWORD env 필요(#149). ` +
        `현재 email=${redactEmail(env.email)}, password=${env.password ? '설정됨' : '미설정'}.`,
    );
  }

  await page.goto(localizedPath('/login', env.locale), { waitUntil: 'domcontentloaded' });

  await page.locator('input[type="email"]').fill(env.email);
  await page.locator('input#password').fill(env.password);
  await page.locator('button[type="submit"]').click();

  // 로그인 성공 = /login 을 벗어남. 실패(잘못된 자격증명)면 폼에 머무르며
  // 에러 텍스트가 뜬다 — 그 경우 명확한 에러를 던져 리포트가 원인을 담게.
  try {
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 });
  } catch {
    const errText = (await page.locator('p.text-warning').first().textContent().catch(() => null))?.trim();
    throw new Error(
      `QA 계정 로그인 실패(계정 ${redactEmail(env.email)}). ` +
        `preview 에서 /login 을 벗어나지 못함${errText ? ` — 폼 에러: "${errText}"` : ''}.`,
    );
  }
}
