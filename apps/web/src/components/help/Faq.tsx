'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { Faq as FaqItem } from '@/lib/api/types';
import { useT } from '@/lib/i18n/client';
import { pick } from '@/lib/urls';

const KNOWN = ['delivery', 'orders', 'order', 'payment', 'refund', 'return', 'account', 'seller', 'other'] as const;

export function Faq({ items }: { items: FaqItem[] }) {
  const t = useT();
  const l = t.locale;
  const topics = [...new Set(items.map((f) => f.category))];
  const [topic, setTopic] = useState<string>('all');
  const label = (c: string) => ((KNOWN as readonly string[]).includes(c) ? t(`help.topics.${c as (typeof KNOWN)[number]}`) : c);
  const shown = topic === 'all' ? items : items.filter((f) => f.category === topic);
  return (
    <div>
      <ul className="no-scrollbar mb-4 flex gap-2 overflow-x-auto">
        {['all', ...topics].map((c) => (
          <li key={c}><button type="button" onClick={() => setTopic(c)} aria-pressed={topic === c} className={`chip whitespace-nowrap ${topic === c ? 'chip-active' : ''}`}>{c === 'all' ? t('help.topics.all') : label(c)}</button></li>
        ))}
      </ul>
      <ul className="card divide-y divide-ink-100">
        {shown.map((f) => (
          <li key={f.id}>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 font-medium text-ink-900 [&::-webkit-details-marker]:hidden">
                {pick(l, f.question, f.questionAr)}
                <ChevronDown className="size-4 shrink-0 text-ink-400 transition group-open:rotate-180" aria-hidden />
              </summary>
              <p className="px-4 pb-4 text-sm leading-6 text-ink-600">{pick(l, f.answer, f.answerAr)}</p>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
