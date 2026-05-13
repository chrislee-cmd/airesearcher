// Supabase auth errors arrive as user-facing English strings (the JS client
// has no stable error codes). We map the ones users actually hit in our
// signup/signin flow to Auth.* i18n keys; everything else falls through to
// a generic key so we never leak raw English to KR users.

type Mode = 'signIn' | 'signUp' | 'reset';

export function mapAuthError(message: string, mode: Mode): string {
  const m = message.toLowerCase();

  if (m.includes('invalid login credentials')) return 'errorInvalidCredentials';
  if (m.includes('email not confirmed')) return 'errorEmailNotConfirmed';
  if (m.includes('user already registered') || m.includes('already exists')) {
    return 'errorUserAlreadyRegistered';
  }
  // "Prevent use of leaked passwords" (Supabase → Auth → Providers → Email)
  // matches against HaveIBeenPwned. The response uses code `weak_password`
  // with `reasons: ["pwned"]` and a message that doesn't include the literal
  // substring "weak password", so we match the distinctive parts instead.
  if (
    m.includes('known to be weak') ||
    m.includes('pwned') ||
    m.includes('leaked')
  ) {
    return 'errorPwnedPassword';
  }
  if (
    m.includes('password should be at least') ||
    m.includes('weak password') ||
    m.includes('password is too short')
  ) {
    return 'errorWeakPassword';
  }
  if (m.includes('rate limit') || m.includes('too many requests')) {
    return 'errorRateLimited';
  }
  if (
    m.includes('new password should be different') ||
    m.includes('same password')
  ) {
    return 'errorSamePassword';
  }
  if (m.includes('invalid email')) return 'errorInvalidEmail';
  if (m.includes('expired') || m.includes('invalid token')) {
    return 'errorLinkExpired';
  }

  // Mode-specific fallback so the message is still grounded in the user's
  // intent ("로그인에 실패했습니다" vs. "회원가입에 실패했습니다").
  if (mode === 'signIn') return 'errorInvalidCredentials';
  if (mode === 'reset') return 'errorGeneric';
  return 'errorGeneric';
}
