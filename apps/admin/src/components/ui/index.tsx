'use client';

import clsx from 'clsx';
import { AlertCircle, ArrowLeft, ChevronLeft, ChevronRight, Inbox, Loader2, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { errorMessage } from '@/lib/api/errors';
import { humanize } from '@/lib/format';

// ---------------------------------------------------------------- layout

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6">
      {back ? (
        <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800">
          <ArrowLeft className="size-4" aria-hidden /> {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-ink-900 sm:text-2xl">{title}</h1>
          {description ? <div className="mt-1 text-sm text-ink-500">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Card({ title, description, actions, children, className, bodyClassName }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={clsx('card', className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-ink-100 px-4 py-3 sm:px-5">
          <div>
            {title ? <h2 className="text-sm font-semibold text-ink-900">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs text-ink-500">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={clsx('p-4 sm:p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('animate-spin', className ?? 'size-4')} aria-hidden />;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-500" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center" role="alert">
      <AlertCircle className="size-8 text-danger-600" aria-hidden />
      <p className="text-sm text-ink-700">{errorMessage(error)}</p>
      {onRetry ? <button type="button" className="btn-secondary btn-sm" onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
      <div className="mb-1 text-ink-300">{icon ?? <Inbox className="size-9" aria-hidden />}</div>
      <p className="text-sm font-semibold text-ink-800">{title}</p>
      {description ? <p className="max-w-sm text-sm text-ink-500">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- tables

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('overflow-x-auto', className)}>
      <table className="w-full min-w-[640px] border-separate border-spacing-0">{children}</table>
    </div>
  );
}

export function SkeletonRows({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="td"><div className="skeleton h-4 w-full max-w-[160px]" /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function Pagination({ page, pageCount, total, onPage }: { page: number; pageCount: number; total: number; onPage: (p: number) => void }) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-ink-600">
      <span>{total.toLocaleString('en')} {total === 1 ? 'result' : 'results'}</span>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <span className="tabular">Page {page} of {Math.max(pageCount, 1)}</span>
        <button type="button" className="btn-secondary btn-sm" disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center p-3">
      <button type="button" className="btn-secondary btn-sm" onClick={onClick} disabled={loading}>
        {loading ? <Spinner /> : null} Load more
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- badges

const TONES = {
  gray: 'bg-ink-100 text-ink-700',
  green: 'bg-success-50 text-success-700',
  amber: 'bg-warning-50 text-warning-600',
  red: 'bg-danger-50 text-danger-600',
  blue: 'bg-sky-50 text-sky-700',
  brand: 'bg-brand-50 text-brand-700',
  violet: 'bg-violet-50 text-violet-700',
} as const;
export type Tone = keyof typeof TONES;

const STATUS_TONES: Record<string, Tone> = {
  ACTIVE: 'green', APPROVED: 'green', DELIVERED: 'green', PAID: 'green', CAPTURED: 'green', COMPLETED: 'green', RESOLVED: 'green', SUCCEEDED: 'green', REFUNDED: 'violet', PUBLISHED: 'green',
  DRAFT: 'gray', ARCHIVED: 'gray', CLOSED: 'gray', CANCELLED: 'gray', EXPIRED: 'gray', INACTIVE: 'gray', VOIDED: 'gray',
  PENDING: 'amber', PENDING_REVIEW: 'amber', PENDING_PAYMENT: 'amber', REQUESTED: 'amber', OPEN: 'amber', PENDING_CUSTOMER: 'blue', PENDING_SELLER: 'blue', AUTHORIZED: 'blue', SUBMITTED: 'amber', LOW: 'amber',
  PLACED: 'blue', CONFIRMED: 'blue', PROCESSING: 'blue', PREPARING: 'blue', READY_FOR_PICKUP: 'blue', SHIPPED: 'blue', OUT_FOR_DELIVERY: 'blue', PARTIALLY_SHIPPED: 'blue', PARTIALLY_DELIVERED: 'blue', RECEIVED: 'blue', IN_TRANSIT: 'blue', PARTIALLY_REFUNDED: 'violet',
  RETURN_REQUESTED: 'amber', UNDER_REVIEW: 'amber', PROCESSING_REFUND: 'violet',
  REJECTED: 'red', FAILED: 'red', SUSPENDED: 'red', OUT: 'red', DISPUTED: 'red', URGENT: 'red', HIGH: 'amber', NORMAL: 'gray', RETURNED: 'violet',
};

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', TONES[tone], className)}>{children}</span>;
}

export function StatusBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  if (!status) return <span className="text-ink-400">—</span>;
  return <Badge tone={STATUS_TONES[status] ?? 'gray'}>{label ?? humanize(status)}</Badge>;
}

// ---------------------------------------------------------------- forms

export function Field({ label, hint, error, children, htmlFor, className, required }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; className?: string; required?: boolean }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-danger-600"> *</span> : null}
      </label>
      {children}
      {error ? <p className="field-error">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

/** Text input with its label wired up. */
export function TextField({ label, hint, error, className, required, ...props }: { label: ReactNode; hint?: ReactNode; error?: string | null; required?: boolean } & ComponentProps<'input'>) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={props.id ?? id} className={className} required={required}>
      <input id={props.id ?? id} className="input" aria-invalid={error ? true : undefined} required={required} {...props} />
    </Field>
  );
}

export function TextArea({ label, hint, error, className, ...props }: { label: ReactNode; hint?: ReactNode; error?: string | null } & ComponentProps<'textarea'>) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={props.id ?? id} className={className}>
      <textarea id={props.id ?? id} className="input min-h-24" aria-invalid={error ? true : undefined} {...props} />
    </Field>
  );
}

export function SelectField({ label, hint, error, className, children, ...props }: { label: ReactNode; hint?: ReactNode; error?: string | null } & ComponentProps<'select'>) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={props.id ?? id} className={className}>
      <select id={props.id ?? id} className="input" {...props}>{children}</select>
    </Field>
  );
}

/** Amount typed in QAR (e.g. 149.50); the parent converts with decimalToMinor. */
export function MoneyField({ label, hint, error, className, currency = 'QAR', ...props }: { label: ReactNode; hint?: ReactNode; error?: string | null; currency?: string } & Omit<ComponentProps<'input'>, 'type'>) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={props.id ?? id} className={className}>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-xs font-medium text-ink-400">{currency}</span>
        <input id={props.id ?? id} type="text" inputMode="decimal" autoComplete="off" className="input ps-12 tabular" aria-invalid={error ? true : undefined} {...props} />
      </div>
    </Field>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium text-ink-800">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-ink-500">{description}</span> : null}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx('relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50', checked ? 'bg-brand-600' : 'bg-ink-200')}
      >
        <span className={clsx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'start-[22px]' : 'start-0.5')} />
      </button>
    </div>
  );
}

export function Checkbox({ label, ...props }: { label?: ReactNode } & Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink-800">
      <input type="checkbox" className="size-4 rounded border-ink-300 accent-brand-600" {...props} />
      {label}
    </label>
  );
}

/** Search box that reports after the user pauses typing. */
export function SearchInput({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const [text, setText] = useState(value);
  const first = useRef(true);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      if (text !== value) onChange(text);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <div className={clsx('relative', className)}>
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
      <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="input ps-9" />
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number | null }[] }) {
  return (
    <div className="no-print -mb-px flex gap-1 overflow-x-auto border-b border-ink-100 px-2" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            'flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
            value === t.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-800',
          )}
        >
          {t.label}
          {t.count ? <span className="rounded-full bg-ink-100 px-1.5 text-xs text-ink-600 tabular">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- dialog

export function Dialog({ open, onClose, title, description, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={clsx(
        'm-auto w-[calc(100%-2rem)] rounded-2xl bg-white p-0 text-ink-900 shadow-[var(--shadow-pop)] backdrop:bg-ink-900/40',
        { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size],
      )}
    >
      {open ? (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              {description ? <p className="mt-0.5 text-sm text-ink-500">{description}</p> : null}
            </div>
            <button type="button" onClick={onClose} className="-me-1 rounded-lg p-1 text-ink-500 hover:bg-ink-100" aria-label="Close">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          {children ? <div className="overflow-y-auto px-5 py-4">{children}</div> : null}
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 px-5 py-3">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

/** "Are you sure?" dialog, optionally asking for a reason (required by the API for rejections and suspensions). */
export function ConfirmDialog({
  open, onClose, onConfirm, title, description, confirmLabel = 'Confirm', danger, reason, busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  reason?: { label: string; required?: boolean; placeholder?: string };
  busy?: boolean;
}) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (open) setText('');
  }, [open]);
  const invalid = !!reason?.required && text.trim().length < 3;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className={danger ? 'btn bg-danger-600 text-white hover:bg-danger-600/90' : 'btn-primary'} disabled={invalid || busy} onClick={() => onConfirm(text.trim())}>
            {busy ? <Spinner /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      {description ? <div className="text-sm text-ink-600">{description}</div> : null}
      {reason ? (
        <div className={description ? 'mt-4' : ''}>
          <TextArea label={reason.label} value={text} onChange={(e) => setText(e.target.value)} placeholder={reason.placeholder} maxLength={500} rows={3} autoFocus />
        </div>
      ) : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------- misc

export function Stat({ label, value, sub, href, tone }: { label: string; value: ReactNode; sub?: ReactNode; href?: string; tone?: 'warn' | 'danger' }) {
  const body = (
    <>
      <p className="text-xs font-medium text-ink-500">{label}</p>
      <p className={clsx('mt-1 text-2xl font-bold tracking-tight tabular', tone === 'danger' ? 'text-danger-600' : tone === 'warn' ? 'text-warning-600' : 'text-ink-900')}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-ink-500">{sub}</p> : null}
    </>
  );
  return href ? (
    <Link href={href} className="card block p-4 transition-shadow hover:shadow-[var(--shadow-pop)]">{body}</Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-ink-500">{k}</dt>
          <dd className="min-w-0 break-words text-ink-900">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Thumb({ src, alt, size = 40 }: { src: string | null | undefined; alt: string; size?: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} width={size} height={size} loading="lazy" className="shrink-0 rounded-md border border-ink-100 bg-ink-50 object-cover" style={{ width: size, height: size }} />
  ) : (
    <div className="shrink-0 rounded-md border border-dashed border-ink-200 bg-ink-50" style={{ width: size, height: size }} aria-hidden />
  );
}

export function NoAccess() {
  return <EmptyState title="No access" description="Your role does not include this section. Ask a super admin if you need it." />;
}
