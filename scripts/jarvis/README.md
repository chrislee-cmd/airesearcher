# scripts/jarvis/

Jarvis workflow tooling (QA 자동화, 로그 fetch 등).

> **`scripts/` (상위) 와의 구분**: 상위 `scripts/` 는 migration/빌드 tooling
> (`check-migration-naming.sh`, `backfill-*.ts` 등). 이 하위 디렉토리 `scripts/jarvis/`
> 는 jarvis 오케스트레이션 파이프라인 전용 — 앱 런타임과 무관하며 Vercel 빌드에
> 포함되지 않습니다.

## fetch-logs.sh — QA 3-tier 로그 fetch

`/qa <이슈 문장>` 파이프라인의 로그 수집 단계. **Vercel + Sentry + PostHog** 3개
소스를 병렬로 긁어 handoff 리포트 하나로 저장합니다.

### 사용법

```bash
bash scripts/jarvis/fetch-logs.sh <keyword> [<minutes>]
# 예:
bash scripts/jarvis/fetch-logs.sh "interview-v2-search" 30
```

- `<keyword>` (필수) — 리포트 제목/필터에 쓰이는 이슈 키워드
- `<minutes>` (선택, default `30`) — 조회 시간 범위 (분)

출력: `~/jarvis/workspaces/product-2/ai-researcher/handoffs/qa-<timestamp>.md`
(앱 저장소 **밖**, jarvis workspace 안). 리포트에는 3개 소스별 섹션 + "다음 액션"
이 담깁니다.

### 인증

토큰은 코드에 하드코드하지 않고 환경에서 로드합니다 (`~/jarvis/ai-researcher.env`
우선, 없으면 로컬 `.env.local`):

| 소스 | 인증 | 없을 때 |
|---|---|---|
| Vercel | 로컬 Vercel CLI 인증 상속 | fetch 실패 표시 |
| Sentry | `SENTRY_AUTH_TOKEN` | 해당 섹션 `skip` 표시, 나머지 정상 |
| PostHog | `POSTHOG_PERSONAL_API_KEY` | 해당 섹션 `skip` 표시, 나머지 정상 |

토큰이 없는 소스는 에러로 중단하지 않고 `skip` 으로 표시하며, 나머지 소스는
정상 수집됩니다.

### 후속 (파이프라인)

- Spec 2 — `/qa` slash command (`.claude/commands/qa.md`)
- Spec 3 — spec writer rule (`~/CLAUDE.md`)
- Spec 4 — auto-poll (crontab)
