# PR preview QA 하네스

배포된 **Vercel preview URL** 의 **변경 표면만** 타겟해서 Playwright 로 스모크를
돌리고, 사용자가 관전(video/trace/스텝 스크린샷) + 직접 검토(preview URL + 정확한
네비게이션 경로) 할 수 있는 리포트를 남깁니다.

핵심 3원칙 (사용자 명시, 2026-07-08):

1. **머지 명령은 항상 사용자** — 이 하네스는 **read-only**. PR/머지 상태를 절대
   바꾸지 않습니다. QA fail 이어도 자동 조치 없이 리포트만 남깁니다.
2. **관전** — video 녹화 + trace.zip + 스텝별 스크린샷을 `e2e/artifacts/` 에 저장.
3. **자가검토** — 리포트에 preview URL + locale-포함 정확한 진입 경로를 담아,
   맘에 안 들면 사용자가 직접 열어볼 수 있습니다.

## 로컬 dev 서버를 띄우지 않습니다

이 하네스는 **이미 배포된 preview URL** 만 대상으로 합니다 (`webServer` 설정 없음).
`pnpm dev` 를 띄우지 않고, `QA_PREVIEW_URL` 로 주어진 원격 URL 을 네비게이션합니다.

## 실행

```bash
# 브라우저 바이너리 1회 설치 (CI/러너 환경)
pnpm e2e:install

# preview URL + QA 테스터 계정을 env 로 주고 실행
QA_PREVIEW_URL="https://<preview>.vercel.app" \
QA_TEST_EMAIL="qa@example.com" \
QA_TEST_PASSWORD="********" \
QA_SCRIPT_PATH="e2e/qa-script.example.json" \
pnpm e2e

# 결과
#   e2e/artifacts/report.md        ← 사람이 읽는 리포트 (preview URL + 스텝 + pass/fail + 아티팩트 경로)
#   e2e/artifacts/report.json      ← 기계 판독용
#   e2e/artifacts/steps/           ← 스텝별 스크린샷
#   e2e/artifacts/test-output/     ← 비디오 + 트레이스
#   e2e/artifacts/html-report/     ← Playwright HTML 리포트
```

트레이스 뷰어: `pnpm e2e:trace e2e/artifacts/test-output/<...>/trace.zip`

## 입력 — env

| env | 필수 | 의미 |
|---|---|---|
| `QA_PREVIEW_URL` | ✅ | 대상 preview 베이스 URL |
| `QA_TEST_EMAIL` / `QA_TEST_PASSWORD` | 로그인 표면이 있을 때 | QA 테스터 계정(#149). 로그에 원문 노출 안 됨(이메일 마스킹, 비번 미로깅) |
| `QA_LOCALE` | ⛔ (기본 `ko`) | 진입 경로 locale prefix |
| `QA_SCRIPT_PATH` | 권장 | `## QA 스크립트` 를 컴파일한 JSON 파일 경로 |
| `QA_SCRIPT` | 대안 | inline JSON |
| `QA_CHANGED_FILES` | 대안 | 개행/쉼표 구분 변경 파일 목록. 없으면 `git diff origin/main...HEAD` 로 자동 도출 |

우선순위: `QA_SCRIPT_PATH` → `QA_SCRIPT` → `QA_CHANGED_FILES`/git diff.

## QA 스크립트 (결정론적 입력)

spec 의 `## QA 스크립트` 블록 = "preview 진입 경로 · 클릭/입력 스텝 · 기대 UI
assertion" 을 아래 JSON 으로 컴파일한 것입니다. 이게 하네스의 결정론적 입력입니다.

```jsonc
{
  "surfaces": [
    {
      "name": "글로벌 소스 P2a — SEC EDGAR",
      "route": "/desk-research",       // locale prefix 자동 (/ko/desk-research)
      "requiresAuth": true,            // 기본 true
      "steps": [
        { "label": "진입", "action": "goto", "path": "/desk-research" },
        { "label": "패널 노출", "action": "expect", "selector": "text=글로벌 소스" },
        { "label": "소스 선택", "action": "click", "selector": "text=SEC EDGAR" },
        { "label": "검색어 입력", "action": "fill", "selector": "input[name=q]", "value": "Apple" },
        {
          "label": "실 재무 데이터",
          "action": "note",
          "dataDependent": true,       // preview 검증 불가 → 리포트에 "미검증(사유)"
          "reason": "preview 에 실 API 키/캐시 없음 — prod 확인 필요"
        }
      ]
    }
  ]
}
```

**action**: `goto` · `click` · `fill`(value) · `expect`(selector 가 보이는지) · `note`(메모).
**selector**: Playwright locator 문자열 — `text=...`, css, `[role=...]` 등.
**dataDependent**: 실 데이터/실 키가 없어 preview 에서 검증 불가한 스텝. 실행하지
않고 리포트에 `⚠️ 미검증(사유)` 로 **정직하게** 표기합니다 (검증 가능한 척 X).
`reason` 필수.

스크립트가 없으면 PR diff 에서 앱 라우트 변경 파일만 골라 `/route` 로 매핑하고
"페이지가 렌더되는가" 최소 스모크만 돕니다 (전체 앱을 훑지 않음).

## no-merge 보장

이 디렉토리 + `playwright.config.ts` 어디에도 `gh` / `git merge` / PR API 호출이
없습니다. 하네스는 파일(아티팩트/리포트)만 씁니다. 트리거·증거 제출·머지는
jarvis 런북 / 사용자 몫입니다.
