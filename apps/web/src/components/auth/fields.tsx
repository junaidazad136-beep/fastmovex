'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useT } from '@/lib/i18n/client';

export function Field({ label, hint, error, children, id }: { label: ReactNode; hint?: ReactNode; error?: string; children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode; id?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  const describedBy = [error ? `${fid}-err` : null, hint ? `${fid}-hint` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={fid} className="label">{label}</label>
      {children({ id: fid, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && !error && <p id={`${fid}-hint`} className="hint">{hint}</p>}
      {error && <p id={`${fid}-err`} className="field-error" role="alert">{error}</p>}
    </div>
  );
}

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const t = useT();
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={show ? 'text' : 'password'} className="input pe-11" />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')} className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink-400 hover:text-ink-700">
        {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

export function FormError({ message }: { message: ReactNode }) {
  if (!message) return null;
  return <p className="rounded-xl bg-danger-50 px-3.5 py-2.5 text-sm font-medium text-danger-600" role="alert">{message}</p>;
}

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="container-page flex justify-center py-10 sm:py-16">
      <div className="w-full max-w-md">
        <div className="card p-6 sm:p-8">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-ink-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;
export const E164 = /^\+[1-9]\d{7,14}$/;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "+974 5555 5555", "0097455555555", "55555555" (Qatar) → "+97455555555". Anything else is returned trimmed. */
export function normalizePhone(input: string, countryDial = '+974'): string {
  const s = input.replace(/[\s()-]/g, '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  if (s.startsWith('00')) return `+${s.slice(2)}`;
  if (/^\d{8}$/.test(s) && countryDial === '+974') return `${countryDial}${s}`;
  return s;
}

/** A recovery code for two-step sign-in, e.g. "K7QM-2XPA" (the dash is optional). */
export const RECOVERY_CODE = /^[A-Z2-7]{4}-?[A-Z2-7]{4}$/;

/**
 * What the shopper types as a two-step sign-in code: the authenticator's 6 digits (Arabic-Indic digits and spaces
 * accepted), or a recovery code (upper-cased, spaces dropped).
 */
export function normalizeOtp(input: string, recovery = false): string {
  const latin = input.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  return recovery ? latin.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12) : latin.replace(/\D/g, '').slice(0, 6);
}

export function normalizeIdentifier(input: string): string {
  const s = input.trim();
  return s.includes('@') ? s.toLowerCase() : normalizePhone(s);
}
