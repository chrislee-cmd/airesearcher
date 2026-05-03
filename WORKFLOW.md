# Branching & Release Workflow

이 저장소는 **main long-lived + feature branch 모델**로 운영합니다. 새로운 터미널/세션에서 작업을 시작하기 전에 이 문서를 먼저 읽으세요.

Repo: `https://github.com/chrislee-cmd/airesearcher`
Default branch: `main`
Deploy target: Vercel (production = `main`, preview = 모든 feature 브랜치)

---

## 1. 브랜치 구조

| 브랜치 | 수명 | 역할 |
|---|---|---|
| `main` | **영구 (long-lived)** | 항상 배포 가능한 상태. Vercel production이 여기에 따라옵니다. 직접 커밋 금지. |
| `feat/*` | 단기 (기능 단위) | 새 기능 추가. 머지 후 삭제. |
| `fix/*` | 단기 (버그 수정) | 버그 수정. 머지 후 삭제. |
| `chore/*` | 단기 | 리팩터, 의존성 업그레이드, 문서, 인프라. |
| `hotfix/*` | 단기 | production 긴급 수정. main에서 분기, main으로 바로 PR. |

브랜치 이름은 **kebab-case**, prefix 필수. 예시:
- `feat/voc-only-cells`
- `feat/transcript-generator`
- `fix/empty-matrix-columns`
- `chore/upgrade-next-16`

---

## 2. 1 작업 = 1 브랜치 = 1 PR

> "기능 단위로 별도 브랜치"가 핵심 규칙입니다. 절대 main에 직접 푸시하지 마세요.

### 새 작업 시작
```bash
git checkout main
git pull origin main
git checkout -b feat/<기능-이름>
```

### 작업 중
- 자주 커밋하세요. 커밋 메시지는 **why** 위주로 한 줄.
- 작업 도중 main에 머지된 변경이 생기면 rebase로 따라잡습니다:
  ```bash
  git fetch origin
  git rebase origin/main
  ```
  (충돌이 크면 `git merge origin/main`도 허용. 단 PR 머지 직전에는 rebase로 정리.)

### push & PR
```bash
git push -u origin feat/<기능-이름>
gh pr create --base main --title "..." --body "..."
```

PR 본문 형식 (HEREDOC 권장):
```
## Summary
- 무엇이 바뀌었는지 1~3 bullet

## Test plan
- [ ] 로컬 빌드 통과
- [ ] Vercel preview에서 해당 화면 확인
- [ ] 회귀 가능 영역 점검
```

---

## 3. PR 머지 규칙

머지 전 체크리스트:
1. **CI/Vercel preview 빌드 성공** — 실패한 PR은 머지 금지.
2. **Preview URL에서 직접 동작 확인** — UI 변경이라면 반드시 브라우저로 확인.
3. **main과 충돌 없음** — 필요하면 rebase 후 force-push (`git push --force-with-lease`).
4. **secrets/.env 파일 미포함** — `.env*`는 절대 커밋 금지.

머지 방식:
- 기본 **Squash merge** (히스토리 깔끔하게).
- 머지 후 원격 브랜치 삭제 (`gh pr merge --squash --delete-branch`).
- 로컬도 정리:
  ```bash
  git checkout main && git pull origin main
  git branch -d feat/<기능-이름>
  ```

---

## 4. 환경 / 배포

- **Production** = `main`. 머지 즉시 Vercel이 배포.
- **Preview** = 모든 feature 브랜치. PR 댓글에 Vercel이 URL 자동 코멘트.
- 환경 변수는 Vercel 대시보드 또는 `vercel env` CLI로 관리. `.env.local`은 로컬 전용.
- 새 secret을 추가하면 **production / preview / development 세 환경에 모두** 등록해야 preview에서 NPE가 나지 않습니다.

---

## 5. Hotfix 절차

production이 깨졌을 때만:
```bash
git checkout main && git pull
git checkout -b hotfix/<설명>
# 수정 → 커밋 → push
gh pr create --base main --title "hotfix: ..." 
# 빠른 리뷰 후 squash merge
```
hotfix는 별도 staging 거치지 않습니다. 단, **반드시 PR**을 통합니다 (직접 push 금지).

---

## 6. 절대 하지 말아야 할 것

- ❌ `main`에 직접 commit/push
- ❌ `git push --force` (main 또는 공유 브랜치 대상)
- ❌ `--no-verify`로 hook 우회
- ❌ `.env*`, API 키, 토큰 커밋
- ❌ 한 PR에 여러 기능 섞기 (리뷰 불가)
- ❌ feature 브랜치를 무한히 살려두기 (1주일 이상이면 rebase 또는 분할)

---

## 7. 빠른 참조 — 새 터미널 첫 명령

```bash
cd /Users/churryboy/AI-researcher/ai-researcher
git checkout main && git pull origin main
git checkout -b feat/<오늘의-작업>
# ... 작업 ...
git push -u origin HEAD
gh pr create --base main
```

이 흐름만 지키면 main은 항상 깨끗하고, 모든 작업은 PR/preview를 거쳐 production에 도달합니다.
