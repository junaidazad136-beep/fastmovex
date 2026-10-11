'use client';

import clsx from 'clsx';
import { ArrowLeft, ArrowRight, ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import { useToast } from '@/lib/state/toast';

export interface ProductImage { id: string; url: string; sortOrder: number; altText?: string | null }

export const MAX_IMAGES = 10;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

/** Checks a picked file before upload, so staff get the reason immediately. */
export function checkImageFile(f: File): string | null {
  if (!TYPES.includes(f.type)) return `${f.name}: use a JPG, PNG or WebP photo`;
  if (f.size > MAX_BYTES) return `${f.name}: larger than 5 MB`;
  return null;
}

export async function uploadImage(productId: string, file: File): Promise<ProductImage> {
  const fd = new FormData();
  fd.append('file', file);
  return api<ProductImage>(`/admin/products/${productId}/images`, { method: 'POST', body: fd });
}

function DropZone({ onFiles, disabled, left }: { onFiles: (files: File[]) => void; disabled?: boolean; left: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!disabled) onFiles([...e.dataTransfer.files]);
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={clsx(
        'flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed text-center text-xs text-ink-500 transition-colors disabled:opacity-50',
        over ? 'border-brand-500 bg-brand-50' : 'border-ink-200 hover:border-ink-300 hover:bg-ink-25',
      )}
    >
      <ImagePlus className="size-6 text-ink-400" aria-hidden />
      <span className="font-medium text-ink-700">Add photos</span>
      <span>or drop here · {left} left</span>
      <input
        ref={input}
        type="file"
        accept={TYPES.join(',')}
        multiple
        hidden
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
    </button>
  );
}

/** Photos of a saved product: upload (several at once), reorder (first one is the main photo), delete. */
export function ImagesManager({ productId, images, onChange, canEdit }: { productId: string; images: ProductImage[]; onChange: (images: ProductImage[]) => void; canEdit: boolean }) {
  const toast = useToast();
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const sorted = [...images].sort((a, b) => a.sortOrder - b.sortOrder);

  async function add(files: File[]) {
    const room = MAX_IMAGES - images.length;
    const ok: File[] = [];
    for (const f of files) {
      const err = checkImageFile(f);
      if (err) toast.error(err);
      else ok.push(f);
    }
    if (ok.length > room) toast.error(`Only ${room} more ${room === 1 ? 'photo' : 'photos'} can be added (max ${MAX_IMAGES}).`);
    let list = sorted;
    for (const f of ok.slice(0, room)) {
      setUploading((n) => n + 1);
      try {
        const img = await uploadImage(productId, f);
        list = [...list, img];
        onChange(list);
      } catch (e) {
        toast.error(`${f.name}: ${errorMessage(e)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function move(i: number, dir: -1 | 1) {
    const next = [...sorted];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    const withOrder = next.map((im, k) => ({ ...im, sortOrder: k }));
    onChange(withOrder);
    setBusy(true);
    try {
      await api(`/admin/products/${productId}/images/order`, { method: 'PUT', body: { imageIds: withOrder.map((x) => x.id) } });
    } catch (e) {
      toast.error(errorMessage(e));
      onChange(sorted);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api(`/admin/images/${id}`, { method: 'DELETE' });
      onChange(sorted.filter((x) => x.id !== id).map((im, k) => ({ ...im, sortOrder: k })));
      toast.success('Photo removed');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
      {sorted.map((im, i) => (
        <figure key={im.id} className="group relative aspect-square overflow-hidden rounded-xl border border-ink-100 bg-ink-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={im.url} alt={`Photo ${i + 1}`} className="size-full object-cover" />
          {i === 0 ? <span className="absolute start-1.5 top-1.5 rounded-md bg-ink-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">Main</span> : null}
          {canEdit ? (
            <div className="absolute inset-x-0 bottom-0 flex justify-between bg-gradient-to-t from-ink-900/70 to-transparent p-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
              <div className="flex gap-1">
                <button type="button" className="rounded-md bg-white/90 p-1 text-ink-800 disabled:opacity-40" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Move photo ${i + 1} earlier`}>
                  <ArrowLeft className="size-3.5" aria-hidden />
                </button>
                <button type="button" className="rounded-md bg-white/90 p-1 text-ink-800 disabled:opacity-40" disabled={busy || i === sorted.length - 1} onClick={() => move(i, 1)} aria-label={`Move photo ${i + 1} later`}>
                  <ArrowRight className="size-3.5" aria-hidden />
                </button>
              </div>
              <button type="button" className="rounded-md bg-white/90 p-1 text-danger-600" disabled={busy} onClick={() => remove(im.id)} aria-label={`Delete photo ${i + 1}`}>
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </div>
          ) : null}
        </figure>
      ))}
      {Array.from({ length: uploading }, (_, i) => (
        <div key={`u${i}`} className="flex aspect-square items-center justify-center rounded-xl border border-ink-100 bg-ink-50"><Spinner className="size-5 text-ink-400" /></div>
      ))}
      {canEdit && images.length + uploading < MAX_IMAGES ? <DropZone onFiles={add} left={MAX_IMAGES - images.length - uploading} /> : null}
    </div>
  );
}

/** Photos picked before a new product exists; uploaded right after it is created. */
export function PendingImages({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const toast = useToast();
  const [urls] = useState(() => new Map<File, string>());
  const url = (f: File) => {
    let u = urls.get(f);
    if (!u) {
      u = URL.createObjectURL(f);
      urls.set(f, u);
    }
    return u;
  };
  const add = (picked: File[]) => {
    const ok = picked.filter((f) => {
      const err = checkImageFile(f);
      if (err) toast.error(err);
      return !err;
    });
    onChange([...files, ...ok].slice(0, MAX_IMAGES));
  };
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
      {files.map((f, i) => (
        <figure key={i} className="relative aspect-square overflow-hidden rounded-xl border border-ink-100 bg-ink-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url(f)} alt={f.name} className="size-full object-cover" />
          {i === 0 ? <span className="absolute start-1.5 top-1.5 rounded-md bg-ink-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">Main</span> : null}
          <button type="button" className="absolute end-1.5 bottom-1.5 rounded-md bg-white/90 p-1 text-danger-600" onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        </figure>
      ))}
      {files.length < MAX_IMAGES ? <DropZone onFiles={add} left={MAX_IMAGES - files.length} /> : null}
    </div>
  );
}
