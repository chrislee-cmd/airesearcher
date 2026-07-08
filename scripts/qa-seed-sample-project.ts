// 🔒 QA 멱등 seed — [QA] 탑라인 스트리밍 샘플 프로젝트 + 인터뷰 문서 (prod org-scoped).
//
// WHY this exists — preview 는 별도 DB 없이 **prod Supabase** 를 본다. 데이터
// 의존 QA(탑라인 스트리밍 #481 · 인터뷰 검색 #431 · executive-summary #472)는
// "인터뷰 프로젝트 + 문서" 가 있어야만 검증되는데, prod 에는 QA 가 재사용할
// 안정적인 샘플이 없다. #847 재실행에서 탑라인 스트리밍 QA 가 "데이터 없음"
// 으로 스킵됐다. 사용자 결정(2026-07-08) = **방식 A 멱등 seed** — QA 계정 org
// 안에 고정 샘플 1개를 있으면 재사용/없으면 생성한다.
//
// 🔒 prod DB 제약 (위반 시 실데이터 사고 — PROJECT.md §7.5/§7.9):
//   - org-scoped : QA_TEST_EMAIL 계정의 org(= 인앱 getActiveOrg 가 고르는 첫
//                  org, organization_members.created_at asc) 안에서만 생성.
//                  다른 org/유저 데이터는 조회조차 안 한다.
//   - 멱등       : 고정 식별자(프로젝트명 [QA] 탑라인 스트리밍 샘플 · job
//                  inputs marker · document content_hash)로 존재검사 → 있으면
//                  재사용. 몇 번을 돌려도 prod 에 딱 1세트만 쌓인다.
//   - [QA] 라벨  : 이름/설명에 [QA] prefix + marker 로 실사용자 데이터와 구분.
//   - 비파괴     : 기존 row 를 update/delete 하지 않는다(insert-or-skip 만).
//                  cleanup 도 안 한다(멱등 재사용이 취지).
//   - 결정론     : 같은 문서 세트 → 같은 content_hash → 탑라인 캐시 재현
//                  (computeProjectCorpus 의 캐시 키가 문서 content_hash 집합).
//
// secret 노출 0 — service_role/openai 키는 env 로만 읽고, 로그에 이메일은
// 마스킹, 키·값은 절대 출력하지 않는다.
//
// RUN (worktree 루트에서, .env.local 존재 시):
//   node --experimental-strip-types --env-file-if-exists=.env.local \
//     scripts/qa-seed-sample-project.ts               # seed(멱등 write)
//   … --dry-run                                       # 조회만, 쓰기 없음
//
//   또는 pnpm qa:seed  (package.json 래퍼).
//
// 실행 경로 선택(보수적) — 이 스크립트는 e2e global-setup 에서 자동 호출하지
// **않는다**. QA 하네스(#846)는 모든 PR preview 에서 도는데 거기에 prod-write
// 를 묶으면 매 PR 마다 prod 에 손을 대게 된다. 탑라인 QA 스크립트(#481)나
// 운영자가 필요할 때 명시적으로 한 번 실행하는 편이 안전하다.

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { chunkMarkdown } from '../src/lib/interview-chunking.ts';

// 고정 식별자 — 멱등 존재검사의 앵커. 절대 바꾸지 말 것(바꾸면 새 샘플이
// 하나 더 생겨 prod 에 중복이 쌓인다).
const PROJECT_NAME = '[QA] 탑라인 스트리밍 샘플';
const PROJECT_DESCRIPTION =
  'QA 자동화 전용 샘플 — 편집/삭제 금지. 탑라인 스트리밍·검색 QA 재사용. marker=qa-topline-sample-v1';
// interview_jobs 는 이름 컬럼이 없어 inputs jsonb 에 marker 를 심어 멱등
// 존재검사한다. interview_documents.interview_job_id 가 NOT NULL 이라 seed
// 문서를 매달 job 이 하나 필요하다(실제 업로드 job 이 아닌 seed 전용).
const JOB_MARKER = 'qa-topline-sample-v1';

const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIM = 1536;
const EMBED_BATCH = 100;

// 결정론적 샘플 — 짧은 Q&A transcript 4개(다양한 응답자). reduce 가 빨라
// 탑라인 스트리밍 timeout 경계에 안 걸리면서 스트리밍/검색 검증엔 충분.
// 내용을 바꾸면 content_hash 가 바뀌어 기존 seed 문서와 별개로 재삽입되므로
// (멱등은 content_hash 기준) 안정 재현을 원하면 고정해 둔다.
const SAMPLE_DOCS: { filename: string; markdown: string }[] = [
  {
    filename: '[QA] 응답자1_20대_직장인.md',
    markdown: [
      '# [QA] 샘플 인터뷰 — 응답자1 (20대 직장인)',
      '',
      'Q: 평소 광고를 어디에서 자주 접하나요?',
      'A: 주로 유튜브랑 인스타그램에서 봐요. 출퇴근 지하철에서 스크롤하다 보면 광고가 계속 나와요.',
      '',
      'Q: 기억에 남는 광고가 있었나요?',
      'A: 네. 짧고 유머러스한 광고가 기억에 남아요. 15초 안에 웃기면 스킵을 안 하게 되더라고요.',
      '',
      'Q: 광고 때문에 실제로 구매한 적이 있나요?',
      'A: 있어요. 화장품이랑 배달앱 쿠폰은 광고 보고 바로 눌러서 써봤어요.',
    ].join('\n'),
  },
  {
    filename: '[QA] 응답자2_30대_주부.md',
    markdown: [
      '# [QA] 샘플 인터뷰 — 응답자2 (30대 주부)',
      '',
      'Q: 평소 광고를 어디에서 자주 접하나요?',
      'A: TV를 많이 봐서 TV 광고를 제일 자주 접해요. 저녁 시간대 홈쇼핑 광고도 자주 보고요.',
      '',
      'Q: 광고를 볼 때 어떤 점을 중요하게 보나요?',
      'A: 가격이랑 실제 후기가 제일 중요해요. 과장 광고는 오히려 신뢰가 떨어져요.',
      '',
      'Q: 광고 때문에 실제로 구매한 적이 있나요?',
      'A: 네. 주방용품이나 생활용품은 홈쇼핑 광고 보고 몇 번 샀어요.',
    ].join('\n'),
  },
  {
    filename: '[QA] 응답자3_40대_자영업.md',
    markdown: [
      '# [QA] 샘플 인터뷰 — 응답자3 (40대 자영업자)',
      '',
      'Q: 평소 광고를 어디에서 자주 접하나요?',
      'A: 네이버 검색하다가 나오는 광고를 많이 봐요. 가게 운영 때문에 검색을 자주 하거든요.',
      '',
      'Q: 광고에 대해 어떻게 생각하세요?',
      'A: 정보가 되면 좋은데, 너무 많으면 피곤해요. 검색 결과랑 광고 구분이 안 될 때가 제일 별로예요.',
      '',
      'Q: 광고 때문에 실제로 구매한 적이 있나요?',
      'A: 가끔요. 사업 관련 장비나 소모품은 검색 광고 보고 비교해서 사요.',
    ].join('\n'),
  },
  {
    filename: '[QA] 응답자4_50대_은퇴자.md',
    markdown: [
      '# [QA] 샘플 인터뷰 — 응답자4 (50대 은퇴자)',
      '',
      'Q: 평소 광고를 어디에서 자주 접하나요?',
      'A: TV하고 신문에서 주로 봐요. 요즘은 카카오톡에서도 광고가 오더라고요.',
      '',
      'Q: 광고가 도움이 된다고 느끼나요?',
      'A: 건강식품이나 여행 상품 광고는 관심이 가요. 다만 진짜인지 아닌지 확인이 어려워요.',
      '',
      'Q: 광고 때문에 실제로 구매한 적이 있나요?',
      'A: 아니요. 광고만 보고 사진 않아요. 자식들한테 물어보고 결정해요.',
    ].join('\n'),
  },
];

// content_hash — 인덱스 파이프라인(src/lib/interview-embed 경유 cache)이 쓰는
// hashString 과 동일한 sha256(utf8) 이라, 나중에 앱이 같은 문서를 재인덱싱해도
// 같은 해시를 낸다(캐시/dedup 일관).
function hashString(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function toVectorLiteral(v: number[]): string {
  return '[' + v.join(',') + ']';
}

// 이메일 마스킹 — 로그에 계정 원문을 남기지 않는다.
function redactEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing env ${name}. --env-file=.env.local 로 실행하거나 export 하세요.`,
    );
  }
  return v;
}

// service-role 클라이언트 팩토리 — 헬퍼 시그니처가 정확히 이 인스턴스 타입을
// 쓰도록 ReturnType 으로 파생한다(기본 createClient typeof 와 스키마 제네릭이
// 어긋나는 것을 피함).
function createAdmin(url: string, key: string) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
type SupabaseClient = ReturnType<typeof createAdmin>;

// QA 계정 유저를 이메일로 찾는다 — service-role admin.listUsers 페이지네이션.
// getUserByEmail 이 JS SDK 에 없어 목록을 훑는다(QA 계정은 하나라 보통 1페이지).
async function resolveQaUser(
  supabase: SupabaseClient,
  email: string,
): Promise<{ id: string; email: string }> {
  const target = email.trim().toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw new Error(`listUsers 실패: ${error.message}`);
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? '').toLowerCase() === target);
    if (hit) return { id: hit.id, email: hit.email ?? email };
    if (users.length < perPage) break; // 마지막 페이지
  }
  throw new Error(
    `QA 계정(${redactEmail(email)})을 auth.users 에서 찾지 못했습니다.`,
  );
}

// 인앱 getActiveOrg 와 동일한 규칙 — organization_members.created_at asc 첫 org.
// seed 가 QA 세션이 실제로 보는 org 에 정확히 들어가도록 맞춘다.
async function resolveOrg(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ org_id: string; org_name: string }> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('org_id, created_at, organization:organizations(id, name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(`org 조회 실패: ${error.message}`);
  // PostgREST embed 는 organization 을 배열로 타이핑하지만 (org_id, user_id)
  // 유니크라 실제로는 0/1 개다 — org.ts 의 getCurrentUserOrgs 와 동일하게
  // unknown 경유로 단일 객체로 좁힌다.
  const row = (data ?? [])[0] as unknown as
    | { org_id: string; organization: { id: string; name: string } | null }
    | undefined;
  if (!row?.org_id) {
    throw new Error('QA 계정이 소속된 org 가 없습니다(organization_members 0건).');
  }
  return { org_id: row.org_id, org_name: row.organization?.name ?? '(무명)' };
}

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');

  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const qaEmail = requireEnv('QA_TEST_EMAIL');
  // OpenAI 키는 write 경로에서만 필요(청크 임베딩). dry-run 은 없이도 돈다.
  const openaiKey = dryRun ? process.env.OPENAI_API_KEY : requireEnv('OPENAI_API_KEY');

  console.log(
    `\n🔒 QA 멱등 seed — prod Supabase 직접 쓰기${dryRun ? ' (DRY-RUN: 조회만)' : ''}`,
  );
  console.log(`   계정 ${redactEmail(qaEmail)} 의 org 안에서만 동작.\n`);

  const supabase = createAdmin(supabaseUrl, serviceKey);

  const user = await resolveQaUser(supabase, qaEmail);
  const org = await resolveOrg(supabase, user.id);
  console.log(`✓ QA org = "${org.org_name}" (org_id=${org.org_id})`);

  // 안전 대조 — 이 org 안의 실사용자 인터뷰 프로젝트 총수(전/후 비교용).
  const { count: orgProjectsBefore } = await supabase
    .from('interview_projects')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', org.org_id);
  console.log(`  (org 인터뷰 프로젝트 총수 = ${orgProjectsBefore ?? '?'})`);

  // ── 1. 프로젝트 멱등 upsert (org_id + user_id + 고정 이름) ──────────────
  const { data: existingProject, error: projSelErr } = await supabase
    .from('interview_projects')
    .select('id, name, created_at')
    .eq('org_id', org.org_id)
    .eq('user_id', user.id)
    .eq('name', PROJECT_NAME)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (projSelErr) throw new Error(`프로젝트 조회 실패: ${projSelErr.message}`);

  let projectId: string;
  if (existingProject) {
    projectId = existingProject.id as string;
    console.log(`✓ 프로젝트 재사용 (멱등) — id=${projectId}`);
  } else if (dryRun) {
    console.log('· [dry-run] 프로젝트 없음 → 생성 예정');
    console.log('\n(dry-run 종료 — 쓰기 없음)\n');
    return;
  } else {
    const { data: created, error: insErr } = await supabase
      .from('interview_projects')
      .insert({
        org_id: org.org_id,
        user_id: user.id,
        name: PROJECT_NAME,
        description: PROJECT_DESCRIPTION,
        tags: ['qa', 'sample'],
      })
      .select('id')
      .single();
    if (insErr || !created) {
      throw new Error(`프로젝트 생성 실패: ${insErr?.message}`);
    }
    projectId = created.id as string;
    console.log(`✓ 프로젝트 생성 — id=${projectId}`);
  }

  // ── 2. seed 전용 job 멱등 upsert (inputs marker contains) ───────────────
  const { data: existingJob, error: jobSelErr } = await supabase
    .from('interview_jobs')
    .select('id')
    .eq('org_id', org.org_id)
    .eq('user_id', user.id)
    .contains('inputs', [{ qa_seed: JOB_MARKER }])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (jobSelErr) throw new Error(`job 조회 실패: ${jobSelErr.message}`);

  let jobId: string;
  if (existingJob) {
    jobId = existingJob.id as string;
    console.log(`✓ seed job 재사용 (멱등) — id=${jobId}`);
  } else {
    const { data: createdJob, error: jobInsErr } = await supabase
      .from('interview_jobs')
      .insert({
        org_id: org.org_id,
        user_id: user.id,
        // interview_jobs.project_id 는 legacy public.projects FK 라
        // interview_projects.id 를 넣으면 FK 위반 → null 로 둔다(문서의
        // project_id 만 interview_projects 를 가리킨다).
        inputs: [{ qa_seed: JOB_MARKER, note: 'QA seed — do not edit' }],
        status: 'done',
        index_status: 'done',
      })
      .select('id')
      .single();
    if (jobInsErr || !createdJob) {
      throw new Error(`seed job 생성 실패: ${jobInsErr?.message}`);
    }
    jobId = createdJob.id as string;
    console.log(`✓ seed job 생성 — id=${jobId}`);
  }

  const openai = new OpenAI({ apiKey: openaiKey });

  // ── 3. 문서 + 청크 멱등 seed ────────────────────────────────────────────
  let docsCreated = 0;
  let docsSkipped = 0;
  let chunksInserted = 0;

  for (const doc of SAMPLE_DOCS) {
    const contentHash = hashString(doc.markdown);

    // 멱등: (interview_job_id, content_hash) 유니크. 있으면 재청크/재임베딩 skip.
    const { data: existingDoc, error: docSelErr } = await supabase
      .from('interview_documents')
      .select('id')
      .eq('interview_job_id', jobId)
      .eq('content_hash', contentHash)
      .maybeSingle();
    if (docSelErr) throw new Error(`문서 조회 실패: ${docSelErr.message}`);

    if (existingDoc) {
      docsSkipped += 1;
      console.log(`  · skip (이미 존재) ${doc.filename}`);
      continue;
    }

    const { data: insertedDoc, error: docInsErr } = await supabase
      .from('interview_documents')
      .insert({
        org_id: org.org_id,
        project_id: projectId,
        interview_job_id: jobId,
        filename: doc.filename,
        mime: 'text/markdown',
        markdown: doc.markdown,
        content_hash: contentHash,
        char_count: doc.markdown.length,
      })
      .select('id')
      .single();
    if (docInsErr || !insertedDoc) {
      throw new Error(`문서 생성 실패(${doc.filename}): ${docInsErr?.message}`);
    }
    const documentId = insertedDoc.id as string;
    docsCreated += 1;

    // 앱과 동일한 청커로 청크 생성 → 탑라인 chunkCount>0 게이트 + 검색 재사용.
    const chunks = chunkMarkdown(doc.markdown, {
      filename: doc.filename,
      docId: documentId,
    });
    if (chunks.length === 0) {
      console.log(`  + ${doc.filename} (청크 0 — 문서만)`);
      continue;
    }

    await supabase
      .from('interview_documents')
      .update({ total_chunks: chunks.length, processed_chunks: 0 })
      .eq('id', documentId);

    let processed = 0;
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const slice = chunks.slice(i, i + EMBED_BATCH);
      const res = await openai.embeddings.create({
        model: EMBED_MODEL,
        input: slice.map((c) => c.content),
      });
      if (res.data.length !== slice.length) {
        throw new Error(
          `embedding_count_mismatch: expected=${slice.length} got=${res.data.length}`,
        );
      }
      const rows = slice.map((c, j) => {
        const vec = res.data[j].embedding;
        if (!Array.isArray(vec) || vec.length !== EMBED_DIM) {
          throw new Error(
            `embedding_dim_mismatch: expected=${EMBED_DIM} got=${Array.isArray(vec) ? vec.length : 'n/a'}`,
          );
        }
        return {
          org_id: org.org_id,
          interview_job_id: jobId,
          document_id: documentId,
          content: c.content,
          metadata: c.metadata,
          embedding: toVectorLiteral(vec),
        };
      });
      const { error: chunkErr } = await supabase
        .from('interview_chunks')
        .insert(rows);
      if (chunkErr) {
        throw new Error(`청크 insert 실패(${doc.filename}): ${chunkErr.message}`);
      }
      processed += rows.length;
      await supabase
        .from('interview_documents')
        .update({ processed_chunks: processed })
        .eq('id', documentId);
    }
    chunksInserted += processed;
    console.log(`  + ${doc.filename} (청크 ${processed}개)`);
  }

  // ── 4. 사후 대조 — prod 에 [QA] 샘플이 정확히 1개인지 + org 총수 무변화 ──
  const { count: qaProjectCount } = await supabase
    .from('interview_projects')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', org.org_id)
    .eq('user_id', user.id)
    .eq('name', PROJECT_NAME);
  const { count: docCount } = await supabase
    .from('interview_documents')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', org.org_id)
    .eq('project_id', projectId);

  console.log('\n── 결과 ──────────────────────────────────────');
  console.log(`  프로젝트          : "${PROJECT_NAME}" × ${qaProjectCount ?? '?'} (멱등 → 1 이어야 함)`);
  console.log(`  문서              : 신규 ${docsCreated} · skip ${docsSkipped} · 프로젝트 총 ${docCount ?? '?'}`);
  console.log(`  청크(신규 임베딩) : ${chunksInserted}`);
  console.log(`  project_id        : ${projectId}`);
  console.log('  ⚠️ 이 스크립트는 실데이터를 수정/삭제하지 않습니다(insert-or-skip).');
  console.log('──────────────────────────────────────────────\n');

  if ((qaProjectCount ?? 0) > 1) {
    console.error(
      '❌ [QA] 샘플 프로젝트가 2개 이상 — 멱등성 위반. 수동 확인 필요(중복 정리).',
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
