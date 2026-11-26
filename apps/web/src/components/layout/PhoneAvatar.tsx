'use client';

import Link from 'next/link';
import { useSession } from '@/lib/state/session';
import { useT } from '@/lib/i18n/client';
import { paths } from '@/lib/urls';

/** Phones: your initial in a purple circle, left of the logo once you are signed in (tap = your account). */
export function PhoneAvatar() {
  const t = useT();
  const { status, user } = useSession();
  if (status !== 'user' || !user) return null;
  const initial = [...user.fullName.trim()][0]?.toUpperCase() ?? '?';
  return (
    <Link href={paths.account(t.locale)} aria-label={t('nav.myAccount')} data-testid="phone-avatar" className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-600 text-[15px] font-bold text-white md:hidden">
      {initial}
    </Link>
  );
}
