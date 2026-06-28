# Auth 설정 — Google OAuth (custom client)

> Google 로그인 consent screen 에 `qdhfbvppeilzyihzlusj.supabase.co` (Supabase project URL) 가 노출되던 회귀를 막기 위한 설정 SSOT. 코드 변경 없이 **Google Cloud Console + Supabase Dashboard** 에서만 적용.

## 1. 문제

`supabase.auth.signInWithOAuth({ provider: 'google' })` (현재 코드: `src/components/google-signin-button.tsx:59-60`) 는 Supabase Auth 의 default Google OAuth client 를 사용합니다. 그러면 Google consent screen 에:

```
to continue to qdhfbvppeilzyihzlusj.supabase.co
You're signing back in to qdhfbvppeilzyihzlusj.supabase.co
```

이렇게 Supabase project URL 이 그대로 노출됨 → 사용자 신뢰성 ↓, "Research-mochi" 브랜드 인지 0.

**해결**: 자체 OAuth client 를 Google 에 등록 → Supabase Auth Google provider 에 client_id / secret 등록. consent screen 이 `Research-mochi` (앱 이름) + 로고 + privacy/terms 링크를 보여줍니다.

## 2. Drive / Docs 통합 OAuth client 와 분리

- `src/lib/google-oauth.ts` 의 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` env 는 **Drive / Docs 통합 (share 기능) 전용**.
- 이번 작업의 **Auth client 는 별개**. 같은 client 로 통합도 기술적으로 가능하지만 OAuth flow / scope 가 다르고 권한 경계가 흐려져서 권장 X.

## 3. Google Cloud Console 설정

### 3.1 OAuth consent screen
`https://console.cloud.google.com/` → 프로젝트 선택 (없으면 `Research Mochi` 신규) → **APIs & Services → OAuth consent screen**.

| 항목 | 값 |
|---|---|
| App name | `Research-mochi` |
| User support email | `chris.lee@meteor-research.com` (또는 `support@meteor-research.com`) |
| App logo | Research-mochi 로고 240×240 권장 (선택) |
| Application home page | `https://<prod-domain>` |
| Privacy policy | `https://<prod-domain>/privacy` |
| Terms of service | `https://<prod-domain>/terms` |
| Authorized domains | `<prod-domain>`, `supabase.co` |
| Developer contact | `chris.lee@meteor-research.com` |

**Scopes**: `openid`, `email`, `profile` (기본).

**Publishing status**:
- `Testing` — 100 users 한정, test users 명시 추가
- `In production` — 모든 사용자 허용. Google verification 없으면 "Unverified app" 경고만 (100명 미만이면 무방)

### 3.2 OAuth Client ID
**APIs & Services → Credentials → Create credentials → OAuth client ID**.

| 항목 | 값 |
|---|---|
| Application type | Web application |
| Name | `Research-mochi Supabase Auth` |
| Authorized JavaScript origins | `https://<prod-domain>`, `https://qdhfbvppeilzyihzlusj.supabase.co`, `http://localhost:3000` |
| Authorized redirect URIs | `https://qdhfbvppeilzyihzlusj.supabase.co/auth/v1/callback` |

`Create` → **Client ID + Client Secret** 발급. 둘 다 다음 단계용으로 안전한 곳에 보관 (1Password 등).

## 4. Supabase Dashboard 설정

Supabase Dashboard → **Authentication → Providers → Google**.

1. `Enable Google` → ON
2. `Client ID` → §3.2 의 Client ID 붙여넣기
3. `Client Secret` → §3.2 의 Client Secret 붙여넣기
4. `Save`

`Callback URL (for OAuth)` 필드에 `https://qdhfbvppeilzyihzlusj.supabase.co/auth/v1/callback` 가 자동 표시 — §3.2 의 redirect URI 와 정확히 일치해야 함.

## 5. 검증 체크포인트

### 필수 (production 적용 직후)
- [ ] **시크릿 창** 에서 `https://<prod-domain>` 접속
- [ ] `Sign in with Google` 클릭 → consent screen 에 **`to continue to Research-mochi`** 표시 (project URL 안 보임)
- [ ] (로고 등록 시) consent screen 에 로고 표시
- [ ] `Privacy policy` / `Terms of service` 링크 정상 — 클릭 시 `<prod-domain>/privacy`, `/terms` 도착
- [ ] 로그인 완료 → `/auth/callback` → `/[locale]/canvas` redirect → session 정상
- [ ] Application → Cookies 에 `sb-*` 쿠키 존재 (PROJECT.md §7.12 회귀 점검)

### 선택 / 회귀 점검
- [ ] **기존 사용자** (Supabase default client 로 가입) 로그인 시도 — 한 번 더 consent 받지만 (Google 이 "처음 보는 앱" 인식) 일회성. session 정상.
- [ ] 신규 가입 사용자 → `auth.users` row 정상 + `consents` 테이블에 `privacy/terms/marketing` 기록 (consent cookie path)
- [ ] **Drive / Docs share 기능** (`/lib/google-oauth.ts`) 정상 — Auth client 와 별 OAuth flow 라 영향 0 이어야 함

## 6. Rollback

문제 발생 시:
1. Supabase Dashboard → Authentication → Providers → Google → **`Client ID` / `Client Secret` 필드 비우고 Save**
2. → Supabase 가 자동으로 default client 로 fallback (consent screen 에 다시 project URL 노출되지만 로그인은 정상 동작)
3. Google Cloud Console 쪽 OAuth client 는 유지해도 무해 (Supabase 가 안 쓰면 끝)

## 7. 미해결 / 사용자 결정 필요

이 작업을 마무리하려면 다음 항목에 대한 사용자 결정이 필요:

| 항목 | 옵션 | 메모 |
|---|---|---|
| `<prod-domain>` | `research-mochi.com` 등 확정 | 현재 Vercel 자동 도메인 가능 |
| 로고 | 업로드 / 미업로드 | 미업로드 시 default Google 아이콘 |
| Support email | `chris.lee@meteor-research.com` / `support@…` | consent screen 표시용 |
| Publish status | Testing (100 users) / Production | 100명+ 예상 시 verification 필수 |
| Google verification | 진행 / 보류 | 1~2주 소요, 100명+ 시 필수 |

## 8. 관련 코드 / 문서

- `src/components/google-signin-button.tsx` — Google sign-in trigger (변경 없음)
- `src/lib/google-oauth.ts` — Drive / Docs 통합 (별 OAuth client, 변경 없음)
- `src/app/auth/callback/route.ts` — OAuth redirect 처리 + consent cookie 적용
- PROJECT.md §7.12 — `signOut({ scope: 'others' })` 회귀 (관련 함정)
