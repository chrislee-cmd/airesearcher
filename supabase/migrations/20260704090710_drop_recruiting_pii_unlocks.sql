-- Drop recruiting_pii_unlocks — the fullview PII credit-unlock feature is
-- retired. The user-side flow no longer reveals contact info at all: PII
-- columns are permanently masked and recruiters instead file a free invitation
-- request (recruiting_invitations) that a super admin fulfils out-of-band.
--
-- The unlock route + its billing/audit table have no remaining readers or
-- writers (both /api/recruiting/fullview/unlock[s] routes are deleted in the
-- same PR), so the table is dead weight. `if exists` keeps this idempotent and
-- safe on environments where the create migration was never applied.
drop table if exists public.recruiting_pii_unlocks;
