'use client';

import { Pin, PinOff, Plus, Tags, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Card, Spinner } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { useAction, useApi } from '@/lib/use-api';
import { TagBadges, tagLabel } from './tags';

export interface Note { id: string; body: string; pinned?: boolean; createdAt: string; author: { id: string; fullName: string } }
interface TagsInUse { suggested: string[]; inUse: { tag: string; customers: number }[] }

/** Staff tags on a customer (VIP, Risky, Wholesale, or any short word). Never shown to the customer. */
export function CustomerTagsCard({ userId, tags, onChange }: { userId: string; tags: string[]; onChange: (tags: string[]) => void }) {
  const { can } = useSession();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(tags);
  const [text, setText] = useState('');
  const known = useApi<TagsInUse>(editing ? '/admin/customer-tags' : null);
  const { busy, run } = useAction();
  const options = [...new Set([...(known.data?.suggested ?? []), ...(known.data?.inUse.map((t) => t.tag) ?? [])])].filter((t) => !draft.includes(t));

  function add(t: string) {
    const v = t.trim().toUpperCase().replace(/\s+/g, '_');
    if (v && !draft.includes(v)) setDraft([...draft, v]);
    setText('');
  }
  async function save() {
    const r = await run('tags', () => api<{ tags: string[] }>(`/admin/users/${userId}/tags`, { method: 'PUT', body: { tags: draft } }), 'Tags saved');
    if (r) { onChange(r.tags); setEditing(false); }
  }

  return (
    <Card
      title={<span className="flex items-center gap-2"><Tags className="size-4 text-ink-400" aria-hidden />Tags</span>}
      actions={can('users.update') && !editing ? <button type="button" className="btn-ghost btn-sm" onClick={() => { setDraft(tags); setEditing(true); }} data-testid="edit-tags">Edit</button> : undefined}
    >
      {!editing ? (
        tags.length ? <TagBadges tags={tags} /> : <p className="text-sm text-ink-500">No tags. Tags like VIP or Risky show on every order of this customer.</p>
      ) : (
        <div className="space-y-3" data-testid="tags-editor">
          <div className="flex flex-wrap gap-1.5">
            {draft.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-ink-100 py-0.5 ps-2 pe-1 text-xs font-medium text-ink-700">
                {tagLabel(t)}
                <button type="button" className="rounded-full p-0.5 hover:bg-ink-200" onClick={() => setDraft(draft.filter((x) => x !== t))} aria-label={`Remove ${tagLabel(t)}`}><X className="size-3" aria-hidden /></button>
              </span>
            ))}
            {!draft.length ? <span className="text-xs text-ink-500">No tags</span> : null}
          </div>
          {options.length ? (
            <div className="flex flex-wrap gap-1.5">
              {options.slice(0, 10).map((t) => (
                <button key={t} type="button" className="rounded-full border border-dashed border-ink-300 px-2 py-0.5 text-xs text-ink-600 hover:border-brand-400 hover:text-brand-700" onClick={() => add(t)}>
                  <Plus className="me-0.5 inline size-3" aria-hidden />{tagLabel(t)}
                </button>
              ))}
            </div>
          ) : null}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(text); }}>
            <input className="input py-1.5" value={text} onChange={(e) => setText(e.target.value)} placeholder="Other tag, e.g. Corporate" maxLength={20} aria-label="New tag" />
            <button type="submit" className="btn-secondary btn-sm" disabled={!text.trim()}>Add</button>
          </form>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            <button type="button" className="btn-primary btn-sm" onClick={save} disabled={busy === 'tags'} data-testid="save-tags">{busy === 'tags' ? <Spinner /> : null}Save tags</button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Internal notes about a customer. One can be pinned: it shows on each of their orders. */
export function CustomerNotesCard({ userId }: { userId: string }) {
  const { can, user } = useSession();
  const notes = useApi<{ items: Note[] }>(`/admin/users/${userId}/notes`);
  const [body, setBody] = useState('');
  const [pin, setPin] = useState(false);
  const { busy, run } = useAction();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    const r = await run('add', () => api(`/admin/users/${userId}/notes`, { method: 'POST', body: { body, pinned: pin } }), 'Note added');
    if (r) { setBody(''); setPin(false); notes.reload(); }
  }
  async function togglePin(n: Note) {
    const r = await run(n.id, () => api<{ items: Note[] }>(`/admin/users/${userId}/notes/${n.id}`, { method: 'PATCH', body: { pinned: !n.pinned } }));
    if (r) notes.setData(r);
  }
  async function remove(n: Note) {
    if (!window.confirm('Delete this note?')) return;
    const r = await run(n.id, () => api(`/admin/users/${userId}/notes/${n.id}`, { method: 'DELETE' }), 'Note deleted');
    if (r) notes.reload();
  }

  return (
    <Card title="Staff notes" description="Only staff see these — never the customer.">
      <form onSubmit={add} className="space-y-2" data-testid="note-form">
        <textarea className="input min-h-[70px]" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} placeholder="e.g. Prefers delivery after 6 pm, call before" aria-label="New note" />
        <div className="flex items-center justify-between gap-2">
          {can('users.update') ? (
            <label className="flex items-center gap-2 text-xs text-ink-600"><input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /> Pin (shows on their orders)</label>
          ) : <span />}
          <button type="submit" className="btn-primary btn-sm" disabled={!body.trim() || busy === 'add'}>{busy === 'add' ? <Spinner /> : null}Add note</button>
        </div>
      </form>
      <ul className="mt-4 space-y-3" data-testid="notes">
        {notes.data?.items.map((n) => (
          <li key={n.id} className={`rounded-lg border p-3 text-sm ${n.pinned ? 'border-warning-200 bg-warning-50/50' : 'border-ink-100'}`} data-testid="note">
            <p className="whitespace-pre-wrap text-ink-800">{n.body}</p>
            <div className="mt-2 flex items-center gap-2 text-xs text-ink-500">
              {n.pinned ? <Pin className="size-3 text-warning-600" aria-label="Pinned" /> : null}
              <span className="flex-1">{n.author.fullName} · {formatDateTime(n.createdAt)}</span>
              {can('users.update') ? (
                <button type="button" className="rounded p-1 hover:bg-ink-100" onClick={() => togglePin(n)} disabled={!!busy} aria-label={n.pinned ? 'Unpin' : 'Pin'} title={n.pinned ? 'Unpin' : 'Pin to their orders'}>
                  {n.pinned ? <PinOff className="size-3.5" aria-hidden /> : <Pin className="size-3.5" aria-hidden />}
                </button>
              ) : null}
              {can('users.update') || n.author.id === user?.id ? (
                <button type="button" className="rounded p-1 hover:bg-ink-100 hover:text-danger-600" onClick={() => remove(n)} disabled={!!busy} aria-label="Delete note"><Trash2 className="size-3.5" aria-hidden /></button>
              ) : null}
            </div>
          </li>
        ))}
        {notes.data?.items.length === 0 ? <li className="text-sm text-ink-500">No notes yet.</li> : null}
      </ul>
    </Card>
  );
}
