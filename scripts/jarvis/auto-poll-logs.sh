#!/bin/bash
# scripts/jarvis/auto-poll-logs.sh — 매 15분 자동 fetch + dedup + 알림
#
# crontab (Chris 개인, 앱 저장소 밖) 에서 15분 주기로 호출:
#   */15 * * * * /Users/meteorresearch/ai-researcher/repo/scripts/jarvis/auto-poll-logs.sh >> /tmp/qa-auto-poll.log 2>&1
#
# 동작:
#   1. Spec 1 fetch-logs.sh 로 최근 15분치 3-tier 로그 handoff 리포트 생성
#   2. 리포트에서 신규 에러 개수 집계
#   3. 에러>0 → macOS notification 팝업 (알림만, 자동 launch 안 함 — 안전 가드)
#   4. 에러=0 → handoff 조용히 archive (dedup)
#   5. state.json 갱신
#
# 안전 가드 (spec):
#   - 자동 spec launch 금지 — 감지 시 알림만
#   - dedup — error 0 시 handoff 즉시 archive
#   - rate limit — 15분 주기 (API rate limit 안전)

STATE_FILE="/Users/meteorresearch/jarvis/workspaces/product-2/ai-researcher/.auto-poll-state.json"
HANDOFFS_DIR="/Users/meteorresearch/jarvis/workspaces/product-2/ai-researcher/handoffs"
POLL_INTERVAL_MIN=15

# 앱 저장소 root (이 스크립트: <repo>/scripts/jarvis/auto-poll-logs.sh)
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# 1. 최근 15분치 log fetch (Spec 1 script 재사용)
bash "$REPO_ROOT/scripts/jarvis/fetch-logs.sh" "auto-poll-$(date +%H%M)" "$POLL_INTERVAL_MIN"

# 2. 방금 생성된 최신 handoff = 이번 poll 결과
LATEST=$(ls -t "$HANDOFFS_DIR"/qa-*.md 2>/dev/null | head -1)

if [ -z "$LATEST" ] || [ ! -f "$LATEST" ]; then
  echo "[$(date)] no handoff produced — fetch-logs.sh 실패 의심"
  exit 0
fi

# 3. 신규 에러 집계 (매칭 라인 수)
ERROR_COUNT=$(grep -Eic "error|500|invalid" "$LATEST" 2>/dev/null || echo 0)

if [ "$ERROR_COUNT" -gt 0 ]; then
  # macOS notification (알림만 — 자동 spec launch 안 함)
  osascript -e "display notification \"$ERROR_COUNT 신규 에러 - handoff: $(basename "$LATEST")\" with title \"QA auto-poll\"" 2>/dev/null || true
  echo "[$(date)] $ERROR_COUNT 신규 에러 → $LATEST"
else
  # dedup — 조용히 archive
  mkdir -p "$HANDOFFS_DIR/archive"
  mv "$LATEST" "$HANDOFFS_DIR/archive/"
  echo "[$(date)] no new errors → archived $(basename "$LATEST")"
fi

# 4. state 갱신 (마지막 poll 시각)
mkdir -p "$(dirname "$STATE_FILE")"
jq -n --arg ts "$(date -u +%Y%m%dT%H%M%SZ)" \
      --arg errors "$ERROR_COUNT" \
      '{last_poll: $ts, last_error_count: ($errors | tonumber)}' > "$STATE_FILE"
