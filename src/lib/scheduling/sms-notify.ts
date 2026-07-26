// recruiting-scheduling 공지/메시지 발송 시 대상 후보의 전화번호로 문자 알림을
// 산출·발송하는 서버 전용 후처리. 메시지 insert 성공 후에만 호출되며, 실패해도
// 상위 흐름(메시지 저장)을 절대 막지 않는다(하드 제약 — best-effort).
//
// 대상 산출(사용자 결정 2026-07-26 — 오발송 차단):
//   문자 알림 자격 = (그 메시지의 수신자 집합) ∩ (합류 확인 joined_at) ∩ (phone).
//   * broadcast 전체 → 프로젝트 확정자 ∩ 합류 ∩ phone
//   * broadcast 그룹 → 해당 batch 확정자 ∩ 합류 ∩ phone
//   * private        → 해당 후보 1명 ∩ 합류 ∩ phone (status 무관 — 조율 대화 알림
//                      은 확정 전에도 정상 플로우)
//   합류(joined_at)는 "링크를 받아 합류(상호 동의)가 확인된 사람"의 SSOT — 참가자
//   폰게이트 최초 통과 시 /verify 가 찍는다. status='confirmed' 는 관리자 coarse
//   플래그일 뿐 합류와 다르므로 문자 자격 조건이 아니다(broadcast 수신자 집합에서만
//   확정 여부가 쓰인다).
//   컬럼 미적용 환경 대비: joined_at select 실패(42703) 시 문자를 보내지 않고
//   skip + 로그 — 과다 발송보다 미발송이 안전(이 티켓의 목적 = 오발송 0).
//
// 문자 템플릿(알림형): 본문은 미포함(개인정보·SMS 단가). 안내 + 마스터링크만.
// 수신자 대면 카피이므로 i18n(messages/*.json 의 SchedulingSms 네임스페이스)에 두고
// 서버에서 로드한다 — 후보의 locale 은 알 수 없어 ko 기본(참여자 locale 을 알게
// 되면 그 값으로 확장 가능).
//
// 전화번호가 클라로 새는 경로 0 — 이 산출/발송은 전 과정 서버(service-role).

import { getTranslations } from 'next-intl/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSms, type SolapiMessage } from '@/lib/sms/solapi';

// SMS 카피 로드 locale. 수신자(후보)의 locale 은 미상 → ko 기본.
const SMS_LOCALE = 'ko';

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

// 문자 알림 자격 필터. 합류 확인(joined_at)이 없으면 제외 — 이게 오발송 차단의
// 핵심 게이트. broadcast 는 수신자 집합이 확정자라 status='confirmed' 도 요구한다
// (requireConfirmed). private 은 status 무관. phone 은 8자리 미만이면 잡음으로 제외.
type CandidateRow = {
  phone: string | null;
  joined_at?: string | null;
  status?: string | null;
};
function eligiblePhones(
  rows: CandidateRow[],
  opts: { requireConfirmed: boolean },
): string[] {
  const phones: string[] = [];
  for (const r of rows) {
    // 합류 미확인 → 문자 자격 없음(status 와 무관하게 최우선 게이트).
    if (!r.joined_at) continue;
    if (opts.requireConfirmed && r.status !== 'confirmed') continue;
    const digits = (r.phone ?? '').replace(/\D/g, '');
    if (digits.length >= 8) phones.push(digits);
  }
  return phones;
}

// 알림형 본문 + LMS 제목을 i18n(SchedulingSms)에서 로드해 구성. announcement 여부로
// 공지/메시지 문구가 갈린다.
async function buildSmsCopy(
  project: ResolvedProject,
  announcement: boolean,
  origin: string,
): Promise<{ text: string; subject: string }> {
  const t = await getTranslations({
    locale: SMS_LOCALE,
    namespace: 'SchedulingSms',
  });
  const title = project.title || t('defaultTitle');
  const url = `${origin}/schedule/${project.share_token}`;
  const text = t(announcement ? 'bodyAnnouncement' : 'bodyMessage', {
    title,
    url,
  });
  const subject = t('subject', { title });
  return { text, subject };
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
      const { data: cand, error } = await admin
        .from('sched_candidates')
        .select('phone, batch_id, joined_at')
        .eq('id', params.candidateId)
        .maybeSingle();
      // joined_at 컬럼 미적용(42703) 등 select 실패 → 보내지 않는다(오발송 방지).
      if (error) {
        console.warn('[sched-sms] joined_at select failed (private) — skipping send', error.code);
        return { status: 'skipped', reason: 'no_recipients', targetCount: 0 };
      }
      if (!cand) return { status: 'skipped', reason: 'no_recipients', targetCount: 0 };
      const batchId = cand.batch_id as string | null;
      project = batchId ? await projectOfBatch(admin, batchId) : null;
      // private 은 status 무관 — 합류·phone 만 요구.
      phones = eligiblePhones([cand as CandidateRow], { requireConfirmed: false });
    } else if (params.messageBatchId) {
      // 그룹 broadcast — 해당 batch 의 확정자 ∩ 합류 ∩ phone.
      project = await projectOfBatch(admin, params.messageBatchId);
      const { data: rows, error } = await admin
        .from('sched_candidates')
        .select('phone, joined_at, status')
        .eq('batch_id', params.messageBatchId)
        .limit(10000);
      if (error) {
        console.warn('[sched-sms] joined_at select failed (group) — skipping send', error.code);
        return { status: 'skipped', reason: 'no_recipients', targetCount: 0 };
      }
      phones = eligiblePhones((rows ?? []) as CandidateRow[], { requireConfirmed: true });
    } else {
      // 전체 broadcast — 컨텍스트 batch 로 프로젝트 특정 후 전 확정자 ∩ 합류 ∩ phone.
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
          const { data: rows, error } = await admin
            .from('sched_candidates')
            .select('phone, joined_at, status')
            .in('batch_id', batchIds)
            .limit(10000);
          if (error) {
            console.warn('[sched-sms] joined_at select failed (all) — skipping send', error.code);
            return { status: 'skipped', reason: 'no_recipients', targetCount: 0 };
          }
          phones = eligiblePhones((rows ?? []) as CandidateRow[], { requireConfirmed: true });
        }
      }
    }

    if (!project) return { status: 'skipped', reason: 'no_project', targetCount: 0 };
    if (phones.length === 0) return { status: 'skipped', reason: 'no_recipients', targetCount: 0 };
    if (phones.length > SMS_SEND_CAP) {
      return { status: 'skipped', reason: 'limit_exceeded', targetCount: phones.length };
    }

    const { text, subject } = await buildSmsCopy(
      project,
      params.announcementWord,
      params.origin,
    );
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
