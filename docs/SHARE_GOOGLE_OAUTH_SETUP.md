# Share 설정 — Google OAuth (Drive / Docs / Sheets)

> 전사록 / 인터뷰 / 데스크 산출물의 **워드 (Google Docs) · 시트 (Google Sheets) 공유** 기능이 사용하는 OAuth client SSOT. `docs/AUTH_SETUP.md` (Supabase 로그인용 client) 와 **별 client** 다 — 혼동 시 redirect_uri_mismatch 400 발생.

## 1. 문제 — redirect_uri_mismatch 400

`/api/share/google/start` (`src/app/api/share/google/start/route.ts`) 는 `env.GOOGLE_REDIRECT_URI` 값을 redirect_uri 로 Google OAuth 에 전달. Google 은 OAuth client 의 **Authorized redirect URIs** 와 정확히 일치하는지 검사 후, 불일치면:

```
Access blocked: This app's request is invalid
400 오류: redirect_uri_mismatch
```

전형 시나리오:
- prod 도메인 신규 발급 (`researchmochi.com`) 후 `GOOGLE_REDIRECT_URI` env 만 갱신, Google Cloud Console 의 OAuth client 업데이트 누락
- preview 환경에서 share 클릭 시 preview URL 이 redirect URIs 에 없음
- 옛 도메인 → 새 도메인 마이그 시 옛 URI 보존 안 함

## 2. Auth client 와 Share client 의 분리

| | Auth (`docs/AUTH_SETUP.md`) | Share (이 문서) |
|---|---|---|
| Google Cloud Console client 이름 | `Research-mochi Supabase Auth` (v2) | `ai researcher web` |
| 호출 경로 | `supabase.auth.signInWithOAuth({ provider: 'google' })` | `/api/share/google/start` → `src/lib/google-oauth.ts` `buildShareAuthorizeUrl` |
| Authorized redirect URIs | `https://qdhfbvppeilzyihzlusj.supabase.co/auth/v1/callback` | `https://<prod-domain>/api/share/google/callback` (+ preview / localhost) |
| Env 키 | Supabase Dashboard → Auth Provider 의 Client ID/Secret | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` |
| 사용 scope | `openid`, `email`, `profile` | `forms.body`, `forms.responses.readonly`, `drive.file`, `documents`, `spreadsheets`, `userinfo.email` |

> 두 client 가 한 console project 안에 공존. 같은 client 로 묶는 것도 기술적으로 가능하지만 scope / 권한 경계가 흐려져서 권장 X.

## 3. Google Cloud Console 설정 — Share client

`https://console.cloud.google.com/` → `My First Project` → **APIs & Services → Credentials → `ai researcher web` (OAuth 2.0 Client ID)**.

### 3.1 Authorized redirect URIs

env / 도메인마다 한 줄씩 등록. **trailing slash · http vs https · 호스트 오타 모두 정확히 일치** 해야 함.

| 환경 | URI |
|---|---|
| Production | `https://researchmochi.com/api/share/google/callback` |
| Preview (Vercel) | `https://airesearcher-woad.vercel.app/api/share/google/callback` |
| Local dev | `http://localhost:3000/api/share/google/callback` |

> 옛 도메인 (`airesearcher.vercel.app` 등) 이 살아 있다면 호환 위해 보존. 사용자 발급된 refresh token 은 client 단위라 redirect URI 만 추가하면 됨.

**Save** 후 **5~10분 propagation** 대기 (Google OAuth 캐시).

### 3.2 Authorized JavaScript origins

호스트만 (path 없이) 등록:

| 환경 | Origin |
|---|---|
| Production | `https://researchmochi.com` |
| Preview | `https://airesearcher-woad.vercel.app` |
| Local | `http://localhost:3000` |

### 3.3 Scope / consent screen

Scope 변경은 코드 (`src/lib/google-oauth.ts` 의 `SHARE_SCOPES`) 에서만. consent screen 은 OAuth consent screen 탭에서 `Research-mochi` 와 동일 설정 사용 (project 단위 공유).

## 4. Vercel env 등록

Vercel Dashboard → ai-researcher project → **Settings → Environment Variables**.

| Key | Production | Preview | Development |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | (sensitive) | 동일 | 동일 |
| `GOOGLE_CLIENT_SECRET` | (sensitive) | 동일 | 동일 |
| `GOOGLE_REDIRECT_URI` | `https://researchmochi.com/api/share/google/callback` | `https://airesearcher-woad.vercel.app/api/share/google/callback` | `http://localhost:3000/api/share/google/callback` |

`GOOGLE_REDIRECT_URI` 는 **환경별로 다른 값** — preview 에서 prod URI 쓰면 redirect URIs 에는 등록돼 있어도 cookie domain 등 부수 효과로 깨질 수 있음.

`vercel env pull` 로 로컬 동기화. `.env.local` 직접 편집 시 위 3개 key 모두 채워야 share flow 가 동작 (`getGoogleEnv()` 가 missing_google_oauth_env throw).

## 5. 검증 체크포인트

### 필수 (redirect URI 추가 직후)
- [ ] **시크릿 창** 에서 `https://researchmochi.com` 로그인 → 전사록 위젯 → 산출물 → 공유 → 워드 (Google Docs)
- [ ] consent screen 정상 표시 (404 redirect_uri_mismatch 없음)
- [ ] consent 동의 → 새 탭에 Google Doc 열림 + 산출물 본문 채워짐
- [ ] 같은 흐름으로 시트 (Sheets) 공유 — 동일 client 라 별도 검증 한 번
- [ ] preview URL 에서도 share 정상 (Vercel branch URL 진입)
- [ ] `http://localhost:3000` 개발자 환경 share 정상

### 회귀 점검
- [ ] Notion 공유 — `GOOGLE_REDIRECT_URI` 무관, 영향 0 이어야 함
- [ ] 로그인 (`docs/AUTH_SETUP.md` client) — 별 client 라 영향 0 이어야 함
- [ ] 기존 사용자 (이전에 connect 한 사용자) 의 refresh token 으로 백그라운드 공유 (예: status polling 후 자동 생성) 정상

## 6. Rollback

redirect URI 추가는 idempotent — 잘못 추가했다면 해당 URI 행 삭제 후 Save 만으로 원복. 기존 사용자 token 무효화 X.

만약 client 자체를 교체하고 싶다면 (예: 새 `Research-mochi Drive` branded client 신규):
1. 새 client 생성 + redirect URIs 등록
2. Vercel env `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 값 교체
3. **기존 사용자 refresh token 전부 무효화** → 사용자가 다음 share 시 재 consent 필요. UX 영향 큼 — branded consent screen 효과와 trade-off.

## 7. 운영 체크리스트

- prod 도메인 변경 시: **Vercel env `GOOGLE_REDIRECT_URI` 갱신 + Google Cloud Console redirect URIs 양쪽 동시 갱신** (한쪽만 하면 즉시 400)
- 새 preview alias 자동 생성 도메인 (Vercel branch URL) 은 wildcard 등록 불가 → 자주 쓰는 stable branch URL 만 등록
- `ai researcher web` client 의 ⚠️ Branding 경고 해결은 후속 작업 (별 spec) — 즉시 fix 와 무관
