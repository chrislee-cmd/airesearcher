#!/usr/bin/env bash
# 편의 래퍼 — 로더 배선(register)을 매번 타이핑하지 않도록. 인자는 그대로 러너에 전달.
# 예: bash scripts/spikes/desk-websearch-eval.sh --check
#     bash scripts/spikes/desk-websearch-eval.sh --only current --limit 8
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node --experimental-strip-types \
  --import 'data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; register("./scripts/spikes/desk-lib-loader.mjs", pathToFileURL("./"));' \
  --env-file-if-exists=.env.local \
  scripts/spikes/desk-websearch-eval.mjs "$@"
