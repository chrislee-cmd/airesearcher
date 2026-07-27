// 스케줄링 연락처(휴대폰) 정본화 — 업로드/시트/폼 유입 전화번호를 하나의 정본
// `10########`(10자리 = "10" + 8자리)으로 통일한다. (card 604, writer 진단 2026-07-27)
//
// 왜 필요한가: 저장은 원본 그대로였고(`010-1234-5678`·` 01012345678 `·`10-1234-5678`
// 혼재), dedup 은 숫자만 비교해 `010…`(11자리) vs `10…`(10자리, 앞0 빠짐)를 서로 다른
// 번호로 오인 → 중복 행. 게이트(phoneTail)는 둘을 같게 봐 충돌. 정본 하나로 통일하면
// dedup·게이트·중복 정리가 전부 견고해진다.
//
// 게이트 정합: participant-gate 의 phoneTail(뒷6자리)·phoneIdentityKey(전체 숫자)는
// 정본화 후에도 그대로 동작한다 — 정본은 뒷자리를 보존하고(1012345678 의 마지막 6자리
// = 345678 = 01012345678 의 마지막 6자리), 완전 일치 판정도 양쪽을 같은 정본으로 모으면
// 오히려 견고해진다. 게이트 로직은 이 PR 에서 건드리지 않는다(저장값만 정본으로).

/** 정본 규약: "10" + 8자리 = 10자리 한국 휴대폰(앞 0·국가코드·구분자 제거). */
const CANONICAL_MOBILE_RE = /^10\d{8}$/;

/**
 * flag 사유 코드(정본화 불가). i18n 라벨은 messages/*.json 의
 * `RecruitingScheduling.phoneReason_*` 키에 대응.
 *   - no_digits: 빈 값이 아닌데 숫자가 하나도 없음(예: "미제공", "-").
 *   - not_mobile: 010 계열이 아님(유선 02/031, 그 외).
 *   - wrong_length: 10 으로 시작하나 자릿수 미달/초과.
 */
export type PhoneFlagReason = 'no_digits' | 'not_mobile' | 'wrong_length';

/** 원본 전화번호 감사·복구용 보존 슬롯(정본으로 덮을 때 fields 에 1회 보관). */
export const PHONE_RAW_FIELD = '__phone_raw';

export type CanonicalizeResult = {
  /** 정본(성공 시 `10########`), 실패/빈 값이면 null. */
  canonical: string | null;
  /** 정본화 불가(사람이 원본에서 고쳐야 함). 빈 값은 flag 아님. */
  flagged: boolean;
  reason?: PhoneFlagReason;
};

/**
 * 원본 전화 문자열을 정본 `10########` 로 변환. 구분자(-, 공백, ., () 등)·앞 0·국가코드
 * (+82 / 0082)를 제거한 뒤 `/^10\d{8}$/` 를 만족하면 정본, 아니면 flag.
 *
 * 빈 값/ null 은 flag 가 아니다(전화가 없는 것뿐) — { canonical:null, flagged:false }.
 * 빈 값이 아닌데 숫자가 0개면 flag('no_digits').
 *
 * 매핑 예:
 *   `010-1234-5678`   → `1012345678`
 *   `01012345678`     → `1012345678`
 *   `10-1234-5678`    → `1012345678`
 *   `+82 10 1234 5678`→ `1012345678`
 *   `0082 10 …`       → `1012345678`
 *   `1012345678`      → `1012345678`(그대로)
 *   `02-123-4567`     → flag(not_mobile)
 */
export function canonicalizeMobile(raw: string | null | undefined): CanonicalizeResult {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { canonical: null, flagged: false };

  let digits = trimmed.replace(/\D/g, '');
  if (digits === '') return { canonical: null, flagged: true, reason: 'no_digits' };

  // 국제 접두어(00) → 국가코드(82) → 앞 0(010→10) 순으로 벗긴다. +82 010 처럼 둘이
  // 겹쳐도(82 제거 후 남은 0 을 다시 제거) 정본으로 수렴한다.
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('82')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);

  if (CANONICAL_MOBILE_RE.test(digits)) {
    return { canonical: digits, flagged: false };
  }
  const reason: PhoneFlagReason = digits.startsWith('10') ? 'wrong_length' : 'not_mobile';
  return { canonical: null, flagged: true, reason };
}

/**
 * 정본이 저장·발송을 위해 앞 0 을 붙인 발신형(`010########`)이 필요할 때 사용.
 * 정본이 `10…` 이면 `0` 을 prefix, 그 외(이미 0 으로 시작하거나 정본 아님)는 숫자만
 * 반환. SMS 발송부에서 solapi `to` 로 넘기기 직전 이 변환을 거친다.
 */
export function toDialablePhone(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (CANONICAL_MOBILE_RE.test(digits)) return `0${digits}`;
  return digits;
}

export type ApplyCanonicalResult = {
  /** 정본(성공) 또는 원본 그대로(flag/빈 값 — 뭉개지 않는다). */
  phone: string | null;
  /** 원본을 __phone_raw 에 보존한(또는 기존 유지) fields. */
  fields: Record<string, string>;
  flagged: boolean;
  reason?: PhoneFlagReason;
};

/**
 * 한 후보의 phone + fields 에 정본화를 적용. 성공 시 phone 을 정본으로 바꾸고 원본을
 * fields.__phone_raw 에 1회 보존한다(이미 보존됐거나 원본===정본이면 스킵). 정본 불가
 * (flag)면 phone 을 원본 그대로 두고 flagged 만 표시 — 복구 불가하게 덮어쓰지 않는다.
 * 유입(parse)·저장 chokepoint(upsert) 양쪽에서 재적용해도 idempotent.
 */
export function applyCanonicalPhone(
  rawPhone: string | null | undefined,
  fields: Record<string, string>,
): ApplyCanonicalResult {
  const { canonical, flagged, reason } = canonicalizeMobile(rawPhone);
  if (!flagged && canonical) {
    const original = (rawPhone ?? '').trim();
    if (original && original !== canonical && !(PHONE_RAW_FIELD in fields)) {
      return {
        phone: canonical,
        fields: { ...fields, [PHONE_RAW_FIELD]: original },
        flagged: false,
      };
    }
    return { phone: canonical, fields, flagged: false };
  }
  // flag 또는 빈 값 — 원본 유지(빈 값은 flagged:false 라 목록에 안 오른다).
  return { phone: rawPhone ?? null, fields, flagged, reason };
}
