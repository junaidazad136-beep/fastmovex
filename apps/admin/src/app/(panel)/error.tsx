'use client';

import { ErrorState } from '@/components/ui';

/** A screen that crashed shows this inside the panel; the menu keeps working. */
export default function PanelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState error={error} onRetry={reset} />;
}
