// recruiting-scheduling 공지/메시지 발송 시 대상 후보의 전화번호로 문자 알림을
// 산출·발송하는 서버 전용 후처리. 메시지 insert 성공 후에만 호출되며, 실패해도
// 상위 흐름(메시지 저장)을 절대 막지 않는다(하드 제약 — best-effort).
//
// 대상 산출(사용자 결정 2026-07-25):
//   * broadcast 전체(messageBatchId null) → 프로젝트 전 후보
//   * broadcast 그룹(messageBatchId set)  → 해당 batch 후보
//   * private                             → 해당 후보 1명
//   — 모두 phone 보유자만(무전화 skip), 숫자만 정규화.
//
// 문자 템플릿(알림형): 본문은 미포함(개인정보·SMS 단가). 안내 + 마스터링크만.
//   [{프로젝트 제목}] 새 {공지|메시지}가 도착했습니다. 확인: {origin}/schedule/{share_token}
//
// 전화번호가 클라로 새는 경로 0 — 이 산출/발송은 전 과정 서버(service-role).

import { createAdminClient } from '@/lib/supabase/admin';
import { sendSms, type SolapiMessage } from '@/lib/sms/solapi';

type Admin = ReturnType<typeof createAdminClient>;

// 1회 발송 상한 — 실수/오남용 비용 가드. 초과 시 발송을 스킵하되 메시지 저장은
// 유지한다(insert 성공 무관 원칙). 필요 시 상향은 이 상수만.
export const SMS_SEND_CAP = 500;

export type SmsNotifyParams = {
  scope: 'broadcast' | 'private';
  // SMS 문구의 {공지|메시지} 결정 — broadcast 공지만 '공지', 그 외 '메시지'.
  announcementWord: boolean;
  // private 대상 후보 1명.
  candidateId: string | null;
  // 메시지 row 의 batch_id(그룹 broadcast=set, 전체=null). 메시지 semantics 와 동일.
  messageBatchId: string | null;
  // SMS 프로젝트 해석용 컨텍스트 batch(타일 batchId). 전체 reach(messageBatchId
  // null)에서 프로젝트를 특정하는 유일한 단서 — 메시지 row 에는 반영 안 됨.
  contextBatchId: string | null;
  // 링크 origin(요청 헤더 기반, 서버 계산).
  origin: string;
};

export type SmsNotifyOutcome =
  | { status: 'sent'; smsSent: number; smsFailed: number; targetCount: number }
  | {
      status: 'skipped';
      reason: 'no_project' | 'no_recipients' | 'limit_exceeded';
      targetCount: number;
    };

type ResolvedProject = { id: string; share_token: string; title: string };

async function projectOfBatch(
  admin: Admin,
  batchId: string,
): Promise<ResolvedProject | null> {
  const { data: batch } = await admin
    .from('sched_batches')
    .select('project_id')
    .eq('id', batchId)
    .maybeSingle();
  const projectId = (batch?.project_id as string | null) ?? null;
  if (!projectId) return null;
  const { data: project } = await admin
    .from('sched_projects')
    .select('id, share_token, title')
    .eq('id', projectId)
    .maybeSingle();
  const shareToken = project?.share_token as string | undefined;
  if (!project || !shareToken) return null;
  return {
    id: project.id as string,
    share_token: shareToken,
    title: (project.title as string | null) ?? '',
  };
}

// 후보 목록에서 전화번호 보유자만 숫자 정규화. 8자리 미만은 잡음으로 보고 제외.
function toPhoneList(rows: { phone: string | null }[]): string[] {
  const phones: string[] = [];
  for (const r of rows) {
    const digits = (r.phone ?? '').replace(/\D/g, '');
    if (digits.length >= 8) phones.push(digits);
  }
  return phones;
}

function buildText(project: ResolvedProject, announcement: boolean, origin: string): string {
  const kind = announcement ? '공지' : '메시지';
  const title = project.title || '일정';
  return `[${title}] 새 ${kind}가 도착했습니다.\n확인: ${origin}/schedule/${project.share_token}`;
}

/**
 * 대상 산출 → 상한 검사 → 발송. 예외를 던지지 않고 outcome 으로만 결과를 돌려준다.
 * 호출부는 반드시 isSolapiConfigured() 게이트를 통과한 뒤 이 함수를 호출한다.
 */
export async function notifyBySms(
  admin: Admin,
  params: SmsNotifyParams,
): Promise<SmsNotifyOutcome> {
  try {
    let project: ResolvedProject | null = null;
    let phones: string[] = [];

    if (params.scope === 'private') {
      if (!params.candidateId) return { status: 'skipped', reason: 'no_recipients', targetCount: 0 };
      const { data: cand } = await admin
        .from('sched_candidates')
        .select('phone, batch_id')
        .eq('id', params.candidateId)
        .maybeSingle();
      if (!cand) return { status: 'skipped', reason: 'no_recipients', targetCount: 0 };
      const batchId = cand.batch_id as string | null;
      project = batchId ? await projectOfBatch(admin, batchId) : null;
      phones = toPhoneList([{ phone: (cand.phone as string | null) ?? null }]);
    } else if (params.messageBatchId) {
      // 그룹 broadcast — 해당 batch 후보.
      project = await projectOfBatch(admin, params.messageBatchId);
      const { data: rows } = await admin
        .from('sched_candidates')
        .select('phone')
        .eq('batch_id', params.messageBatchId)
        .limit(10000);
      phones = toPhoneList((rows ?? []) as { phone: string | null }[]);
    } else {
      // 전체 broadcast — 컨텍스트 batch 로 프로젝트 특정 후 전 후보.
      if (!params.contextBatchId) return { status: 'skipped', reason: 'no_project', targetCount: 0 };
      project = await projectOfBatch(admin, params.contextBatchId);
      if (project) {
        const { data: batches } = await admin
          .from('sched_batches')
          .select('id')
          .eq('project_id', project.id)
          .limit(2000);
        const batchIds = (batches ?? []).map((b) => b.id as string);
        if (batchIds.length > 0) {
          const { data: rows } = await admin
            .from('sched_candidates')
            .select('phone')
            .in('batch_id', batchIds)
            .limit(10000);
          phones = toPhoneList((rows ?? []) as { phone: string | null }[]);
        }
      }
    }

    if (!project) return { status: 'skipped', reason: 'no_project', targetCount: 0 };
    if (phones.length === 0) return { status: 'skipped', reason: 'no_recipients', targetCount: 0 };
    if (phones.length > SMS_SEND_CAP) {
      return { status: 'skipped', reason: 'limit_exceeded', targetCount: phones.length };
    }

    const text = buildText(project, params.announcementWord, params.origin);
    const subject = `[${project.title || '일정'}] 알림`;
    const messages: SolapiMessage[] = phones.map((to) => ({ to, text }));
    const { smsSent, smsFailed } = await sendSms(messages, subject);
    console.log(
      `[sched-sms] project=${project.id} scope=${params.scope} targets=${phones.length} sent=${smsSent} failed=${smsFailed}`,
    );
    return { status: 'sent', smsSent, smsFailed, targetCount: phones.length };
  } catch (err) {
    // best-effort — 어떤 실패도 상위(메시지 저장)를 막지 않는다.
    console.error('[sched-sms] notify threw', err);
    return { status: 'skipped', reason: 'no_recipients', targetCount: 0 };
  }
}
