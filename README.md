# AI Researcher

SaaS for marketing & UX research — quote, transcript, interview, and full report generation, with team workspaces, role-based sharing, credits, i18n (KO default + EN), and Mixpanel analytics.

## Stack

- **Next.js 16** (App Router, Turbopack) + TypeScript + Tailwind v4
- **Supabase** — Google OAuth + Postgres with RLS
- **next-intl** — i18n routing (`/ko/*`, `/en/*`)
- **mixpanel-browser** — product analytics
- **Vercel** — deployment

## Setup

### 1. Install

```bash
pnpm install
cp .env.local.example .env.local
```

### 2. Supabase

1. Create a project at https://supabase.com
2. Fill `.env.local` with Project URL + anon key + service role key
3. **Auth → Providers → Google**: enable, paste Google OAuth client ID/secret. Add `https://YOUR-PROJECT.supabase.co/auth/v1/callback` to Google authorized redirect URIs.
4. **Auth → URL Configuration**: add `http://localhost:3000` and your prod URL to "Site URL" + "Additional Redirect URLs".
5. Apply the schema:

```bash
pnpm exec supabase link --project-ref YOUR-REF
pnpm exec supabase db push
```

(Or paste `supabase/migrations/0001_init.sql` into the SQL editor.)

### 3. Run

```bash
pnpm dev
```

Visit http://localhost:3000 — redirects to `/ko` (default Korean) → `/ko/login`.

## Features

| Feature | Cost |
|---|---|
| Quote Generator | 1 credit |
| Transcript Generator | 2 credits |
| Interview Result Generator | 3 credits |
| Full Report Generator | 5 credits |

Each new user gets a personal organization seeded with **10 credits** on first sign-in (handled by the `handle_new_user` trigger in the migration).

## Organizations & roles

- `owner` — created on signup, full access
- `admin` — manage members + content
- `member` — generate, see org content
- `viewer` — read-only

Sharing: each generation has `visibility` (`private` | `org` | `shared`); `shared` items grant access via the `generation_shares` table.

## Mixpanel

Token wired via `NEXT_PUBLIC_MIXPANEL_TOKEN`. Track events with:

```ts
import { track } from '@/components/mixpanel-provider';
track('event_name', { ...props });
```

## Deploying to Vercel

```bash
pnpm exec vercel link
pnpm exec vercel env pull .env.local
pnpm exec vercel deploy --prod
```

Set the same env vars in the Vercel dashboard. Update `NEXT_PUBLIC_SITE_URL` to the production URL and add it to Supabase **Auth → URL Configuration**.

## Project structure

```
src/
  app/
    [locale]/
      layout.tsx          # i18n + Mixpanel provider
      page.tsx            # / → /login or /dashboard
      login/page.tsx
      (app)/
        layout.tsx        # sidebar + topbar (auth required)
        dashboard/
        quotes/ transcripts/ interviews/ reports/
        members/ settings/
    api/
      generate/route.ts
      members/{invite,role,remove}/route.ts
    auth/callback/route.ts
  components/             # sidebar, topbar, language-switcher, etc.
  i18n/                   # next-intl config
  lib/
    supabase/             # client / server / middleware helpers
    credits.ts org.ts features.ts
  proxy.ts                # Next.js 16 proxy (formerly middleware)
messages/{ko,en}.json
supabase/migrations/0001_init.sql
```
