import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

export function Breadcrumbs({ items, label }: { items: { name: string; href?: string }[]; label: string }) {
  return (
    <nav aria-label={label} className="mb-4 overflow-x-auto no-scrollbar">
      <ol className="flex items-center gap-1 whitespace-nowrap text-[13px] text-ink-500">
        {items.map((c, i) => (
          <li key={`${c.name}-${i}`} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5 text-ink-300 rtl:rotate-180" aria-hidden />}
            {c.href && i < items.length - 1 ? (
              <Link href={c.href} className="hover:text-brand-600 hover:underline">{c.name}</Link>
            ) : (
              <span aria-current={i === items.length - 1 ? 'page' : undefined} className="text-ink-700">{c.name}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
