import type { Page } from '@playwright/test';
import { localizedPath, redactEmail, type HarnessEnv } from './config';

// 쿠키 동의 배너(src/components/cookie-consent-banner.tsx)를 조건부로 닫는다.
//
// 왜 필요한가: 배너는 `fixed inset-x-0 bottom-0 z-toast` 로 화면 하단에 깔려
// 로그인 폼의 submit 버튼 위를 덮는다. 신선한 브라우저 컨텍스트(localStorage
// 비어 있음)에서는 항상 뜨므로, dismiss 없이는 submit 클릭이 배너에 pointer
// 가로채짐 → globalSetup throw → 전 테스트 스킵(#847 실측).
//
// 동작:
//   - 배너(role="dialog" + #cookie-consent-title)가 뜨면 primary 액션 버튼을
//     "실제로" 눌러 닫는다(= decide() 가 localStorage 저장 + setVisible(false)
//     → DOM detach). force click 은 오버레이 잔존 위험이 있어 쓰지 않는다.
//   - primary 버튼은 justify-end 액션 row 의 마지막 자식(Accept all / Save
//     preferences)이라 locale(ko/en) 과 무관하게 .last() 로 안정 선택.
//   - 배너가 없으면(이미 동의한 세션) 짧은 timeout 후 조용히 skip.
//
// 반환값: 실제로 닫았으면 true, 배너가 없어 skip 했으면 false.
export async function dismissCookieConsent(page: Page): Promise<boolean> {
  const dialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.locator('#cookie-consent-title') });

  // 배너는 hydration 후 useEffect 에서 mount 되므로 즉시 있지 않을 수 있다.
  // 짧게 기다리되, 없으면(이미 동의) 예외 없이 skip.
  try {
    await dialog.waitFor({ state: 'visible', timeout: 3_000 });
  } catch {
    return false;
  }

  await dialog.getByRole('button').last().click();
  // 오버레이가 실제로 사라졌는지 확인 후 반환(다음 submit 클릭이 안전하도록).
  await dialog.waitFor({ state: 'detached', timeout: 3_000 }).catch(() => {});
  return true;
}

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

  // 폼 제출 전 쿠키 동의 배너를 닫는다 — 안 닫으면 하단 배너가 submit 버튼
  // 위를 덮어 클릭 pointer 를 가로챈다(#847). 배너 없으면 조용히 skip.
  await dismissCookieConsent(page);

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
