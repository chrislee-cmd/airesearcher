// Spike-only `@/env` shim (card 584). desk-sources/* 는 키를 읽으려고 `@/env`
// 의 `env` 만 참조한다(env.NAVER_CLIENT_ID 등). 프로덕션 env.ts 는
// @t3-oss/env-nextjs + zod 로 전체 스키마를 검증하는데, 이는 Next 런타임을
// 전제해 ops 스크립트에서 곧잘 throw 한다. 이 shim 은 그 접근자만 process.env
// 로 대체한다 — 키의 실제 출처는 동일한 .env.local(--env-file 로 주입)이고,
// 크롤/fetch/tier 로직은 전부 실제 프로덕션 모듈 그대로다(복제 아님).
export const env = process.env as Record<string, string | undefined>;
