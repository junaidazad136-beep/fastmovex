import type { ReactNode } from 'react';

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-ink-200 bg-white px-6 py-14 text-center">
      {icon && <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-brand-50 text-brand-600">{icon}</div>}
      <h2 className="text-lg font-bold text-ink-900">{title}</h2>
      {text && <p className="mt-1.5 max-w-sm text-sm text-ink-500">{text}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
