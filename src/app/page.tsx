import { redirect } from 'next/navigation';
import { routing } from '@/i18n/routing';

// Safety-net only — proxy.ts → next-intl middleware normally redirects
// `/` to the negotiated locale (`/ko` or `/en`) before this page runs.
// Track the routing SSOT instead of hardcoding so the fallback can't
// drift if `defaultLocale` changes.
export default function RootPage() {
  redirect(`/${routing.defaultLocale}`);
}
