import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  ARTIFACTS_DIR,
  RESULTS_DIR,
  STEPS_DIR,
  ensureDir,
  localizedPath,
  readEnv,
  slug,
  stripAnsi,
  type LoadedScript,
  type QAStep,
} from '../lib/config';
import type { StepResult, StepStatus, SurfaceResult } from '../lib/report';

// 변경 표면 타겟 스모크 — global-setup 이 도출/검증한 표면만 순회한다.
// 전체 앱을 훑지 않는다(§B). 스텝별 스크린샷 + surface별 결과 JSON 을 남기고,
// 비디오/트레이스는 Playwright 가 자동 저장 → global-teardown 이 합쳐 리포트로.

const env = readEnv();

function loadResolvedScript(): LoadedScript {
  const p = path.join(ARTIFACTS_DIR, 'resolved-script.json');
  if (!fs.existsSync(p)) return { surfaces: [], origin: '(resolved-script.json 없음)', unmapped: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8')) as LoadedScript;
}

const script = loadResolvedScript();

async function runStep(page: Page, step: QAStep, dir: string, index: number): Promise<StepResult> {
  const shotRel = path.join(path.relative(ARTIFACTS_DIR, dir), `${String(index).padStart(2, '0')}-${slug(step.label)}.png`);
  const shotAbs = path.join(ARTIFACTS_DIR, shotRel);

  // preview 검증 불가(실 데이터/키 필요) — 실행하지 않고 정직하게 미검증 표기.
  if (step.dataDependent) {
    return {
      label: step.label,
      action: step.action,
      status: 'skipped',
      detail: `미검증(${step.reason ?? '사유 미기재'})`,
    };
  }

  try {
    switch (step.action) {
      case 'goto':
        await page.goto(localizedPath(step.path ?? '/', env.locale), { waitUntil: 'domcontentloaded' });
        break;
      case 'click':
        if (!step.selector) throw new Error('click 스텝에 selector 없음');
        await page.locator(step.selector).first().click();
        break;
      case 'fill':
        if (!step.selector) throw new Error('fill 스텝에 selector 없음');
        await page.locator(step.selector).first().fill(step.value ?? '');
        break;
      case 'expect':
        if (!step.selector) throw new Error('expect 스텝에 selector 없음');
        await expect(page.locator(step.selector).first()).toBeVisible();
        break;
      case 'note':
        // 순수 메모 — 액션 없음, 컨텍스트 스크린샷만.
        break;
      default:
        throw new Error(`알 수 없는 action: ${String(step.action)}`);
    }
    await page.screenshot({ path: shotAbs, fullPage: true }).catch(() => {});
    return {
      label: step.label,
      action: step.action,
      status: step.action === 'note' ? 'skipped' : 'pass',
      detail: step.action === 'note' ? '메모' : undefined,
      screenshot: fs.existsSync(shotAbs) ? shotRel : undefined,
    };
  } catch (err) {
    await page.screenshot({ path: shotAbs, fullPage: true }).catch(() => {});
    return {
      label: step.label,
      action: step.action,
      status: 'fail',
      detail: stripAnsi(err instanceof Error ? err.message.split('\n')[0] : String(err)),
      screenshot: fs.existsSync(shotAbs) ? shotRel : undefined,
    };
  }
}

for (const surface of script.surfaces) {
  test(surface.name, async ({ page }, testInfo) => {
    const requiresAuth = surface.requiresAuth !== false;
    const url = new URL(localizedPath(surface.route, env.locale), env.previewUrl || 'http://invalid').toString();
    const stepDir = path.join(STEPS_DIR, slug(surface.name));
    ensureDir(stepDir);

    const steps: StepResult[] = [];
    let surfaceError: string | undefined;

    try {
      // 표면 진입(리포트 스텝과 별개의 setup). 명시 goto 스텝은 이후 재이동 가능.
      await page.goto(localizedPath(surface.route, env.locale), { waitUntil: 'domcontentloaded' });
    } catch (err) {
      surfaceError = stripAnsi(err instanceof Error ? err.message.split('\n')[0] : String(err));
    }

    for (let i = 0; i < surface.steps.length; i++) {
      steps.push(await runStep(page, surface.steps[i], stepDir, i + 1));
    }

    const status: StepStatus = steps.some((s) => s.status === 'fail')
      ? 'fail'
      : steps.some((s) => s.status === 'pass')
        ? 'pass'
        : 'skipped';

    const result: SurfaceResult = {
      name: surface.name,
      route: surface.route,
      url,
      requiresAuth,
      status,
      steps,
      error: surfaceError,
    };
    ensureDir(RESULTS_DIR);
    fs.writeFileSync(path.join(RESULTS_DIR, `${slug(surface.name)}.json`), JSON.stringify(result, null, 2), 'utf8');

    // 관전 하네스이므로 여기서 테스트를 fail 시켜 CI 를 막지 않는다(§D).
    // pass/fail 은 리포트로만 표현. 단 로컬에서 사람이 볼 수 있게 annotation.
    testInfo.annotations.push({ type: 'qa-status', description: status });
  });
}

// 표면이 0개면 Playwright 가 "no tests" 로 종료 — teardown 이 빈 리포트를 쓴다.
if (script.surfaces.length === 0) {
  test('변경 표면 없음 — 스모크 생략', async () => {
    test.skip(true, 'PR diff 에서 라우트로 매핑되는 변경 표면 없음. QA_SCRIPT_PATH 로 스크립트 제공 가능.');
  });
}
