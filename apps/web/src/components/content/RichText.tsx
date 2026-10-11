import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Locale } from '@/lib/i18n/config';

/**
 * Renders the admin panel's page text without any raw HTML: blank lines separate paragraphs, "## " and "### " start
 * headings, "- " lines make a list, **bold**, and [text](link) where the link is a site path (/…), https://, mailto: or tel:.
 * Anything else stays plain text, so page content can never inject markup or scripts.
 */
export function RichText({ text, locale }: { text: string; locale: Locale }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="space-y-4 text-[15px] leading-7 text-ink-700">
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        if (lines[0].startsWith('## ') && lines.length === 1) return <h2 key={i} className="pt-4 text-xl font-bold tracking-tight text-ink-900">{inline(lines[0].slice(3), locale)}</h2>;
        if (lines[0].startsWith('### ') && lines.length === 1) return <h3 key={i} className="pt-2 text-lg font-semibold text-ink-900">{inline(lines[0].slice(4), locale)}</h3>;
        if (lines.every((ln) => /^[-•] /.test(ln))) {
          return (
            <ul key={i} className="list-disc space-y-1.5 ps-6 marker:text-brand-500">
              {lines.map((ln, j) => <li key={j}>{inline(ln.slice(2), locale)}</li>)}
            </ul>
          );
        }
        // A heading line followed by text in the same block
        if (/^#{2,3} /.test(lines[0])) {
          const level = lines[0].startsWith('### ') ? 3 : 2;
          const rest = lines.slice(1).join('\n');
          return (
            <div key={i} className="space-y-4">
              {level === 2 ? <h2 className="pt-4 text-xl font-bold tracking-tight text-ink-900">{inline(lines[0].slice(3), locale)}</h2> : <h3 className="pt-2 text-lg font-semibold text-ink-900">{inline(lines[0].slice(4), locale)}</h3>}
              <RichText text={rest} locale={locale} />
            </div>
          );
        }
        return <p key={i}>{lines.map((ln, j) => <span key={j}>{j > 0 && <br />}{inline(ln, locale)}</span>)}</p>;
      })}
    </div>
  );
}

function href(url: string, locale: Locale): { href: string; external: boolean } | null {
  if (url.startsWith('/') && !url.startsWith('//')) return { href: `/${locale}${url === '/' ? '' : url}`, external: false };
  if (/^https:\/\/[^\s]+$/i.test(url)) return { href: url, external: true };
  if (/^(mailto|tel):[^\s]+$/i.test(url)) return { href: url, external: true };
  return null;
}

/** **bold** and [text](link); everything else is text. */
export function inline(s: string, locale: Locale): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={k++} className="font-semibold text-ink-900">{m[1]}</strong>);
    else {
      const h = href(m[3], locale);
      if (!h) out.push(m[2]);
      else if (h.external) out.push(<a key={k++} href={h.href} className="link" rel="noopener noreferrer" target={h.href.startsWith('https') ? '_blank' : undefined}>{m[2]}</a>);
      else out.push(<Link key={k++} href={h.href} className="link">{m[2]}</Link>);
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
