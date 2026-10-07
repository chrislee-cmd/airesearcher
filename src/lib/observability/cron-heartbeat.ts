// cron 생존 신호 — 성공 실행 기록/조회 (위젯 체인 관측 PR-E).
//
// ── 왜 성공을 기록하나 ──
// 기존 관측(error_events)은 전부 실패 기반이다. 그래서 cron 이 **아예 안 도는**
// 경우엔 아무 신호도 안 난다 — vercel.json 등록 누락, 배포 사고, 플랫폼이 호출을
// 멈춤. 그 상태에서 대시보드는 "에러 0건" 이라 정상처럼 보인다. 정상 가동과
// 완전 사망이 똑같은 무음이다. 이 모듈은 반대 방향 신호를 만든다: cron 이 한
// 바퀴 정상 완주할 때마다 `cron_heartbeats` 의 자기 행을 now() 로 갱신하고,
// 어드민이 "마지막 실행이 너무 오래됐다"를 판정한다.
//
// ── 절대 규칙: throw 금지 ──
// log-error.ts 와 같은 계약이다. 관측이 기능을 깨면 안 된다. 테이블 미적용·RPC
// 실패·직렬화 오류 — 어떤 이유로도 예외를 밖으로 던지지 않는다. 즉 cron 라우트가
// 이 함수 때문에 500 이 되는 경우는 없다(기록 실패는 console.warn 폴백).

import { createAdminClient } from '@/lib/supabase/admin';

type Admin = ReturnType<typeof createAdminClient>;

// cron job 레지스트리 — 생존 판정에 필요한 **기대 주기**가 여기 있다.
//
// 스케줄 자체의 SSOT 는 `vercel.json` 의 crons 배열이다. 여기 intervalMs 는 그
// 스케줄을 코드가 판정에 쓸 수 있게 옮겨 적은 사본이므로, vercel.json 의 주기를
// 바꾸면 이 값도 같이 바꿔야 한다(안 바꾸면 판정선만 어긋나고 기록은 정상 —
// fail-safe 방향).
//
// 사람이 읽는 라벨은 여기 두지 않는다 — 표시 카피는 어드민 컴포넌트가 소유한다
// (lib 에 UI 카피를 심지 않는 레포 관례 + 한글 ratchet 표면 최소화).
export const CRON_JOBS = {
  // vercel.json: { path: '/api/cron/chain-sweep', schedule: '0 * * * *' } = 매시 정각.
  'chain-sweep': { intervalMs: 60 * 60 * 1000 },
} as const;

export type CronJobKey = keyof typeof CRON_JOBS;

// STALE 판정 배수 — 기대 주기의 이 배수를 넘기면 경고. 2배인 이유: 1배면 실행
// 지연(플랫폼 큐잉·콜드스타트)만으로도 상시 경고가 떠서 신호가 무의미해지고,
// 3배 이상이면 하루 1회 cron 의 사망을 이틀 넘게 모른다. 2배 = 연속 1회 결손을
// 확실히 잡는 최소선.
export const STALE_MULTIPLIER = 2;

const TABLE = 'cron_heartbeats';

/**
 * cron 한 바퀴의 **성공 완주**를 기록. 실패 경로에서는 호출하지 않는다 — 그래야
 * ran_at 이 "마지막으로 정상 완주한 시각" 을 뜻하고, 실패 루프가 생존으로
 * 위장하지 못한다.
 *
 * 절대 throw 하지 않는다(위 계약). 호출측은 await 해도 되고 버려도 된다.
 */
export async function recordCronHeartbeat(
  job: CronJobKey,
  stats: { scanned: number; acted: number },
  admin?: Admin,
): Promise<void> {
  try {
    const db = admin ?? createAdminClient();
    // upsert — job 이 PK 라 두 번째 실행부터는 같은 행을 덮는다(행 수가 job 수로
    // 고정, retention 불필요). created_at 은 default 라 갱신 시 건드리지 않는다.
    const { error } = await db.from(TABLE).upsert(
      {
        job,
        ran_at: new Date().toISOString(),
        scanned: stats.scanned,
        acted: stats.acted,
      },
      { onConflict: 'job' },
    );
    if (error) {
      console.warn(`[cron-heartbeat] ${job} record failed`, error.message);
    }
  } catch (e) {
    console.warn(
      `[cron-heartbeat] ${job} record threw`,
      e instanceof Error ? e.message : e,
    );
  }
}

export type CronHeartbeat = {
  job: CronJobKey;
  intervalMs: number;
  /** 마지막 성공 완주 시각. 기록이 한 번도 없으면 null = **한 번도 안 돌았다**. */
  ranAt: string | null;
  /** 마지막 성공으로부터 경과 ms. ranAt 이 null 이면 null. */
  ageMs: number | null;
  scanned: number | null;
  acted: number | null;
  /** 이 값을 넘긴 ageMs = STALE (= intervalMs × STALE_MULTIPLIER). */
  staleAfterMs: number;
  /**
   * 경고 판정. ranAt 이 null(미실행)이거나 ageMs > staleAfterMs 면 true.
   * `unavailable` 일 때는 판정하지 않는다(false) — 아래 주석 참고.
   */
  stale: boolean;
  /**
   * 조회 자체가 실패함(이 env 에 마이그 미적용 등). 이때 "기록 없음" 을 미실행
   * 으로 읽으면 **거짓 경보**가 된다 — 테이블이 없는 것과 cron 이 죽은 것은
   * 다른 사건이다. 그래서 이 플래그를 세우고 stale 판정은 보류한다.
   */
  unavailable: boolean;
};

/** 등록된 cron job 전부의 생존 신호를 조회. 쿼리 실패는 unavailable 로 degrade. */
export async function getCronHeartbeats(admin?: Admin): Promise<CronHeartbeat[]> {
  const jobs = Object.keys(CRON_JOBS) as CronJobKey[];
  const base = (job: CronJobKey, unavailable: boolean): CronHeartbeat => ({
    job,
    intervalMs: CRON_JOBS[job].intervalMs,
    ranAt: null,
    ageMs: null,
    scanned: null,
    acted: null,
    staleAfterMs: CRON_JOBS[job].intervalMs * STALE_MULTIPLIER,
    stale: unavailable ? false : true,
    unavailable,
  });

  let rows: { job: string; ran_at: string; scanned: number; acted: number }[];
  try {
    const db = admin ?? createAdminClient();
    const { data, error } = await db
      .from(TABLE)
      .select('job, ran_at, scanned, acted')
      .in('job', jobs);
    if (error) {
      console.warn('[cron-heartbeat] query failed', error.message);
      return jobs.map((j) => base(j, true));
    }
    rows = (data ?? []) as typeof rows;
  } catch (e) {
    console.warn(
      '[cron-heartbeat] query threw',
      e instanceof Error ? e.message : e,
    );
    return jobs.map((j) => base(j, true));
  }

  const byJob = new Map(rows.map((r) => [r.job, r]));
  const now = Date.now();
  return jobs.map((job) => {
    const row = byJob.get(job);
    // 행이 없으면 **한 번도 성공 완주한 적이 없다** = 가장 강한 신호(미등록/
    // 전원 실패). stale:true 로 둬 어드민이 경고를 띄운다.
    if (!row) return base(job, false);
    const ageMs = Math.max(0, now - new Date(row.ran_at).getTime());
    const staleAfterMs = CRON_JOBS[job].intervalMs * STALE_MULTIPLIER;
    return {
      job,
      intervalMs: CRON_JOBS[job].intervalMs,
      ranAt: row.ran_at,
      ageMs,
      scanned: row.scanned,
      acted: row.acted,
      staleAfterMs,
      stale: ageMs > staleAfterMs,
      unavailable: false,
    };
  });
}
