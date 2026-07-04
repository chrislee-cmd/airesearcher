---
description: QA 3-tier 로그 자동 fetch (Vercel + Sentry + PostHog) 후 handoff 리포트 생성
---

# QA 자동 로그 fetch

사용자 입력: `$ARGUMENTS`

`scripts/jarvis/fetch-logs.sh` 를 실행해 최근 로그를 3-tier(Vercel + Sentry + PostHog)로 긁고, jarvis handoff 리포트를 만든 뒤 요약을 보고한다.

## 절차

1. **인자 파싱** — `$ARGUMENTS` 를 다음 규칙으로 나눈다:
   - 인자가 비어 있으면 → keyword = `recent`, minutes = `30`.
   - 마지막 토큰이 순수 숫자면 → 그 값이 minutes, 나머지가 이슈 문장. (예: `인터뷰 검색 empty 60` → 이슈="인터뷰 검색 empty", minutes=60)
   - 그 외 → 전체가 이슈 문장, minutes = `30`.
2. **keyword slugify** — 이슈 문장을 소문자화 없이 공백을 `-` 로 치환하고, 앞뒤 `-` 를 제거한 뒤 **최대 40자**로 자른다. (예: `인터뷰 V2 검색 empty result` → `인터뷰-V2-검색-empty-result`)
3. **스크립트 실행**:
   ```bash
   bash scripts/jarvis/fetch-logs.sh "<keyword>" <minutes>
   ```
4. **결과 경로 알림** — 스크립트 stdout 의 `✓ report saved: <경로>` 에서 handoff 파일 절대경로를 뽑아 사용자에게 알린다. (handoff 는 앱 저장소 밖 jarvis workspace 에 저장됨)
5. **요약 한 줄** — handoff 파일을 읽어 각 tier 를 집계해 한 줄로 보고한다:
   - Vercel: `## Vercel logs` 코드블록의 non-empty 라인 수 = error 라인 수
   - Sentry: `## Sentry issues` 섹션의 `- ` 로 시작하는 항목 수 = issue 수 (`unset — skip` 이면 0/미수집)
   - PostHog: `## PostHog session` 섹션의 `- session=` 항목 수 = session 수 (`unset — skip` 이면 0/미수집)
   - 형식 예: `요약: Vercel 3 errors, Sentry 1 issue, PostHog 2 sessions`
6. **다음 액션 안내**:
   - "spec writer 자동 스캔 활성 시 → 이 handoff 가 auto fix spec(Spec 3)으로 소비됨"
   - "그전까지 → 사용자가 handoff 파일을 열어 워커에게 직접 전달"

## 엣지 케이스

- **`/qa` 만 입력 (이슈 없음)** → keyword=`recent`, 최근 30분 전체.
- **`/qa <이슈> 60`** → 마지막 숫자 토큰을 minutes 로 해석 (60분 range).
- **스크립트 실행 실패** (env 미설정, `vercel`/`jq`/`curl` 부재, 네트워크 오류 등):
  - 실패 원인을 그대로 명시한다 (stderr / 종료 코드).
  - 부분 성공도 handoff 파일에 `(fetch fail)` 로 기록되니, 생성된 파일이 있으면 경로를 알린다.
  - fallback 수동 명령을 안내한다:
    ```bash
    bash scripts/jarvis/fetch-logs.sh "<keyword>" <minutes>
    ```
    그리고 `SENTRY_AUTH_TOKEN` / `POSTHOG_PERSONAL_API_KEY` 는 `/Users/meteorresearch/jarvis/ai-researcher.env` 또는 `.env.local` 에서 로드됨을 알린다.

## 사용 예시

```
/qa 인터뷰 V2 검색 empty result
  ↓
bash scripts/jarvis/fetch-logs.sh "인터뷰-V2-검색-empty-result" 30
  → ✓ report saved: /Users/meteorresearch/jarvis/workspaces/product-2/ai-researcher/handoffs/qa-<ts>.md
  → 요약: Vercel 3 errors, Sentry 1 issue, PostHog 2 sessions
```
