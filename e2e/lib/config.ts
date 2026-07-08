import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ─────────────────────────────────────────────────────────────────────────
// QA 하네스 설정/입력 — Playwright 를 import 하지 않는 순수 모듈.
// 여기서 하는 일:
//   1. env 읽기(preview URL, QA 테스터 계정) + secret 을 절대 로그에 안 흘림
//   2. QA 스크립트(결정론적 입력) 로드 — spec 의 `## QA 스크립트` 블록을
//      JSON 으로 컴파일한 것. 없으면 PR diff 에서 변경 표면 자동 도출.
// ─────────────────────────────────────────────────────────────────────────

export const ARTIFACTS_DIR = path.join(process.cwd(), 'e2e', 'artifacts');
export const RESULTS_DIR = path.join(ARTIFACTS_DIR, 'results');
export const STEPS_DIR = path.join(ARTIFACTS_DIR, 'steps');
export const STORAGE_STATE = path.join(ARTIFACTS_DIR, '.auth', 'state.json');

export type StepAction = 'goto' | 'click' | 'fill' | 'expect' | 'note';

export interface QAStep {
  /** 무엇을 하는 스텝인지 — 리포트 + 스크린샷 파일명에 그대로 쓰임. */
  label: string;
  action: StepAction;
  /** click/fill/expect 용 Playwright locator 문자열 (예: "text=SEC EDGAR", css). */
  selector?: string;
  /** fill 용 입력값. */
  value?: string;
  /** goto 용 경로 override. 없으면 surface.route 를 씀. */
  path?: string;
  /**
   * preview 에서 검증 불가한 스텝(실 데이터/실 키 필요)임을 표시.
   * true 면 실행하지 않고 리포트에 "미검증(사유)"로 정직 표기. reason 필수.
   */
  dataDependent?: boolean;
  reason?: string;
}

export interface QASurface {
  name: string;
  /** 대표 라우트 경로. 예: "/desk-research" (locale prefix 는 자동으로 붙음). */
  route: string;
  /** 이 표면이 로그인 필요한지. 기본 true. */
  requiresAuth?: boolean;
  steps: QAStep[];
}

export interface QAScript {
  surfaces: QASurface[];
}

export interface HarnessEnv {
  previewUrl: string;
  locale: string;
  email: string | undefined;
  password: string | undefined;
}

/** 로그·에러 메시지에 절대 secret 원문이 안 나가도록 이메일을 마스킹. */
export function redactEmail(email: string | undefined): string {
  if (!email) return '(미설정)';
  const at = email.indexOf('@');
  if (at <= 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

export function readEnv(): HarnessEnv {
  return {
    previewUrl: (process.env.QA_PREVIEW_URL || '').trim(),
    locale: (process.env.QA_LOCALE || 'ko').trim(),
    email: process.env.QA_TEST_EMAIL?.trim() || undefined,
    // 비밀번호는 존재 여부만 다룬다 — 값은 어디에도 로깅/직렬화하지 않음.
    password: process.env.QA_TEST_PASSWORD || undefined,
  };
}

/** locale prefix 를 붙인 절대 경로. route 는 "/canvas" 같은 앱 경로. */
export function localizedPath(route: string, locale: string): string {
  const clean = route.startsWith('/') ? route : `/${route}`;
  return `/${locale}${clean}`;
}

// ── QA 스크립트 로딩 ───────────────────────────────────────────────────────

function validateScript(raw: unknown, source: string): QAScript {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as QAScript).surfaces)) {
    throw new Error(`QA 스크립트(${source}) 형식 오류: { "surfaces": [...] } 여야 합니다.`);
  }
  const surfaces = (raw as QAScript).surfaces;
  for (const s of surfaces) {
    if (!s || typeof s.name !== 'string' || typeof s.route !== 'string' || !Array.isArray(s.steps)) {
      throw new Error(`QA 스크립트(${source}) surface 형식 오류: name/route/steps 필수.`);
    }
    for (const step of s.steps) {
      if (typeof step.label !== 'string' || typeof step.action !== 'string') {
        throw new Error(`QA 스크립트(${source}) step 형식 오류: label/action 필수.`);
      }
      if (step.dataDependent && !step.reason) {
        throw new Error(
          `QA 스크립트(${source}) step "${step.label}" 는 dataDependent 인데 reason 이 없습니다 — 정직 표기를 위해 사유 필수.`,
        );
      }
    }
  }
  return { surfaces };
}

// PR diff → 변경 표면(라우트) 자동 도출. spec QA 스크립트가 없을 때의 fallback.
// 앱 라우트 파일만 매핑한다 — 전체 앱을 훑지 않기 위해(§B 변경 표면만).
const APP_ROUTE_RE = /src\/app\/\[locale\]\/(?:\([^)]+\)\/)*([^/]+)\/(?:page|layout)\.tsx?$/;

export function resolveSurfacesFromFiles(files: string[]): {
  surfaces: QASurface[];
  unmapped: string[];
} {
  const routes = new Set<string>();
  const unmapped: string[] = [];
  for (const f of files) {
    const m = f.match(APP_ROUTE_RE);
    if (m && m[1] && m[1] !== '[locale]') {
      routes.add(`/${m[1]}`);
    } else if (f.startsWith('src/') && /\.(tsx?|css)$/.test(f)) {
      unmapped.push(f);
    }
  }
  const surfaces: QASurface[] = [...routes].sort().map((route) => ({
    name: `변경 라우트 ${route}`,
    route,
    requiresAuth: true,
    steps: [
      { label: `${route} 진입`, action: 'goto' as const },
      {
        label: '페이지 렌더 확인(에러 바운더리/500 아님)',
        action: 'expect' as const,
        selector: 'body',
      },
    ],
  }));
  return { surfaces, unmapped };
}

function changedFilesFromGit(): string[] {
  try {
    const out = execSync('git diff --name-only origin/main...HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export interface LoadedScript extends QAScript {
  /** 어디서 왔는지 — 리포트에 표기. */
  origin: string;
  /** 자동 도출 시 라우트로 매핑 못 한 변경 파일들(정직 표기용). */
  unmapped: string[];
}

/**
 * 우선순위:
 *   1. QA_SCRIPT_PATH (JSON 파일) — spec 의 `## QA 스크립트` 를 컴파일한 것
 *   2. QA_SCRIPT (inline JSON)
 *   3. QA_CHANGED_FILES (개행/쉼표 구분) 또는 git diff → 변경 표면 자동 도출
 */
export function loadScript(): LoadedScript {
  const scriptPath = process.env.QA_SCRIPT_PATH?.trim();
  if (scriptPath) {
    const abs = path.isAbsolute(scriptPath) ? scriptPath : path.join(process.cwd(), scriptPath);
    const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return { ...validateScript(raw, scriptPath), origin: `QA_SCRIPT_PATH=${scriptPath}`, unmapped: [] };
  }

  const inline = process.env.QA_SCRIPT?.trim();
  if (inline) {
    const raw = JSON.parse(inline);
    return { ...validateScript(raw, 'QA_SCRIPT'), origin: 'QA_SCRIPT (inline)', unmapped: [] };
  }

  const explicit = process.env.QA_CHANGED_FILES?.trim();
  const files = explicit
    ? explicit.split(/[\n,]/).map((f) => f.trim()).filter(Boolean)
    : changedFilesFromGit();
  const { surfaces, unmapped } = resolveSurfacesFromFiles(files);
  return {
    surfaces,
    origin: explicit ? 'QA_CHANGED_FILES → 변경 표면 자동 도출' : 'git diff origin/main...HEAD → 변경 표면 자동 도출',
    unmapped,
  };
}

/** 파일명에 안전한 slug (스크린샷/결과 파일 경로용). */
export function slug(input: string): string {
  return input
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'x';
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
