# AI Researcher — 프로젝트 가이드 (SSOT)

이 문서는 이 리포지토리에서 일하는 모든 에이전트/터미널이 첫 화면에서 읽는 **단일 진입점(Single Source of Truth)** 입니다.
- 새 세션이 열릴 때
- 다른 피처 작업을 시작할 때
- 다른 에이전트와 협업할 때

— 항상 먼저 이 문서를 읽고 들어오세요.

---

## 1. 핵심 사실

| 항목 | 값 |
|---|---|
| Repo | `https://github.com/chrislee-cmd/airesearcher` |
| Default branch | `main` (Vercel production 자동 배포) |
| Stack | Next.js 16 (App Router) · Supabase · next-intl (ko/en) · Pretendard · Tailwind |
| Package manager | pnpm |
| 마스터 worktree | `/Users/churryboy/AI-researcher/ai-researcher` — 항상 `main` 고정. 통합/머지 전용. |
| 마스터 에이전트 | 1명. 모든 머지·충돌 해결·PR 정리·이 문서 갱신을 담당. |
| 워커 에이전트 | N명. 각자 자기 worktree + 자기 브랜치에서 commit/push. |

---

## 2. 멀티 에이전트 워크플로우 — 왜 worktree인가

### 문제 (실제로 겪음)
한 디렉토리에 여러 에이전트가 붙으면 한 에이전트의 `git checkout`이 working tree 전체를 갈아엎으면서 다른 에이전트의 미커밋 작업이 사라지거나 엉뚱한 브랜치에 따라붙습니다. JSON locale 파일에서 한 에이전트의 untracked 변경이 다른 에이전트의 commit에 빨려 들어가는 사고도 실제 발생했습니다 (PR #4 Moderator 누출, workspace-panel 작업 두 차례 손실, stash 8개 누적).

### 해결: 에이전트당 1 worktree
```
/Users/churryboy/AI-researcher/                  ← parent
├── ai-researcher/                               ← 마스터 worktree (main 고정)
├── wt-<feature-name>/                           ← 워커 1
├── wt-<another-feature>/                        ← 워커 2
└── ...
```

각 worktree는 같은 `.git` 저장소를 공유하지만 **체크아웃된 브랜치와 working tree는 독립**. 한 워커가 commit/push 하면 다른 worktree에서 `git fetch`로 즉시 보입니다. 이 룰은 모든 새 피처 작업에 동일하게 적용됩니다 — 특정 피처만 격리하는 게 아닙니다.

---

## 3. 브랜치 / PR / 머지 규칙

### 3.1 브랜치 구조

| 브랜치 | 수명 | 역할 |
|---|---|---|
| `main` | **영구 (long-lived)** | 항상 배포 가능한 상태. Vercel production이 여기에 따라옵니다. 직접 커밋 금지. |
| `feat/*` | 단기 (기능 단위) | 새 기능 추가. 머지 후 삭제. |
| `fix/*` | 단기 (버그 수정) | 버그 수정. 머지 후 삭제. |
| `chore/*` | 단기 | 리팩터, 의존성 업그레이드, 문서, 인프라. |
| `hotfix/*` | 단기 | production 긴급 수정. main에서 분기, main으로 바로 PR. |

브랜치 이름은 **kebab-case**, prefix 필수. 예: `feat/voc-only-cells`, `fix/empty-matrix-columns`, `chore/upgrade-next-16`.

### 3.2 1 작업 = 1 브랜치 = 1 PR
"기능 단위로 별도 브랜치"가 핵심 규칙. 절대 main에 직접 push 금지. PR 1개에 여러 기능 섞지 마세요(리뷰 불가).

### 3.3 커밋 메시지
- **why** 위주로 한 줄
- prefix 필수 — 브랜치 prefix와 같은 규칙(`feat:`, `fix:`, `chore:`, `hotfix:`)

### 3.4 PR 본문 형식 (HEREDOC 권장)
```
## Summary
- 무엇이 바뀌었는지 1~3 bullet

## Test plan
- [ ] 로컬 빌드 통과
- [ ] Vercel preview에서 해당 화면 확인
- [ ] 회귀 가능 영역 점검
```

### 3.5 머지 전 체크리스트
1. **CI/Vercel preview 빌드 성공** — 실패한 PR은 머지 금지
2. **Preview URL에서 직접 동작 확인** — UI 변경이라면 반드시 브라우저로 확인
3. **main과 충돌 없음** — 필요하면 자기 브랜치에서 rebase 후 force-push (`git push --force-with-lease`)
4. **secrets/.env 파일 미포함** — `.env*`는 절대 커밋 금지
5. **commit 직전 `git diff --cached` 검증** — 본인 변경만 들어갔는지 확인 (특히 `messages/*.json`)

### 3.6 머지 방식
- 기본 **Squash merge** (히스토리 깔끔하게)
- 머지 후 원격 브랜치 삭제 (`gh pr merge --squash --delete-branch`)
- 마스터 디렉토리에서 `git fetch origin --prune`으로 원격 정리

---

## 4. 새 워커 에이전트 합류 절차

> **다른 터미널/에이전트가 새로 작업을 시작할 때 정확히 이 순서를 따르세요.**

```bash
# 1. 마스터 디렉토리에서 worktree 생성 (마스터 디렉토리 자체는 건드리지 않음)
cd /Users/churryboy/AI-researcher/ai-researcher
git fetch origin
git worktree add ../wt-<feature-name> -b feat/<feature-name> origin/main

# 2. 자기 worktree로 이동해서 의존성 설치
cd ../wt-<feature-name>
pnpm install
# .env.local 이 필요하면 마스터 디렉토리에서 복사
cp ../ai-researcher/.env.local . 2>/dev/null || true

# 3. 작업 → commit → push (commit 메시지 규칙은 §3.3 참고)
git push -u origin HEAD

# 4. PR 오픈 (본문 형식은 §3.4 참고)
gh pr create --base main --title "..." --body "..."
```

### 작업 도중 main이 갱신됐을 때
```bash
git fetch origin
git rebase origin/main
# 충돌이 크면 git merge origin/main 도 허용. 단 PR 머지 직전에는 rebase로 정리.
```

### 작업 종료 후 정리
```bash
# 마스터 dir에서
cd /Users/churryboy/AI-researcher/ai-researcher
git worktree remove ../wt-<feature-name>
# (worktree에 미커밋 변경이 있으면 --force 필요. 그전에 commit/push 하세요.)
```

---

## 5. 마스터 에이전트 동작 규칙

### 5.1 머지 전 충돌 dry-run
```bash
git fetch origin
for b in <PR 브랜치들>; do
  out=$(git merge-tree --write-tree --no-messages main $b 2>&1)
  echo "$b → $(echo "$out" | grep -q '<<<<<<<' && echo CONFLICT || echo clean)"
done
```

> 주의: `merge-tree --write-tree`는 종종 false-clean을 보고합니다. 신뢰성 있게 확인하려면 임시 worktree(`git worktree add /tmp/merge-test -b _test main`)에서 실제 `git merge`를 시뮬레이션하세요.

### 5.2 충돌 해결 흐름 (예: messages/*.json 인접 삽입 충돌)
```bash
# 마스터 dir에서, 충돌 PR 브랜치를 main 위에 rebase
git checkout feat/<branch>
git fetch origin && git rebase origin/main
# 충돌 해결 → JSON 유효성 검증 (node -e "JSON.parse(...)") → git add → git rebase --continue
git push --force-with-lease
gh pr merge <#> --squash --delete-branch
git checkout main && git pull origin main --ff-only
```

### 5.3 Hotfix 절차
production이 깨졌을 때만:
```bash
# 워커 worktree에서
git checkout main && git pull
git checkout -b hotfix/<설명>
# 수정 → 커밋 → push
gh pr create --base main --title "hotfix: ..."
# 빠른 리뷰 후 squash merge
```
hotfix는 별도 staging 거치지 않습니다. 단, **반드시 PR**을 통합니다 (직접 push 금지).

---

## 6. 절대 하지 말 것

- ❌ 마스터 worktree(`ai-researcher/`)에서 다른 브랜치로 `git checkout` — 다른 워커의 추적 안 된 작업이 따라붙거나 사라질 수 있음
- ❌ 같은 working tree를 두 에이전트가 동시에 사용
- ❌ `git add .` 또는 `git add -A` — 다른 에이전트의 untracked 변경이 같이 캡처됨. 항상 명시적 path만 add
- ❌ commit 직전 `git diff --cached` 확인 없이 commit — 본인 변경만 들어갔는지 검증
- ❌ `main`에 직접 commit/push
- ❌ `git push --force` (main 또는 공유 브랜치 대상) — 자기 feature 브랜치는 `--force-with-lease`만 OK
- ❌ `--no-verify`로 hook 우회
- ❌ `.env*`, API 키, 토큰 commit
- ❌ 한 PR에 여러 기능 섞기 (리뷰 불가)
- ❌ feature 브랜치를 무한히 살려두기 (1주일 이상이면 rebase 또는 분할)

---

## 7. 알려진 함정

### 7.1 messages/*.json 핫스팟
ko.json/en.json은 거의 모든 피처가 건드리는 hot-spot. 여러 PR이 같은 위치(주로 `Members` 섹션 직전)에 새 top-level 섹션을 삽입하면 git auto-merge 실패.

**관행:**
- 새 top-level locale 섹션은 자기 피처와 알파벳/관련도 순서로 배치 (무조건 `Members` 직전 X)
- `Sidebar.<key>`, `Features.<key>` 처럼 기존 섹션 내부 추가는 자기 키 위치에서 추가 (충돌 드묾)
- commit 직전 `git diff --cached messages/ko.json messages/en.json`으로 본인 변경만 들어갔는지 검증

### 7.2 Untracked 오염
워커가 작업 중 untracked 파일이 working tree에 남으면 다른 워커의 `git checkout` 시 따라 다닙니다. 가능한 한 commit하거나 명시적으로 stash. worktree 룰을 지키면 거의 발생하지 않음.

### 7.3 Stash 남용 금지
자동화나 다른 에이전트가 임의로 `git stash`를 호출하면 stash 목록이 빠르게 더러워집니다 (실제로 8개까지 누적된 적 있음). stash는 본인 변경만, 명시적으로만. 잃어버리기 싫은 작업은 임시 commit이라도 하세요.

### 7.4 `git checkout TREE -- PATH`의 부작용
이 명령은 working tree만 갱신하는 게 아니라 **index에도 stage**합니다. 임시 추출 후 `mv`로 옮긴다고 끝이 아니라 `git restore --staged <path>`로 index에서도 빼야 다음 commit이 오염되지 않습니다.

---

## 8. 환경 / 배포

| 환경 | 트리거 | URL |
|---|---|---|
| Production | `main` push (squash merge) | (Vercel project URL) |
| Preview | 모든 feature 브랜치 push | PR 댓글에 자동 코멘트 |
| Local | `pnpm dev` | http://localhost:3000 |

- 환경 변수는 Vercel 대시보드 또는 `vercel env` CLI로 관리
- 새 secret 추가 시 production / preview / development **세 환경 모두**에 등록 (없으면 preview에서 NPE)
- `.env.local`은 로컬 전용, 절대 commit 금지
- locale은 ko (default), en. 새 텍스트는 두 locale 모두 추가

---

## 9. 디자인 시스템

- 토큰/패턴: **`/Users/churryboy/AI-researcher/design-system.md`** (저장소 외부)
- 핵심 원칙: Editorial 톤 · 4px radius · 1px border · no shadow · 단일 amore 액센트 · Pretendard
- 새 컴포넌트는 디자인 시스템 토큰 변수만 사용 — `text-ink`, `border-line`, `bg-paper`, `text-amore`, `text-mute`, `text-mute-soft`, `border-line-soft` 등

---

## 10. 참고 문서 위계

| 문서 | 역할 |
|---|---|
| `CLAUDE.md` | Claude Code 자동 로드 진입점. `@PROJECT.md` + `@AGENTS.md` 참조 |
| `PROJECT.md` (이 문서) | **단일 진입점.** 멀티 에이전트 협업 · 브랜치/PR/머지 규칙 · 환경 · 함정 |
| `AGENTS.md` | Next.js 16 중요 변경점 / 학습 데이터 outdated 경고 |
| `design-system.md` | UI 토큰 (저장소 외부, parent dir) |
| `docs/archive/` | stash 복구·이전 사고 기록 등 보존용 patch 모음 |
| `node_modules/next/dist/docs/` | Next.js 16 정식 문서 (학습 데이터 outdated 시 우선) |

---

## 11. 변경 이력

- **2026-05-04** — 첫 작성. 여러 에이전트가 같은 working tree에서 충돌하던 문제(PR #4 Moderator 누출, stash 8개 누적, workspace-panel 작업 두 차례 손실)를 해결하고 worktree 기반 워크플로우로 전환.
- **2026-05-04** — `WORKFLOW.md`를 이 문서에 통합 흡수, `WORKFLOW.md` 파일 삭제, CLAUDE.md를 `@PROJECT.md`로 정리.
