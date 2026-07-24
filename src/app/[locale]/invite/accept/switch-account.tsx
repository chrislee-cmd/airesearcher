'use client';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

// Sign the current (wrong) account out and bounce back to the invite-accept
// flow so the invitee can retry with the address the invite was sent to.
export function SwitchAccountButton({
  acceptPath,
  label,
}: {
  acceptPath: string;
  label: string;
}) {
  async function switchAccount() {
    const supabase = createClient();
    await supabase.auth.signOut().catch(() => {});
    // Full reload to the login gate with the accept page as the return target —
    // getCurrentUser is server-cached, so a soft navigation could keep the
    // stale (wrong) user and loop straight back to this notice.
    window.location.href = `/login?next=${encodeURIComponent(acceptPath)}`;
  }

  return (
    <Button variant="primary" size="md" onClick={switchAccount}>
      {label}
    </Button>
  );
}
