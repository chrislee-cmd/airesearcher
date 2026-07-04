#!/bin/bash
# scripts/jarvis/fetch-logs.sh — QA 자동화 3-tier 로그 fetch
# usage: bash scripts/jarvis/fetch-logs.sh <keyword> [<minutes>]  (default 30분)

set -e

KEYWORD=${1:?usage: fetch-logs.sh <keyword> [<minutes>]}
MINUTES=${2:-30}
TS=$(date -u +"%Y%m%dT%H%M%SZ")

# handoff 저장 위치 (jarvis workspace, 앱 저장소 밖)
HANDOFFS_DIR="/Users/meteorresearch/jarvis/workspaces/product-2/ai-researcher/handoffs"
OUT="${HANDOFFS_DIR}/qa-${TS}.md"

# env 로드 (SENTRY_AUTH_TOKEN + POSTHOG_PERSONAL_API_KEY)
source /Users/meteorresearch/jarvis/ai-researcher.env 2>/dev/null || \
  source .env.local 2>/dev/null || true

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

# 1. Vercel logs
(
  vercel logs research-canvas.io --since ${MINUTES}m --json 2>&1 \
    | grep -Ei "level.*error|500|400|invalid_grant" \
    | head -50 > "$TMPDIR/vercel.txt"
) || echo "vercel-fail" > "$TMPDIR/vercel.err" &

# 2. Sentry API
(
  if [ -n "$SENTRY_AUTH_TOKEN" ]; then
    curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
      "https://sentry.io/api/0/projects/meteor-research/ai-researcher/issues/?statsPeriod=${MINUTES}m" \
      | jq -r '.[] | "- \(.title) [\(.culprit)] events=\(.count)"' \
      | head -20 > "$TMPDIR/sentry.txt"
  else
    echo "SENTRY_AUTH_TOKEN unset — skip" > "$TMPDIR/sentry.txt"
  fi
) || echo "sentry-fail" > "$TMPDIR/sentry.err" &

# 3. PostHog
(
  if [ -n "$POSTHOG_PERSONAL_API_KEY" ]; then
    curl -s -H "Authorization: Bearer $POSTHOG_PERSONAL_API_KEY" \
      "https://us.posthog.com/api/projects/@current/session_recordings?limit=5&date_from=-${MINUTES}m" \
      | jq -r '.results[] | "- session=\(.id) user=\(.person.distinct_ids[0]) duration=\(.recording_duration)s"' \
      > "$TMPDIR/posthog.txt"
  else
    echo "POSTHOG_PERSONAL_API_KEY unset — skip" > "$TMPDIR/posthog.txt"
  fi
) || echo "posthog-fail" > "$TMPDIR/posthog.err" &

wait

mkdir -p "$HANDOFFS_DIR"
cat > "$OUT" <<EOF
# QA 리포트 — ${KEYWORD}

- **timestamp**: ${TS}
- **time_range**: ${MINUTES}m
- **keyword**: \`${KEYWORD}\`

## Vercel logs
\`\`\`
$(cat "$TMPDIR/vercel.txt" 2>/dev/null || echo "(fetch fail)")
\`\`\`

## Sentry issues
$(cat "$TMPDIR/sentry.txt" 2>/dev/null || echo "(fetch fail)")

## PostHog session
$(cat "$TMPDIR/posthog.txt" 2>/dev/null || echo "(fetch fail)")

## 다음 액션
- spec writer 자동 스캔 → auto fix spec (spec 3 완결 시)
- 그전까지 = 사용자가 handoff 파일 워커에 전달
EOF

echo "✓ report saved: $OUT"
