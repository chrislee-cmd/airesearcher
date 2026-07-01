# Google admin-proxy 설정 runbook

> 리크루팅 폼 발행 시, **모든 앱 사용자의 폼·응답을 운영자 단일 Google 계정으로 통합 저장**하는 admin-proxy 기능을 켜는 절차. 코드는 이미 완비돼 있고 (`src/lib/google-oauth-admin.ts`), **env 2개만 등록하면 즉시 활성**됩니다. 관련: share 기능용 OAuth client 는 `docs/SHARE_GOOGLE_OAUTH_SETUP.md`.

## 목표

앱의 어떤 사용자가 리크루팅 폼을 만들든, 발행된 Google Form / 응답 Sheet 가 **chris.lee@meteor-research.com** 의 Google Drive 한 곳에 모이게 한다. 사용자는 매번 Google consent 를 거치지 않고 (legacy per-user OAuth 경로 우회), 운영자는 모든 리크루팅 응답을 한 Drive 에서 감사할 수 있다.

## 동작 원리 — 이미 있는 코드

| 코드 | 역할 |
|---|---|
| `src/lib/google-oauth-admin.ts` `isAdminProxyConfigured()` | `GOOGLE_ADMIN_REFRESH_TOKEN` + `GOOGLE_ADMIN_EMAIL` 둘 다 있으면 `true` → admin-proxy 경로 활성 |
| `src/lib/google-oauth-admin.ts` `getAdminAccessToken()` | 저장된 refresh_token 을 1시간짜리 access_token 으로 교환 (in-memory 캐시, 60s skew) |
| `recruiting_forms.owner_email` 컬럼 | legacy per-user 폼 (옛 소유자) vs 새 admin-proxy 폼 (`GOOGLE_ADMIN_EMAIL` 소유) 라우팅 |
| 4 route (`create` / `status` / `responses` / `link-sheet`) + wizard | 모두 `isAdminProxyConfigured()` 로 admin / legacy 분기 |

즉 **코드 변경 없이 env 등록 + Google Cloud Console setup 만** 하면 된다.

## 사전 요건

### 1. Google Workspace 여부 확인 (권장 경로 결정)

- `meteor-research.com` 이 **Google Workspace 도메인**이면 → OAuth consent screen 을 **Internal** 로 전환 가능 → Google 앱 verification 불필요 + test-user 100명 제한 없음 + refresh_token 7일 만료 없음.
- Workspace 가 아니면 (개인 Gmail 기반) → consent screen 이 **External** 이라 Testing 모드에서 refresh_token 이 7일 만에 만료된다. 이 경우 앱을 **Production 으로 게시(Publish)** 해야 refresh_token 이 장기 유효 (verification 심사가 필요할 수 있음). 만료 시 아래 Sentry alarm 이 잡아준다.

### 2. OAuth consent screen scope 등록

`src/lib/google-oauth.ts` 의 `SHARE_SCOPES` 가 요구하는 scope 전부를 consent screen 에 등록:

- `.../auth/forms.body`
- `.../auth/forms.responses.readonly`
- `.../auth/drive.file`
- `.../auth/spreadsheets`
- `.../auth/documents`
- `.../auth/userinfo.email`

> scope 가 좁으면 (sheets/drive 없이 연결) 발행 시 "재연결 필요" 로 막힌다. 운영자 계정으로 처음 붙을 때 **위 scope 전부 동의**해야 한다.

### 3. OAuth client redirect URI

Google Cloud Console → Credentials → OAuth 2.0 Client 의 Authorized redirect URIs 에 production 콜백이 있는지 확인 (`docs/SHARE_GOOGLE_OAUTH_SETUP.md` 3.1 표 참고). 없으면 추가 후 5~10분 propagation 대기.

## 절차

### 1단계 — 운영자 계정으로 refresh_token 뽑기

1. production 앱에 **chris.lee@meteor-research.com** 으로 로그인.
2. 리크루팅 위저드에서 Google 연동 시작 (share flow: `/api/share/google/start` — `SHARE_SCOPES` 로 붙어야 forms/sheets/drive 전부 포함).
3. OAuth consent 화면에서 위 6 scope 전부 동의.
4. callback 완료 후, Supabase 에서 방금 저장된 refresh_token 조회:
   ```sql
   select refresh_token, email
   from user_google_oauth
   where email = 'chris.lee@meteor-research.com';
   ```
5. `refresh_token` 값을 안전한 곳에 복사 (아래 env 로만 쓰고, 절대 commit 금지 — PROJECT.md §6).

### 2단계 — Vercel env 등록 (3 환경 모두)

`GOOGLE_ADMIN_EMAIL` = `chris.lee@meteor-research.com`.

```bash
vercel env add GOOGLE_ADMIN_REFRESH_TOKEN production
vercel env add GOOGLE_ADMIN_REFRESH_TOKEN preview
vercel env add GOOGLE_ADMIN_REFRESH_TOKEN development
vercel env add GOOGLE_ADMIN_EMAIL production      # chris.lee@meteor-research.com
vercel env add GOOGLE_ADMIN_EMAIL preview
vercel env add GOOGLE_ADMIN_EMAIL development
```

> `src/env.ts` 스키마: `GOOGLE_ADMIN_REFRESH_TOKEN` 은 `min(20)`, `GOOGLE_ADMIN_EMAIL` 은 `.email()`. 셋 다 optional 이라 미등록이면 자동으로 legacy 경로. 등록 후 **재배포**해야 새 env 가 런타임에 반영됨.

### 3단계 — 배포 후 검증

1. `/canvas` 리크루팅 위젯에 **chris 아닌 다른 사용자**로 로그인.
2. 폼 발행 → Google 연동 UI 가 사라지고 (admin-proxy 활성) 바로 발행되는지 확인.
3. chris.lee Drive 에 새 폼 파일이 생겼는지 확인.
4. Supabase 에서 `select owner_email from recruiting_forms order by created_at desc limit 1;` → `chris.lee@meteor-research.com` 인지 확인.
5. 또 다른 계정 사용자로 폼 발행 → 같은 chris Drive 에 함께 모이는지 확인.

### 4단계 — Sentry alarm 등록

refresh_token 이 revoke / 만료되면 (chris 비밀번호 변경, Google security check, External-Testing 7일 만료) admin-proxy 가 죽고 **모든 발행이 조용히 legacy 경로로 폴백**한다. 이를 잡기 위해 `getAdminAccessToken()` 은 refresh 실패 시 Sentry 로 alert 한다:

- 이벤트: `captureMessage('google_admin_refresh_token_failed', { level: 'error' })`
- tag `invalid_grant: true` → 토큰 revoke/만료 (가장 흔한 복구 필요 케이스)
- extra: `email`, `status`, `body` (Google 오류 JSON — PII 없음, `sentry-pii.ts` 가 토큰형 문자열 추가 스크럽)

**Sentry 대시보드에서 할 일**: `google_admin_refresh_token_failed` 메시지에 alert rule 등록 (예: 1건이라도 발생 시 즉시 알림).

**복구 runbook** (alert 뜨면): 위 **1단계**를 chris 계정으로 다시 수행 → 새 refresh_token → **2단계**의 `GOOGLE_ADMIN_REFRESH_TOKEN` env 갱신 → 재배포. `GOOGLE_ADMIN_EMAIL` 은 그대로.

## 부작용 / 개인정보

- 모든 리크루팅 응답 (전화번호·이름 포함) 이 운영자 단일 Google 계정(chris.lee) Drive 에 통합 저장된다.
- 이 사실은 개인정보처리방침에 고지됨 (`src/app/[locale]/privacy/page.tsx` §4 처리위탁 — Google 항목 + 리크루팅 응답 저장 위치 문단).
- 운영자 계정 비밀번호 변경 / Google security check 시 refresh_token 이 revoke 되어 위 Sentry alarm 이 뜬다 — 즉시 복구 필요.

## legacy 폼 처리 (현행 유지)

기존 per-user 소유 폼은 `owner_email` 컬럼으로 계속 라우팅되어 **보존**된다. 새 admin-proxy 폼으로의 일괄 migrate 는 위험이 커서 이 runbook 범위 밖 (별도 spec).

## 계정 선택 메모

이 runbook 은 spec default 인 **chris.lee@meteor-research.com** 개인 계정 기준. `recruit@meteor-research.com` 같은 Workspace 공용 계정을 쓰면 (a) chris 퇴사 시 인계 가능, (b) 개인정보가 개인 계정과 분리 — Workspace 가 있으면 그쪽이 더 안전. 계정 변경 시 위 절차의 `GOOGLE_ADMIN_EMAIL` 과 로그인 계정만 교체하면 된다.
