import fs from 'node:fs';
import path from 'node:path';
import { ARTIFACTS_DIR, type HarnessEnv, type LoadedScript } from './config';

// QA 리포트 빌더. 사용자가 (1) 관전하고 (2) 직접 preview 로 들어가 자가검토
// 할 수 있도록 preview URL + 정확한 네비게이션 경로 + 스텝별 pass/fail +
// 아티팩트 경로(비디오/트레이스/스텝 스크린샷)를 한 문서에 모은다.
//
// ⚠️ 이 모듈은 리포트 파일만 쓴다 — PR/머지 상태를 절대 바꾸지 않는다
//    (§D no-merge 게이트). gh/git merge 호출 0.

export type StepStatus = 'pass' | 'fail' | 'skipped';

export interface StepResult {
  label: string;
  action: string;
  status: StepStatus;
  /** 실패 사유 또는 "미검증(사유)" 텍스트. */
  detail?: string;
  /** 스텝 스크린샷의 리포트 상대 경로. */
  screenshot?: string;
}

export interface SurfaceResult {
  name: string;
  route: string;
  /** 사용자가 직접 열어볼 수 있는 전체 preview URL. */
  url: string;
  requiresAuth: boolean;
  status: StepStatus;
  steps: StepResult[];
  /** 관전 증거 — 비디오/트레이스 리포트 상대 경로. */
  video?: string;
  trace?: string;
  /** surface 단위 에러(스텝 진입 전 크래시 등). */
  error?: string;
}

const ICON: Record<StepStatus, string> = {
  pass: '✅',
  fail: '❌',
  skipped: '⚠️',
};

/** ARTIFACTS_DIR 기준 상대경로로 정규화(리포트가 e2e/artifacts/ 안에 놓임). */
export function relArtifact(absOrRel: string | undefined): string | undefined {
  if (!absOrRel) return undefined;
  const abs = path.isAbsolute(absOrRel) ? absOrRel : path.join(process.cwd(), absOrRel);
  return path.relative(ARTIFACTS_DIR, abs);
}

export function rollUp(steps: StepResult[]): StepStatus {
  if (steps.some((s) => s.status === 'fail')) return 'fail';
  if (steps.some((s) => s.status === 'pass')) return 'pass';
  return 'skipped';
}

export interface ReportInput {
  env: HarnessEnv;
  script: LoadedScript;
  results: SurfaceResult[];
  generatedAt: string;
}

export function buildMarkdown(input: ReportInput): string {
  const { env, script, results, generatedAt } = input;
  const total = results.length;
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;

  const lines: string[] = [];
  lines.push('# PR preview QA 리포트');
  lines.push('');
  lines.push('> ⚠️ 이 리포트는 **관전 + 자가검토용 증거**입니다. QA 하네스는');
  lines.push('> PR/머지 상태를 바꾸지 않습니다 — 머지는 사용자 명시 명령으로만.');
  lines.push('');
  lines.push('| 항목 | 값 |');
  lines.push('|---|---|');
  lines.push(`| Preview URL | ${env.previewUrl || '(미설정)'} |`);
  lines.push(`| Locale | ${env.locale} |`);
  lines.push(`| 입력 소스 | ${script.origin} |`);
  lines.push(`| 대상 표면 | ${total}개 |`);
  lines.push(`| 결과 | ✅ ${passed} · ❌ ${failed} · ⚠️ 미검증 ${skipped} |`);
  lines.push(`| 생성 시각 | ${generatedAt} |`);
  lines.push('');

  if (total === 0) {
    lines.push('## 대상 표면 없음');
    lines.push('');
    lines.push('PR diff 에서 라우트로 매핑되는 변경 표면을 찾지 못했습니다.');
    lines.push('spec 의 `## QA 스크립트` 블록을 JSON 으로 주면(`QA_SCRIPT_PATH`)');
    lines.push('결정론적 스모크가 가능합니다. `docs/QA_HARNESS.md` 참고.');
    if (script.unmapped.length > 0) {
      lines.push('');
      lines.push('라우트로 자동 매핑되지 않은 변경 파일:');
      for (const f of script.unmapped) lines.push(`- \`${f}\``);
    }
    lines.push('');
    return lines.join('\n');
  }

  lines.push('## 직접 검토 경로 (맘에 안 들면 여기로 진입)');
  lines.push('');
  for (const r of results) {
    lines.push(`- ${ICON[r.status]} **${r.name}** → ${r.url}`);
  }
  lines.push('');

  for (const r of results) {
    lines.push(`## ${ICON[r.status]} ${r.name}`);
    lines.push('');
    lines.push(`- 라우트: \`${r.route}\``);
    lines.push(`- 진입 URL: ${r.url}`);
    lines.push(`- 로그인 필요: ${r.requiresAuth ? '예 (QA 테스터 계정)' : '아니오 (익명)'}`);
    if (r.video) lines.push(`- 🎬 비디오: \`${r.video}\``);
    if (r.trace) lines.push(`- 🔍 트레이스: \`${r.trace}\` (\`pnpm exec playwright show-trace e2e/artifacts/${r.trace}\`)`);
    if (r.error) lines.push(`- ⚠️ surface 에러: ${r.error}`);
    lines.push('');
    lines.push('| # | 스텝 | 동작 | 결과 | 비고 | 스크린샷 |');
    lines.push('|---|---|---|---|---|---|');
    r.steps.forEach((s, i) => {
      const shot = s.screenshot ? `\`${s.screenshot}\`` : '—';
      const detail = s.detail ? s.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ') : '—';
      lines.push(`| ${i + 1} | ${s.label} | ${s.action} | ${ICON[s.status]} | ${detail} | ${shot} |`);
    });
    lines.push('');
  }

  lines.push('## 관전 방법');
  lines.push('');
  lines.push('- 스텝 스크린샷: `e2e/artifacts/steps/` 아래 표면별 폴더.');
  lines.push('- 비디오/트레이스: `e2e/artifacts/test-output/` (Playwright HTML 리포트: `e2e/artifacts/html-report/index.html`).');
  lines.push('- 트레이스 뷰어: `pnpm exec playwright show-trace <trace.zip>`.');
  lines.push('');
  lines.push('⚠️ 미검증(⚠️) 스텝은 preview 에 실 데이터/실 키가 없어 검증 불가한 것으로,');
  lines.push('사유가 비고에 명시돼 있습니다. 해당 항목은 prod 에서 사용자가 직접 확인해야 합니다.');
  lines.push('');
  return lines.join('\n');
}

export function writeReport(input: ReportInput): { md: string; json: string } {
  const md = buildMarkdown(input);
  const mdPath = path.join(ARTIFACTS_DIR, 'report.md');
  const jsonPath = path.join(ARTIFACTS_DIR, 'report.json');
  fs.writeFileSync(mdPath, md, 'utf8');
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        previewUrl: input.env.previewUrl,
        locale: input.env.locale,
        origin: input.script.origin,
        generatedAt: input.generatedAt,
        surfaces: input.results,
      },
      null,
      2,
    ),
    'utf8',
  );
  return { md: mdPath, json: jsonPath };
}
