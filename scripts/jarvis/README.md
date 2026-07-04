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
- Spec 4 — auto-poll (crontab) — 아래 참고

## auto-poll-logs.sh — 매 15분 자동 poll + 알림

`fetch-logs.sh` 를 **매 15분 자동 실행** 하는 래퍼. 신규 에러 감지 시 macOS
notification 을 띄우고, 에러가 없으면 handoff 를 조용히 archive 합니다.

### 동작

1. `fetch-logs.sh "auto-poll-<HHMM>" 15` 로 최근 15분치 3-tier 리포트 생성
2. 방금 생성된 최신 handoff 에서 신규 에러 개수 집계
3. **에러 > 0** → macOS notification 팝업 (**알림만** — 자동 spec launch 안 함)
4. **에러 = 0** → handoff 를 `handoffs/archive/` 로 이동 (dedup)
5. `.auto-poll-state.json` 에 마지막 poll 시각/에러수 기록

### 안전 가드

- **자동 spec launch 금지** — 에러를 감지해도 알림만. 워커를 띄우거나 spec 을
  쓰지 않습니다 (사람이 handoff 를 보고 판단).
- **Dedup** — 에러 0 이면 handoff 를 즉시 archive 해 잡음 누적을 막습니다.
- **Rate limit** — 15분 주기라 3개 소스 API rate limit 에 안전.

### crontab 등록 (Chris 수동 — 앱 저장소 밖)

스크립트만 저장소에 커밋하고, **스케줄 등록은 Chris 개인 crontab** 에서 합니다
(앱 런타임/Vercel 과 무관, 개인 머신 전용):

```bash
crontab -e
# 아래 라인 추가 (15분 주기):
*/15 * * * * /Users/meteorresearch/ai-researcher/repo/scripts/jarvis/auto-poll-logs.sh >> /tmp/qa-auto-poll.log 2>&1
```

> 경로는 **마스터 worktree** (`/Users/meteorresearch/ai-researcher/repo`) 기준.
> 워커 worktree 경로를 쓰면 머지 후 worktree 정리 시 스크립트가 사라집니다.

등록 확인 / 해제:

```bash
crontab -l                      # 등록된 job 확인
tail -f /tmp/qa-auto-poll.log   # 실행 로그 실시간 확인
crontab -e                      # 해당 라인 삭제로 중단
```

#### 대안 — macOS launchd

crontab 대신 launchd 를 쓰려면
`~/Library/LaunchAgents/com.meteor.qa-auto-poll.plist` 에 `StartInterval` 900
(초) 로 등록:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.meteor.qa-auto-poll</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/meteorresearch/ai-researcher/repo/scripts/jarvis/auto-poll-logs.sh</string>
  </array>
  <key>StartInterval</key><integer>900</integer>
  <key>StandardOutPath</key><string>/tmp/qa-auto-poll.log</string>
  <key>StandardErrorPath</key><string>/tmp/qa-auto-poll.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.meteor.qa-auto-poll.plist    # 시작
launchctl unload ~/Library/LaunchAgents/com.meteor.qa-auto-poll.plist  # 중단
```
