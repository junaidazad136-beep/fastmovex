'use client';

import { X } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';

/** Keywords as chips: Enter or comma adds one, Backspace on an empty box removes the last. Stored lowercase. */
export function TagsInput({ value, onChange, max = 20, label = 'Tags', hint }: { value: string[]; onChange: (v: string[]) => void; max?: number; label?: string; hint?: string }) {
  const id = useId();
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const parts = raw.split(',').map((t) => t.trim().toLowerCase()).filter((t) => t && t.length <= 40);
    if (!parts.length) return;
    onChange([...new Set([...value, ...parts])].slice(0, max));
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(text);
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2 py-1.5 focus-within:border-brand-500 focus-within:ring-3 focus-within:ring-brand-600/15">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-md bg-ink-100 py-0.5 ps-2 pe-1 text-xs text-ink-800">
            {t}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="rounded p-0.5 text-ink-500 hover:bg-ink-200 hover:text-ink-900" aria-label={`Remove ${t}`}>
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => add(text)}
          disabled={value.length >= max}
          placeholder={value.length ? '' : 'e.g. gift, eid, summer'}
          className="min-w-[120px] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-ink-400"
        />
      </div>
      <p className="hint">{hint ?? `Used by search and filters. Press Enter after each one (${value.length}/${max}).`}</p>
    </div>
  );
}
