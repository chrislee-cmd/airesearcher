// Source-based PII masking for scheduling candidates (journey bridge, GAP-AUDIT
// §1-8 / BUILD-SPEC §5.2 D1-A).
//
// A candidate's `source` decides whether its contact fields are the user's own
// data or response-derived PII the user is not entitled to see in the clear:
//   'bridge'          → auto-ingested from a Google Forms response. phone/email
//                       are respondent PII → MASKED for non-super-admins; the
//                       super-admin (who sends the invites via admin-proxy) sees
//                       the real values.
//   'upload'/'sheet'  → the user uploaded this data themselves → plaintext.
//   null (legacy)     → treated as plaintext (predates the source column).
//
// Masking is SERVER-ENFORCED: the raw phone/email of a bridged row is replaced
// before the payload leaves the server, so the client never receives it. Name is
// intentionally NOT masked (only 연락처 = phone/email per spec).

export const CONTACT_MASK = '●●●●';

export type MaskableCandidate = {
  source?: string | null;
  phone?: string | null;
  email?: string | null;
  [key: string]: unknown;
};

// True when this row's contact must be masked for the given viewer.
export function shouldMaskContact(
  source: string | null | undefined,
  superadmin: boolean,
): boolean {
  return source === 'bridge' && !superadmin;
}

// Return a copy of the candidate with phone/email masked when the source +
// viewer require it. A super-admin always gets plaintext. Only non-empty values
// are masked (an empty contact stays empty so the UI can tell "no contact" from
// "hidden").
export function maskCandidateContact<T extends MaskableCandidate>(
  candidate: T,
  superadmin: boolean,
): T {
  if (!shouldMaskContact(candidate.source, superadmin)) return candidate;
  return {
    ...candidate,
    phone: candidate.phone ? CONTACT_MASK : candidate.phone,
    email: candidate.email ? CONTACT_MASK : candidate.email,
  };
}

export function maskCandidatesBySource<T extends MaskableCandidate>(
  candidates: T[],
  superadmin: boolean,
): T[] {
  if (superadmin) return candidates;
  return candidates.map((c) => maskCandidateContact(c, superadmin));
}
