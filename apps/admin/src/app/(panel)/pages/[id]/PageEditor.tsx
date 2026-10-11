'use client';

import { AlertTriangle, ExternalLink, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useConfig } from '@/components/layout/Providers';
import { Card, ConfirmDialog, EmptyState, ErrorState, Loading, PageHeader, Spinner, Switch, Tabs, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { errorMessage, isNotFound } from '@/lib/api/errors';
import { useToast } from '@/lib/state/toast';
import { useApi } from '@/lib/use-api';
import type { AdminPage } from '../PagesList';

type Form = Omit<AdminPage, 'id' | 'updatedAt'>;
const BLANK: Form = { slug: '', title: '', titleAr: '', body: '', bodyAr: '', isPublished: false, showInFooter: true, sortOrder: 50 };
const LEGAL = ['privacy', 'terms'];

/** Only the editable fields: the API refuses anything else (id, timestamps, who edited it). */
function formOf(p: AdminPage): Form {
  return { slug: p.slug, title: p.title, titleAr: p.titleAr, body: p.body, bodyAr: p.bodyAr, isPublished: p.isPublished, showInFooter: p.showInFooter, sortOrder: p.sortOrder };
}

export function PageEditor({ id }: { id: string }) {
  const isNew = id === 'new';
  const valid = isNew || /^[0-9a-f-]{36}$/i.test(id);
  const page = useApi<AdminPage>(!isNew && valid ? `/admin/pages/${id}` : null);
  const router = useRouter();
  const toast = useToast();
  const { storefrontUrl } = useConfig();
  const [f, setF] = useState<Form>(BLANK);
  const [lang, setLang] = useState<'en' | 'ar'>('en');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (page.data) setF(formOf(page.data));
  }, [page.data]);

  if (!valid || isNotFound(page.error)) return <EmptyState title="Page not found" action={<Link href="/pages" className="btn-secondary">Back to pages</Link>} />;
  if (page.error) return <ErrorState error={page.error} onRetry={page.reload} />;
  if (!isNew && !page.data) return <Loading />;

  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));

  async function save() {
    setError(null);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.slug)) return setError('Web address: lowercase letters, numbers and dashes, e.g. shipping-policy');
    if (f.title.trim().length < 2 || f.titleAr.trim().length < 2) return setError('Give the page a title in English and in Arabic.');
    if (f.isPublished && (!f.body.trim() || !f.bodyAr.trim())) return setError('Write the text in both languages before publishing, or keep it as a draft.');
    setBusy('save');
    try {
      const saved = await api<AdminPage>(isNew ? '/admin/pages' : `/admin/pages/${id}`, { method: isNew ? 'POST' : 'PATCH', body: { ...formOf({ ...f, id: '', updatedAt: '' }), title: f.title.trim(), titleAr: f.titleAr.trim() } });
      toast.success(isNew ? 'Page created' : 'Page saved. The website shows it within a few minutes.');
      if (isNew) router.replace(`/pages/${saved.id}`);
      else page.setData(saved);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    try {
      await api(`/admin/pages/${id}`, { method: 'DELETE' });
      toast.success('Page deleted');
      router.replace('/pages');
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  }

  const body = lang === 'en' ? f.body : f.bodyAr;
  return (
    <>
      <PageHeader
        back={{ href: '/pages', label: 'Pages' }}
        title={isNew ? 'New page' : f.title || 'Page'}
        actions={
          !isNew && page.data?.isPublished ? (
            <a href={`${storefrontUrl}/${lang}/${page.data.slug}`} target="_blank" rel="noopener noreferrer" className="btn-secondary">View on website <ExternalLink className="size-3.5" aria-hidden /></a>
          ) : null
        }
      />
      {LEGAL.includes(f.slug) ? (
        <p className="mb-5 flex items-start gap-2 rounded-xl bg-warning-50 px-4 py-3 text-sm text-warning-600">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          This is a legal text. The starting version is a template: have it checked by a lawyer in Qatar and fill in your company details before launch.
        </p>
      ) : null}
      {error ? <p className="mb-4 rounded-xl bg-danger-50 px-4 py-3 text-sm font-medium text-danger-600" role="alert">{error}</p> : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Card title="Text" bodyClassName="p-0">
            <Tabs value={lang} onChange={setLang} tabs={[{ value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }]} />
            <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-2">
              <div>
                <TextField
                  label={lang === 'en' ? 'Title' : 'Title (Arabic)'}
                  dir={lang === 'ar' ? 'rtl' : undefined}
                  lang={lang}
                  value={lang === 'en' ? f.title : f.titleAr}
                  onChange={(e) => set(lang === 'en' ? { title: e.target.value } : { titleAr: e.target.value })}
                  maxLength={120}
                />
                <label className="label mt-4" htmlFor="page-body">Text</label>
                <textarea
                  id="page-body"
                  dir={lang === 'ar' ? 'rtl' : undefined}
                  lang={lang}
                  className="input min-h-[420px] font-mono text-[13px] leading-6"
                  value={body}
                  onChange={(e) => set(lang === 'en' ? { body: e.target.value } : { bodyAr: e.target.value })}
                  maxLength={50000}
                />
                <p className="hint">Blank line = new paragraph · <code>## </code> heading · <code>- </code> list item · <code>**bold**</code> · <code>[text](/contact)</code> link</p>
              </div>
              <div>
                <p className="label">Preview</p>
                <div dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} className="max-h-[520px] overflow-y-auto rounded-xl border border-ink-100 bg-white p-5">
                  <h1 className="mb-4 text-2xl font-bold">{lang === 'en' ? f.title : f.titleAr}</h1>
                  <Preview text={body} />
                </div>
              </div>
            </div>
          </Card>
        </div>
        <div className="min-w-0 space-y-6">
          <Card title="Settings">
            <div className="space-y-4">
              <TextField label="Web address" value={f.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} hint={`${storefrontUrl.replace(/^https?:\/\//, '')}/en/${f.slug || '…'}`} maxLength={60} />
              <Switch checked={f.isPublished} onChange={(isPublished) => set({ isPublished })} label="Published" description="Drafts are not visible on the website" />
              <Switch checked={f.showInFooter} onChange={(showInFooter) => set({ showInFooter })} label="Link in the footer" />
              <TextField label="Order in the footer" inputMode="numeric" value={String(f.sortOrder)} onChange={(e) => set({ sortOrder: Number(e.target.value.replace(/\D/g, '') || 0) })} hint="Lower numbers come first" />
            </div>
          </Card>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary flex-1" onClick={save} disabled={!!busy}>{busy === 'save' ? <Spinner /> : null} {isNew ? 'Create page' : 'Save'}</button>
            {!isNew ? <button type="button" className="btn-danger" onClick={() => setConfirmDelete(true)} disabled={!!busy} aria-label="Delete page"><Trash2 className="size-4" aria-hidden /></button> : null}
          </div>
        </div>
      </div>
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={remove} title={`Delete “${f.title}”?`} description="The page disappears from the website at once. Links to it will show “not found”. To hide it for now, unpublish it instead." confirmLabel="Delete" danger busy={busy === 'delete'} />
    </>
  );
}

/** Same rules as the website's renderer (headings, lists, bold, links), for a faithful preview. */
function Preview({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (!blocks.length) return <p className="text-sm text-ink-400">Nothing written yet.</p>;
  return (
    <div className="space-y-3 text-sm leading-6 text-ink-700">
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        return (
          <Fragment key={i}>
            {lines.map((ln, j) => {
              if (ln.startsWith('## ')) return <h2 key={j} className="pt-2 text-lg font-bold text-ink-900">{inline(ln.slice(3))}</h2>;
              if (ln.startsWith('### ')) return <h3 key={j} className="font-semibold text-ink-900">{inline(ln.slice(4))}</h3>;
              if (/^[-•] /.test(ln)) return <p key={j} className="ps-4 before:me-2 before:content-['•']">{inline(ln.slice(2))}</p>;
              return <p key={j}>{inline(ln)}</p>;
            })}
          </Fragment>
        );
      })}
    </div>
  );
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(m[1] !== undefined ? <strong key={m.index}>{m[1]}</strong> : <span key={m.index} className="text-brand-600 underline" title={m[3]}>{m[2]}</span>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
