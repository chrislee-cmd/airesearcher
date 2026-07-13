// Interview failure-alert cron — founder push for silent generation failures.
//
// The interview generation pipeline (upload → convert → index → topline) can
// fail without anyone noticing: a convert-step failure leaves the job at
// index_status='pending' with no documents, and an index/topline failure sets
// index_status='error' — but in both cases the only signal is a screen someone
// has to be looking at. This cron closes the "fail → deliver" gap in the
// debugging loop by emailing a founder digest.
//
// Why a periodic digest instead of inline per-catch emails: inlining a send in
// every pipeline catch risks a storm (one bad upload = dozens of files = dozens
// of emails) and cannot see the *silent* 'pending' class at all. A central
// sweep dedups, batches (1 run = 1 email), and catches stuck-pending jobs that
// no catch block ever fired for.
//
// Detection SSOT (all gated on alerted_at IS NULL so a failure is reported once):
//   - index_status='error'            — index/topline catch recorded a failure.
//   - stuck-pending                   — index_status='pending' AND not touched
//                                       for STUCK_PENDING_MINUTES AND docs=0
//                                       (convert step died before indexing).
//   - interview_toplines.status='error' — topline generation failed.
//
// Auth: standard Vercel cron pattern — Authorization: Bearer <CRON_SECRET>,
// fail-closed (mirrors cron/retention, topline/resume). Vercel cron issues GET.
// Runs service_role (createAdminClient) — no user session, must bypass RLS.

import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { env } from '@/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { superAdminEmails } from '@/lib/admin/superadmin';

export const runtime = 'nodejs';
export const maxDuration = 60;

// A 'pending' job that hasn't been touched (updated_at, bumped by the touch
// trigger on every UPDATE) in this long, with zero indexed documents, is a
// stuck convert-step failure — not an in-flight run. Generous window so an
// abandoned upload (orphan) that the user simply walked away from is flagged as
// "고착 추정", not mistaken for an active job.
const STUCK_PENDING_MINUTES = 15;
// Cap rows shown in one email; the overflow count is summarised as "+N건" and
// those rows keep alerted_at NULL so a later run drains them (still 1 run =
// 1 email — anti-storm).
const MAX_ROWS_IN_EMAIL = 30;
// Upper bound on rows pulled per sweep so a backlog can't blow the query.
const QUERY_LIMIT = 200;

function authorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${env.CRON_SECRET}`;
}

// Comma-separated env override, falling back to the super-admin allowlist SSOT.
function alertRecipients(): string[] {
  const raw = env.INTERVIEW_ALERT_EMAILS;
  if (raw) {
    const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) return list;
  }
  return superAdminEmails();
}

// Founder-facing links: prefer the canonical domain over the deployment hash so
// the email points at prod, not a preview URL.
function baseUrl(): string {
  if (env.NEXT_PUBLIC_SITE_URL) return env.NEXT_PUBLIC_SITE_URL;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

type FailedJob = {
  id: string;
  org_id: string;
  project_id: string | null;
  user_id: string;
  index_status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  reason: 'error' | 'stuck-pending';
};

type FailedTopline = {
  id: string;
  org_id: string;
  project_id: string;
  error_message: string | null;
  updated_at: string;
};

type Admin = ReturnType<typeof createAdminClient>;

const JOB_COLS = 'id, org_id, project_id, user_id, index_status, error_message, created_at, updated_at';

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const stuckCutoff = new Date(Date.now() - STUCK_PENDING_MINUTES * 60_000).toISOString();

  // 1) index_status='error' — always report (once).
  const { data: errorRows, error: errQueryErr } = await admin
    .from('interview_jobs')
    .select(JOB_COLS)
    .eq('index_status', 'error')
    .is('alerted_at', null)
    .order('created_at', { ascending: true })
    .limit(QUERY_LIMIT);
  if (errQueryErr) {
    return NextResponse.json({ error: errQueryErr.message }, { status: 500 });
  }

  // 2) stuck-pending candidates — filtered to docs=0 below.
  const { data: pendingRows, error: pendQueryErr } = await admin
    .from('interview_jobs')
    .select(JOB_COLS)
    .eq('index_status', 'pending')
    .lt('updated_at', stuckCutoff)
    .is('alerted_at', null)
    .order('updated_at', { ascending: true })
    .limit(QUERY_LIMIT);
  if (pendQueryErr) {
    return NextResponse.json({ error: pendQueryErr.message }, { status: 500 });
  }

  // 3) errored toplines (own alerted_at watermark).
  const { data: toplineRows, error: tlQueryErr } = await admin
    .from('interview_toplines')
    .select('id, org_id, project_id, error_message, updated_at')
    .eq('status', 'error')
    .is('alerted_at', null)
    .order('updated_at', { ascending: true })
    .limit(QUERY_LIMIT);
  if (tlQueryErr) {
    return NextResponse.json({ error: tlQueryErr.message }, { status: 500 });
  }

  const errorJobs = (errorRows ?? []) as Omit<FailedJob, 'reason'>[];
  const pendingCandidates = (pendingRows ?? []) as Omit<FailedJob, 'reason'>[];
  const toplines = (toplineRows ?? []) as FailedTopline[];

  // Document counts for every candidate job in one query. interview_documents
  // holds one row per uploaded file (chunks live in interview_chunks), so this
  // stays small. Used to (a) keep only docs=0 stuck-pending jobs and (b) show
  // "docs N" in the digest.
  const candidateIds = [...errorJobs, ...pendingCandidates].map((j) => j.id);
  const docCount = await countDocuments(admin, candidateIds);

  const stuckPending = pendingCandidates.filter((j) => (docCount.get(j.id) ?? 0) === 0);

  const failedJobs: FailedJob[] = [
    ...errorJobs.map((j) => ({ ...j, reason: 'error' as const })),
    ...stuckPending.map((j) => ({ ...j, reason: 'stuck-pending' as const })),
  ];

  const totalJobs = failedJobs.length;
  const totalToplines = toplines.length;

  // 3) No failures → no email (无实패 무발송).
  if (totalJobs === 0 && totalToplines === 0) {
    return NextResponse.json({ ok: true, sent: false, jobs: 0, toplines: 0 });
  }

  const displayedJobs = failedJobs.slice(0, MAX_ROWS_IN_EMAIL);
  const displayedToplines = toplines.slice(0, MAX_ROWS_IN_EMAIL);

  // Enrichment — best-effort, two-step (.in()) lookups instead of PostgREST
  // embeds (embeds silently return 0 rows across indirect FKs — PROJECT.md §7.10).
  const projectNames = await fetchNames(
    admin,
    'projects',
    displayedJobs.map((j) => j.project_id).filter((id): id is string => !!id),
  );
  const interviewProjectNames = await fetchNames(
    admin,
    'interview_projects',
    displayedToplines.map((t) => t.project_id),
  );
  const userEmails = await fetchUserEmails(
    admin,
    displayedJobs.map((j) => j.user_id),
  );

  const site = baseUrl();
  const interviewsUrl = `${site}/ko/interviews`;

  const jobLines = displayedJobs.map((j) => {
    const project = j.project_id ? projectNames.get(j.project_id) ?? j.project_id : '(프로젝트 없음)';
    const user = userEmails.get(j.user_id) ?? j.user_id;
    const cause =
      j.reason === 'error'
        ? j.error_message?.trim() || '(error_message 없음)'
        : 'stuck-pending (convert 단계 추정)';
    return [
      `• [${j.reason}] ${project} — ${user}`,
      `    job_id: ${j.id}`,
      `    index_status: ${j.index_status} · docs: ${docCount.get(j.id) ?? 0}`,
      `    원인: ${cause}`,
      `    created_at: ${j.created_at} · updated_at: ${j.updated_at}`,
    ].join('\n');
  });

  const toplineLines = displayedToplines.map((t) => {
    const project = interviewProjectNames.get(t.project_id) ?? t.project_id;
    const cause = t.error_message?.trim() || '(error_message 없음)';
    return [
      `• [topline-error] ${project}`,
      `    topline_id: ${t.id} · project_id: ${t.project_id}`,
      `    원인: ${cause}`,
      `    updated_at: ${t.updated_at}`,
    ].join('\n');
  });

  const overflowJobs = totalJobs - displayedJobs.length;
  const overflowToplines = totalToplines - displayedToplines.length;

  const bodyParts: string[] = [
    `인터뷰 생성 파이프라인에서 실패/고착 ${totalJobs + totalToplines}건이 감지되었습니다.`,
    '',
    `요약: job 실패 ${totalJobs}건 (index error / stuck-pending) · topline error ${totalToplines}건`,
    `대시보드: ${interviewsUrl}`,
  ];
  if (jobLines.length) {
    bodyParts.push('', '── Job 실패 ──', jobLines.join('\n'));
    if (overflowJobs > 0) bodyParts.push(`  … 외 +${overflowJobs}건 (다음 스윕에서 알림)`);
  }
  if (toplineLines.length) {
    bodyParts.push('', '── Topline 실패 ──', toplineLines.join('\n'));
    if (overflowToplines > 0) bodyParts.push(`  … 외 +${overflowToplines}건 (다음 스윕에서 알림)`);
  }
  bodyParts.push('', `sweep_at: ${new Date().toISOString()}`);
  const text = bodyParts.join('\n');

  const subject = `🔴 인터뷰 생성 실패 ${totalJobs + totalToplines}건 (prod)`;

  // Reuse the existing nodemailer + Gmail SMTP send path (moderator/inquiry,
  // billing/quote). The app never sends via the Resend SDK directly — Resend is
  // wired as Supabase's custom SMTP for auth mail (PROJECT.md §8.1); reusing the
  // in-app Gmail transport avoids adding a new dependency + secret.
  const gmailUser = env.GMAIL_USER;
  const gmailPass = env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) {
    console.error('[interview-failure-alert] GMAIL_USER or GMAIL_APP_PASSWORD missing');
    return NextResponse.json({ error: 'email_not_configured' }, { status: 500 });
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailPass.replace(/\s+/g, '') },
  });

  try {
    await transporter.sendMail({
      from: `Research-Canvas <${gmailUser}>`,
      to: alertRecipients(),
      subject,
      text,
    });
  } catch (err) {
    // Don't stamp alerted_at — leave the rows unmarked so the next run retries.
    console.error('[interview-failure-alert] gmail smtp error', err);
    return NextResponse.json({ error: 'send_failed' }, { status: 502 });
  }

  // Dedup: stamp only the rows we actually reported. Overflow rows stay NULL so
  // a later sweep picks them up.
  const stampedAt = new Date().toISOString();
  const displayedJobIds = displayedJobs.map((j) => j.id);
  const displayedToplineIds = displayedToplines.map((t) => t.id);
  if (displayedJobIds.length) {
    await admin.from('interview_jobs').update({ alerted_at: stampedAt }).in('id', displayedJobIds);
  }
  if (displayedToplineIds.length) {
    await admin
      .from('interview_toplines')
      .update({ alerted_at: stampedAt })
      .in('id', displayedToplineIds);
  }

  return NextResponse.json({
    ok: true,
    sent: true,
    jobs: totalJobs,
    toplines: totalToplines,
    reported_jobs: displayedJobIds.length,
    reported_toplines: displayedToplineIds.length,
  });
}

// Count interview_documents rows per interview_job_id, batched via .in().
async function countDocuments(admin: Admin, jobIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!jobIds.length) return counts;
  const { data } = await admin
    .from('interview_documents')
    .select('interview_job_id')
    .in('interview_job_id', jobIds);
  for (const row of (data ?? []) as { interview_job_id: string }[]) {
    counts.set(row.interview_job_id, (counts.get(row.interview_job_id) ?? 0) + 1);
  }
  return counts;
}

// Best-effort id → name for projects / interview_projects (both have `name`).
async function fetchNames(
  admin: Admin,
  table: 'projects' | 'interview_projects',
  ids: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (!unique.length) return names;
  const { data } = await admin.from(table).select('id, name').in('id', unique);
  for (const row of (data ?? []) as { id: string; name: string }[]) {
    names.set(row.id, row.name);
  }
  return names;
}

// Best-effort user_id → email via profiles.
async function fetchUserEmails(admin: Admin, userIds: string[]): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  const unique = [...new Set(userIds)];
  if (!unique.length) return emails;
  const { data } = await admin.from('profiles').select('id, email').in('id', unique);
  for (const row of (data ?? []) as { id: string; email: string | null }[]) {
    if (row.email) emails.set(row.id, row.email);
  }
  return emails;
}
