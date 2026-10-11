'use client';

import clsx from 'clsx';
import { Banknote, Camera, CheckCircle2, FileText, LocateFixed, LogOut, MapPin, MessageCircle, Navigation, Package, Phone, Printer, RefreshCw, RotateCcw, Truck, WifiOff, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LogoMark } from '@/components/layout/Logo';
import { Dialog, Spinner } from '@/components/ui';
import { api, openPdf } from '@/lib/api/client';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { formatMoney, formatTime } from '@/lib/format';
import { shrinkPhoto } from '@/lib/image';
import { useSession } from '@/lib/state/session';
import { useToast } from '@/lib/state/toast';
import { cachedRun, enqueue, flush, isOffline, outbox, type OutboxEntry, type OutboxKind, saveProfile, saveRun, statusAfter } from '@/lib/driver-offline';
import { PickupCards, RefuseItemsDialog, type PickupJob } from './DriverExtras';

type Queue = (job: Job, kind: OutboxKind, payload?: Record<string, string>) => void;

/** The run with the steps still waiting in the outbox already applied (what the driver has actually done). */
function withOutbox(run: Run, pending: OutboxEntry[]): Run {
  if (!pending.length) return run;
  const jobs = run.jobs.map((j) => {
    const kinds = pending.filter((p) => p.jobId === j.id).map((p) => p.kind);
    return kinds.length ? { ...j, status: statusAfter(j.status, kinds) as Status } : j;
  });
  const open = jobs.filter((j) => j.status !== 'DELIVERED' && j.status !== 'FAILED');
  const cashOpen = open.reduce((n, j) => n + BigInt(j.cash?.amountMinor ?? '0'), 0n);
  return { jobs, summary: { ...run.summary, toDo: open.length, delivered: jobs.filter((j) => j.status === 'DELIVERED').length, failed: jobs.filter((j) => j.status === 'FAILED').length, cashToCollectMinor: cashOpen.toString() } };
}

/** Sends one queued step the way the page would have sent it online. */
async function sendQueued(e: OutboxEntry) {
  if (e.kind === 'pickup' || e.kind === 'out-for-delivery') {
    await api(`/courier/jobs/${e.jobId}/${e.kind}`, { method: 'POST' });
    return;
  }
  const form = new FormData();
  for (const [k, v] of Object.entries(e.payload)) form.append(k, v);
  await api(`/courier/jobs/${e.jobId}/${e.kind === 'deliver' ? 'deliver' : 'fail'}`, { method: 'POST', body: form });
}

type Status = 'ASSIGNED' | 'PICKED_UP' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED';
interface Job {
  id: string;
  status: Status;
  attempts: number;
  deliveredAt: string | null;
  failureReason: string | null;
  hasPhoto: boolean;
  orderNumber: string;
  slot: { start: string; end: string } | null;
  customer: { name: string | null; phone: string | null };
  address: { zone: string | null; street: string | null; building: string | null; unit: string | null; city: string | null; line1: string | null; mapUrl: string };
  note: string | null;
  items: { id: string; title: string; quantity: number; unitPriceMinor?: string }[];
  pickup: { name: string | null; place: string | null; phone: string | null };
  cash: { amountMinor: string; currencyCode: string } | null;
}
interface Run {
  summary: { toDo: number; delivered: number; failed: number; cashToCollectMinor: string; cashCollectedMinor: string; currencyCode: string };
  jobs: Job[];
}

const STATUS: Record<Status, { label: string; tone: string }> = {
  ASSIGNED: { label: 'To pick up', tone: 'bg-ink-100 text-ink-700' },
  PICKED_UP: { label: 'Picked up', tone: 'bg-sand-100 text-sand-700' },
  IN_TRANSIT: { label: 'Picked up', tone: 'bg-sand-100 text-sand-700' },
  OUT_FOR_DELIVERY: { label: 'On the way', tone: 'bg-brand-50 text-brand-700' },
  DELIVERED: { label: 'Delivered', tone: 'bg-success-50 text-success-700' },
  FAILED: { label: 'Not delivered', tone: 'bg-danger-50 text-danger-600' },
};
const REFUSED = 'Customer refused the order';
const FAIL_REASONS = ['Customer not answering', 'Customer not at home', 'Wrong or incomplete address', 'Customer asked for another day', REFUSED];

interface MyCash {
  inHandMinor: string;
  currencyCode: string;
  limitMinor: string | null;
  open: { id: string; orderNumber: string; amountMinor: string }[];
  handovers: { id: string; number: string; createdAt: string; receivedMinor: string; varianceMinor: string; currencyCode: string; receivedBy: { fullName: string } }[];
}

/** The cash the driver holds for FastMoveX, the limit, and receipts of what was handed over. */
function CashCard({ cash, onError }: { cash: MyCash; onError: (e: unknown) => void }) {
  const over = !!cash.limitMinor && BigInt(cash.inHandMinor) >= BigInt(cash.limitMinor);
  return (
    <section className={clsx('rounded-2xl border bg-white p-4', over ? 'border-danger-600' : 'border-ink-200')} data-testid="driver-cash">
      <div className="flex items-center gap-3">
        <Banknote className={clsx('size-6', over ? 'text-danger-600' : 'text-sand-700')} aria-hidden />
        <div className="flex-1">
          <p className="text-xs text-ink-500">Cash with me</p>
          <p className="text-xl font-bold tabular">{formatMoney(cash.inHandMinor, cash.currencyCode)}</p>
        </div>
        {cash.limitMinor ? <p className="text-end text-xs text-ink-500">Limit<br /><strong className="tabular text-ink-700">{formatMoney(cash.limitMinor, cash.currencyCode)}</strong></p> : null}
      </div>
      {over ? <p className="mt-2 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600" role="alert">Hand this cash to the cashier before picking up more orders.</p> : null}
      {cash.open.length ? <p className="mt-2 text-xs text-ink-500">From {cash.open.length} {cash.open.length === 1 ? 'order' : 'orders'}: {cash.open.slice(0, 4).map((o) => o.orderNumber.slice(-6)).join(', ')}{cash.open.length > 4 ? '…' : ''}</p> : null}
      {cash.handovers.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-brand-700">My handover receipts</summary>
          <ul className="mt-2 divide-y divide-ink-100 text-sm">
            {cash.handovers.map((h) => {
              const v = BigInt(h.varianceMinor);
              return (
                <li key={h.id} className="flex items-center gap-2 py-2">
                  <span className="flex-1"><span className="font-medium">{formatMoney(h.receivedMinor, h.currencyCode)}</span><span className="ms-1 text-xs text-ink-500">to {h.receivedBy.fullName}</span>{v < 0n ? <span className="ms-1 text-xs font-semibold text-danger-600">short {formatMoney((-v).toString(), h.currencyCode)}</span> : null}</span>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => { openPdf(`/courier/cash/handovers/${h.id}/receipt`, `${h.number}.pdf`).catch(onError); }}><FileText className="size-4" aria-hidden /> Receipt</button>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
const DONE: Status[] = ['DELIVERED', 'FAILED'];

/**
 * The driver's phone screen: today's stops in driving order (delivery window, then zone), one big button for the
 * next step, the customer's 4-digit code plus a doorstep photo as proof, cash to collect, and live location while
 * on the way (only after the driver switches it on).
 */
export function DriverApp() {
  const { status, user, isDriver, signOut } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [deliver, setDeliver] = useState<Job | null>(null);
  const [fail, setFail] = useState<Job | null>(null);
  const [sharing, setSharing] = useState(false);
  const [cash, setCash] = useState<MyCash | null>(null);
  const [refuse, setRefuse] = useState<Job | null>(null);
  const [pickups, setPickups] = useState<PickupJob[]>([]);
  // offline: when the shown run was saved, and how many steps wait to be sent
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const uid = user?.id ?? '';

  useEffect(() => {
    if (status === 'signed-out') router.replace('/login?next=/driver');
  }, [status, router]);

  // the page keeps working in a basement: the app shell is cached by a small service worker
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/driver-sw.js', { scope: '/driver' }).catch(() => { /* works without it */ });
  }, []);

  const load = useCallback(async () => {
    if (!uid) return;
    // first send what was done offline, in order; then show the server's view
    const f = await flush(uid, sendQueued, (e) => errorMessage(e));
    for (const r of f.refused) toast.error(`${r.entry.orderNumber}: ${r.message}`);
    if (f.sent) toast.success(`${f.sent} saved step${f.sent === 1 ? '' : 's'} sent`);
    setPending(f.left);
    try {
      const [r, c, p] = await Promise.all([api<Run>('/courier/jobs/run'), api<MyCash>('/courier/cash').catch(() => null), api<PickupJob[]>('/courier/pickups').catch(() => null)]);
      saveRun(uid, r);
      setRun(withOutbox(r, outbox(uid)));
      setOfflineSince(null);
      if (p) setPickups(p);
      if (c) setCash(c);
      setError('');
    } catch (e) {
      const cached = isOffline(e) ? cachedRun<Run>(uid) : null;
      if (cached) {
        setRun(withOutbox(cached.run, outbox(uid)));
        setOfflineSince(cached.savedAt);
        setError('');
      } else setError(errorMessage(e));
    }
  }, [uid, toast]);

  useEffect(() => {
    if (status !== 'signed-in' || !isDriver || !user) return;
    saveProfile({ id: user.id, fullName: user.fullName, email: user.email, roles: user.roles, perms: user.perms });
    void load();
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    const online = () => void load();
    window.addEventListener('online', online);
    return () => { window.clearInterval(id); window.removeEventListener('online', online); };
  }, [status, isDriver, user, load]);

  /** No signal: the step is kept on the phone and shown as done; it is sent when the phone is back online. */
  const queue: Queue = useCallback((job, kind, payload = {}) => {
    enqueue(uid, { jobId: job.id, orderNumber: job.orderNumber, kind, payload });
    setPending(outbox(uid).length);
    setRun((r) => (r ? withOutbox(r, outbox(uid)) : r));
    toast.success(`${job.orderNumber}: saved on this phone — sent when you are back online`);
  }, [uid, toast]);

  useLiveLocation(sharing, run?.jobs.filter((j) => j.status === 'OUT_FOR_DELIVERY').map((j) => j.id) ?? [], () => setSharing(false));

  async function step(job: Job, path: 'pickup' | 'out-for-delivery', done: string) {
    setBusy(job.id);
    try {
      await api(`/courier/jobs/${job.id}/${path}`, { method: 'POST' });
      toast.success(done);
      await load();
    } catch (e) {
      if (isOffline(e)) queue(job, path);
      else toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (status !== 'signed-in' || !user) {
    return <div className="flex min-h-dvh items-center justify-center"><Spinner className="size-6" /></div>;
  }
  if (!isDriver) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <Truck className="size-10 text-ink-300" aria-hidden />
        <h1 className="text-lg font-bold">This page is for FastMoveX drivers</h1>
        <p className="text-sm text-ink-500">Your account is not a driver account. Ask an admin to give you the Delivery Agent role.</p>
        <Link href="/" className="btn-primary">Back to the admin panel</Link>
      </div>
    );
  }

  const groups = groupBySlot(run?.jobs ?? []);
  const onTheWay = run?.jobs.some((j) => j.status === 'OUT_FOR_DELIVERY');
  const cur = run?.summary.currencyCode ?? 'QAR';

  return (
    <div className="min-h-dvh bg-ink-50 pb-[env(safe-area-inset-bottom)]">
      <header className="sticky top-0 z-20 border-b border-ink-100 bg-white/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <LogoMark className="size-8" />
          <div className="min-w-0 flex-1 leading-tight">
            <h1 className="text-base font-bold">Deliveries today</h1>
            <p className="truncate text-xs text-ink-500">{user.fullName}</p>
          </div>
          <button type="button" onClick={() => { openPdf('/courier/jobs/run.pdf', 'run-sheet.pdf').catch((e) => toast.error(errorMessage(e))); }} className="rounded-lg p-2.5 text-ink-600 hover:bg-ink-100" aria-label="Run sheet (PDF)" data-testid="driver-run-sheet"><Printer className="size-5" aria-hidden /></button>
          <button type="button" onClick={() => void load()} className="rounded-lg p-2.5 text-ink-600 hover:bg-ink-100" aria-label="Refresh"><RefreshCw className="size-5" aria-hidden /></button>
          <button type="button" onClick={() => { if (pending && !window.confirm(`${pending} step${pending === 1 ? ' is' : 's are'} not sent yet. Signing out deletes ${pending === 1 ? 'it' : 'them'} from this phone. Sign out anyway?`)) return; void signOut(); }} className="rounded-lg p-2.5 text-ink-600 hover:bg-ink-100" aria-label="Sign out"><LogOut className="size-5" aria-hidden /></button>
        </div>
        {run ? (
          <dl className="mx-auto mt-3 grid max-w-xl grid-cols-3 gap-2 text-center" data-testid="driver-summary">
            <div className="rounded-xl bg-ink-50 py-2"><dt className="text-[11px] text-ink-500">To do</dt><dd className="text-lg font-bold tabular">{run.summary.toDo}</dd></div>
            <div className="rounded-xl bg-ink-50 py-2"><dt className="text-[11px] text-ink-500">Delivered</dt><dd className="text-lg font-bold tabular">{run.summary.delivered}</dd></div>
            <div className="rounded-xl bg-sand-50 py-2"><dt className="text-[11px] text-sand-700">Cash to collect</dt><dd className="text-sm font-bold tabular leading-7">{formatMoney(run.summary.cashToCollectMinor, cur)}</dd></div>
          </dl>
        ) : null}
      </header>

      <main className="mx-auto max-w-xl space-y-5 px-4 py-4">
        {error ? <p className="rounded-xl bg-danger-50 px-4 py-3 text-sm text-danger-600" role="alert">{error}</p> : null}
        {offlineSince || pending ? (
          <div className="flex items-start gap-3 rounded-xl border border-sand-200 bg-sand-50 px-4 py-3 text-sm text-sand-700" role="status" data-testid="driver-offline">
            <WifiOff className="mt-0.5 size-5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              {offlineSince ? <p className="font-semibold">No connection — showing your run from {formatTime(offlineSince)}</p> : <p className="font-semibold">Back online</p>}
              {pending ? <p data-testid="driver-pending">{pending} step{pending === 1 ? '' : 's'} waiting to be sent. They go out by themselves when you have signal.</p> : <p>You can keep working; steps are saved on this phone.</p>}
            </div>
            {pending && !offlineSince ? <button type="button" className="btn-secondary btn-sm" onClick={() => void load()}>Send now</button> : null}
          </div>
        ) : null}
        {onTheWay ? (
          <button type="button" onClick={() => setSharing(!sharing)} aria-pressed={sharing}
            className={clsx('flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-start text-sm', sharing ? 'border-success-600 bg-success-50 text-success-700' : 'border-ink-200 bg-white text-ink-700')}>
            <LocateFixed className="size-5 shrink-0" aria-hidden />
            <span className="flex-1">{sharing ? 'Customers on your route can see where you are' : 'Share my location with the customers I am delivering to'}</span>
            <span className="font-semibold">{sharing ? 'On' : 'Off'}</span>
          </button>
        ) : null}

        {cash && (cash.inHandMinor !== '0' || cash.handovers.length) ? <CashCard cash={cash} onError={(e) => toast.error(errorMessage(e))} /> : null}

        {!run ? [0, 1].map((i) => <div key={i} className="skeleton h-48 rounded-2xl" />) : null}
        {run && run.jobs.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center">
            <CheckCircle2 className="mx-auto size-10 text-success-600" aria-hidden />
            <p className="mt-2 font-semibold">No deliveries for you right now</p>
            <p className="text-sm text-ink-500">New jobs appear here as soon as they are given to you.</p>
          </div>
        ) : null}

        {/* return pickups to collect come after today's open deliveries, before the finished ones */}
        {[...groups.filter((g) => g.key !== 'done'), { key: 'pickups' } as const, ...groups.filter((g) => g.key === 'done')].map((g) => {
          if (!('jobs' in g)) return <PickupCards key="pickups" pickups={pickups} onChanged={() => void load()} />;
          const cards = (
            <ul className="space-y-3">
              {g.jobs.map((j) => (
                <li key={j.id}>
                  <JobCard job={j} busy={busy === j.id}
                    onPickup={() => step(j, 'pickup', `${j.orderNumber} picked up`)}
                    onStart={() => step(j, 'out-for-delivery', `${j.orderNumber}: on the way`)}
                    onDeliver={() => setDeliver(j)}
                    onRefuse={() => setRefuse(j)}
                    onFail={() => setFail(j)} />
                </li>
              ))}
            </ul>
          );
          // finished jobs stay out of the way (a full day can be dozens): one tap to see them
          return g.key === 'done' ? (
            <details key={g.key} className="group" data-testid="driver-done">
              <summary className="mb-2 cursor-pointer list-none px-1 text-xs font-semibold tracking-wide text-ink-500 uppercase">
                {g.label} · {g.jobs.length} <span className="normal-case tracking-normal text-brand-700 group-open:hidden">· show</span>
              </summary>
              {cards}
            </details>
          ) : (
            <section key={g.key} aria-label={g.label}>
              <h2 className="mb-2 px-1 text-xs font-semibold tracking-wide text-ink-500 uppercase">{g.label} · {g.jobs.length}</h2>
              {cards}
            </section>
          );
        })}
        {run && run.summary.delivered > 0 ? (
          <p className="text-center text-xs text-ink-500">Cash collected today: <strong className="tabular">{formatMoney(run.summary.cashCollectedMinor, cur)}</strong></p>
        ) : null}
      </main>

      <DeliverDialog job={deliver} queue={queue} onClose={() => setDeliver(null)} onDone={() => { setDeliver(null); void load(); }} />
      <RefuseItemsDialog key={refuse?.id ?? 'none'} job={refuse} onClose={() => setRefuse(null)} onDone={() => { setRefuse(null); void load(); }} />
      <FailDialog job={fail} queue={queue} onClose={() => setFail(null)} onDone={() => { setFail(null); void load(); }} />
    </div>
  );
}

function groupBySlot(jobs: Job[]) {
  const out: { key: string; label: string; jobs: Job[] }[] = [];
  for (const j of jobs) {
    const done = DONE.includes(j.status);
    const key = done ? 'done' : j.slot ? `${j.slot.start}` : 'any';
    const label = done ? 'Finished today' : j.slot ? `${formatTime(j.slot.start)}–${formatTime(j.slot.end)}` : 'Any time today';
    const g = out.find((x) => x.key === key);
    if (g) g.jobs.push(j); else out.push({ key, label, jobs: [j] });
  }
  return out;
}

function JobCard({ job: j, busy, onPickup, onStart, onDeliver, onFail, onRefuse }: { job: Job; busy: boolean; onPickup: () => void; onStart: () => void; onDeliver: () => void; onFail: () => void; onRefuse: () => void }) {
  const a = j.address;
  const done = DONE.includes(j.status);
  const phone = j.customer.phone?.replace(/[^\d+]/g, '') ?? '';
  return (
    <article className={clsx('overflow-hidden rounded-2xl border bg-white', done ? 'border-ink-100 opacity-80' : 'border-ink-200')} data-testid="driver-job">
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-ink-500">{j.orderNumber}</p>
            <p className="truncate text-base font-bold text-ink-900">{j.customer.name ?? 'Customer'}</p>
          </div>
          <span className={clsx('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold', STATUS[j.status].tone)}>{STATUS[j.status].label}</span>
        </div>

        <p className="flex items-start gap-2 text-sm text-ink-800">
          <MapPin className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />
          <span>
            {[a.zone && `Zone ${a.zone}`, a.street && `Street ${a.street}`, a.building && `Building ${a.building}`, a.unit].filter(Boolean).join(' · ') || a.line1 || '—'}
            {a.city ? <span className="text-ink-500"> · {a.city}</span> : null}
          </span>
        </p>
        {j.note ? <p className="rounded-lg bg-sand-50 px-3 py-2 text-sm text-sand-700">“{j.note}”</p> : null}

        <p className="flex items-start gap-2 text-sm text-ink-600">
          <Package className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />
          <span className="line-clamp-2">{j.items.map((i) => `${i.quantity}× ${i.title}`).join(', ')}</span>
        </p>
        {j.status === 'ASSIGNED' && j.pickup.name ? <p className="text-xs text-ink-500">Pick up at <strong className="text-ink-700">{j.pickup.name}</strong>{j.pickup.place ? ` · ${j.pickup.place}` : ''}</p> : null}

        {j.cash ? (
          <p className={clsx('flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold', j.status === 'DELIVERED' ? 'bg-ink-50 text-ink-600' : 'bg-sand-100 text-sand-700')} data-testid="job-cash">
            <Banknote className="size-5" aria-hidden />
            {j.status === 'DELIVERED' ? 'Collected' : 'Collect cash'} {formatMoney(j.cash.amountMinor, j.cash.currencyCode)}
          </p>
        ) : !done ? <p className="text-xs font-medium text-success-700">Paid online — nothing to collect</p> : null}

        {j.status === 'DELIVERED' ? <p className="flex items-center gap-1.5 text-sm text-success-700"><CheckCircle2 className="size-4" aria-hidden />Delivered {formatTime(j.deliveredAt)}{j.hasPhoto ? ' · photo saved' : ''}</p> : null}
        {j.status === 'FAILED' && j.failureReason ? <p className="text-sm text-danger-600">Not delivered: {j.failureReason}</p> : null}
      </div>

      {!done || j.status === 'FAILED' ? (
        <div className="grid grid-cols-3 border-t border-ink-100 text-sm">
          <a href={phone ? `tel:${phone}` : undefined} className="flex items-center justify-center gap-1.5 py-3 font-medium text-ink-700 hover:bg-ink-50 aria-disabled:opacity-40" aria-disabled={!phone}><Phone className="size-4" aria-hidden />Call</a>
          <a href={phone ? `https://wa.me/${phone.replace('+', '')}` : undefined} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 border-x border-ink-100 py-3 font-medium text-ink-700 hover:bg-ink-50 aria-disabled:opacity-40" aria-disabled={!phone}><MessageCircle className="size-4" aria-hidden />WhatsApp</a>
          <a href={a.mapUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 py-3 font-medium text-ink-700 hover:bg-ink-50" data-testid="job-map"><Navigation className="size-4" aria-hidden />Map</a>
        </div>
      ) : null}

      {!done || j.status === 'FAILED' ? (
        <div className="flex flex-wrap gap-2 border-t border-ink-100 bg-ink-25 p-3">
          {j.status === 'ASSIGNED' ? <button type="button" className="btn-primary py-3 text-base flex-1" disabled={busy} onClick={onPickup} data-testid="job-pickup">{busy ? <Spinner /> : <Package className="size-5" aria-hidden />}Picked up</button> : null}
          {j.status === 'PICKED_UP' || j.status === 'IN_TRANSIT' ? <button type="button" className="btn-primary py-3 text-base flex-1" disabled={busy} onClick={onStart} data-testid="job-start">{busy ? <Spinner /> : <Truck className="size-5" aria-hidden />}Start delivery</button> : null}
          {j.status === 'OUT_FOR_DELIVERY' ? (
            <>
              <button type="button" className="btn-secondary py-3 text-base" onClick={onFail} data-testid="job-fail"><XCircle className="size-5" aria-hidden />Problem</button>
              {j.items.length > 1 || j.items.some((i) => i.quantity > 1) ? <button type="button" className="btn-ghost order-last basis-full py-2 text-sm" onClick={onRefuse} data-testid="job-refuse">Customer refused some items</button> : null}
              <button type="button" className="btn-primary py-3 text-base flex-1" onClick={onDeliver} data-testid="job-deliver"><CheckCircle2 className="size-5" aria-hidden />Delivered</button>
            </>
          ) : null}
          {j.status === 'FAILED' ? <button type="button" className="btn-secondary py-3 text-base flex-1" disabled={busy} onClick={onStart} data-testid="job-retry">{busy ? <Spinner /> : <RotateCcw className="size-5" aria-hidden />}Try again</button> : null}
        </div>
      ) : null}
    </article>
  );
}

function DeliverDialog({ job, queue, onClose, onDone }: { job: Job | null; queue: Queue; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setCode(''); setName(''); setPhoto(null); setError(''); }, [job]);
  useEffect(() => {
    if (!photo) { setPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!job || !/^\d{4}$/.test(code)) { setError('Ask the customer for the 4-digit code from their order'); return; }
    setBusy(true); setError('');
    try {
      const form = new FormData();
      form.append('code', code);
      if (name.trim()) form.append('recipientName', name.trim());
      if (photo) form.append('photo', await shrinkPhoto(photo), 'doorstep.jpg');
      await api(`/courier/jobs/${job.id}/deliver`, { method: 'POST', body: form });
      toast.success(`${job.orderNumber} delivered`);
      onDone();
    } catch (err) {
      if (isOffline(err)) {
        // the code is checked when the phone is back online (the photo is not kept offline)
        queue(job, 'deliver', { code, ...(name.trim() && { recipientName: name.trim() }) });
        onClose();
        return;
      }
      setError(err instanceof ApiError && err.status === 400 && /code/i.test(err.message) ? 'That code is not right. Check it with the customer.' : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!job} onClose={onClose} title="Confirm delivery" description={job ? `${job.orderNumber} · ${job.customer.name ?? ''}` : undefined}>
      <form onSubmit={submit} className="space-y-4" id="deliver-form">
        {job?.cash ? <p className="rounded-xl bg-sand-100 px-3 py-2 text-sm font-semibold text-sand-700">Collect {formatMoney(job.cash.amountMinor, job.cash.currencyCode)} in cash first</p> : null}
        <label className="block">
          <span className="label">Customer’s delivery code</span>
          <input className="input text-center font-mono text-2xl tracking-[0.5em]" inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))} autoFocus aria-describedby="code-hint" data-testid="deliver-code" />
          <span id="code-hint" className="mt-1 block text-xs text-ink-500">The customer sees it on their order page and in their messages.{typeof navigator !== 'undefined' && !navigator.onLine ? ' No signal now: the code is checked when you are back online — make sure it is right.' : ''}</span>
        </label>
        <label className="block">
          <span className="label">Received by <span className="font-normal text-ink-400">(optional)</span></span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="e.g. the customer, a family member, the guard" />
        </label>
        <div>
          <span className="label">Doorstep photo <span className="font-normal text-ink-400">(optional, only staff see it)</span></span>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-ink-300 p-3 text-sm text-ink-600 hover:border-brand-500">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {preview ? <img src={preview} alt="" className="size-14 rounded-lg object-cover" /> : <Camera className="size-6 text-ink-400" aria-hidden />}
            <span>{photo ? 'Change photo' : 'Take a photo'}</span>
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} data-testid="deliver-photo" />
          </label>
        </div>
        {error ? <p className="text-sm text-danger-600" role="alert">{error}</p> : null}
        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>Back</button>
          <button type="submit" className="btn-primary flex-[2]" disabled={busy} data-testid="deliver-submit">{busy ? <Spinner /> : null} Confirm delivered</button>
        </div>
      </form>
    </Dialog>
  );
}

/** One position reading for proof of a failed attempt (where the driver was). Null if refused or not available in time. */
function currentPosition(timeout = 8000): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 60_000 },
    );
  });
}

function FailDialog({ job, queue, onClose, onDone }: { job: Job | null; queue: Queue; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setReason(''); setOther(''); setPhoto(null);
    if (!job) return;
    // proof that the driver was at the door: the phone's position is saved with the attempt
    let live = true;
    setPos('loading');
    void currentPosition().then((p) => live && setPos(p));
    return () => { live = false; };
  }, [job]);
  useEffect(() => {
    if (!photo) { setPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  const text = reason === 'other' ? other.trim() : reason;

  async function submit() {
    if (!job || text.length < 3) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('reason', text);
      // "refused" counts towards switching cash on delivery off for that customer
      if (reason === REFUSED) form.append('refused', 'true');
      const here = pos === 'loading' ? await currentPosition(3000) : pos;
      if (here) { form.append('lat', String(here.lat)); form.append('lng', String(here.lng)); }
      if (photo) form.append('photo', await shrinkPhoto(photo), 'door.jpg');
      await api(`/courier/jobs/${job.id}/fail`, { method: 'POST', body: form });
      toast.success(reason === REFUSED ? 'Saved. Bring the parcel back.' : 'Saved. The customer was told and can pick a new time.');
      onDone();
    } catch (e) {
      if (isOffline(e)) {
        const here = pos !== 'loading' ? pos : null;
        queue(job, 'fail', { reason: text, ...(reason === REFUSED && { refused: 'true' }), ...(here && { lat: String(here.lat), lng: String(here.lng) }) });
        onClose();
        return;
      }
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!job} onClose={onClose} title="Could not deliver" description={job?.orderNumber}
      footer={<>
        <button type="button" className="btn-secondary" onClick={onClose}>Back</button>
        <button type="button" className="btn-danger" disabled={busy || text.length < 3} onClick={submit} data-testid="fail-submit">{busy ? <Spinner /> : null} Save</button>
      </>}>
      <fieldset className="space-y-2">
        <legend className="label">What happened?</legend>
        {[...FAIL_REASONS, 'other'].map((r) => (
          <label key={r} className={clsx('flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm', reason === r ? 'border-brand-600 bg-brand-50' : 'border-ink-200')}>
            <input type="radio" name="fail-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-brand-600" />
            {r === 'other' ? 'Something else' : r}
          </label>
        ))}
        {reason === 'other' ? <input className="input" value={other} onChange={(e) => setOther(e.target.value)} maxLength={300} placeholder="Tell operations what happened" autoFocus /> : null}
      </fieldset>
      <div className="mt-4">
        <span className="label">Photo of the door or building <span className="font-normal text-ink-400">(recommended)</span></span>
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-ink-300 p-3 text-sm text-ink-600 hover:border-brand-500">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt="" className="size-14 rounded-lg object-cover" /> : <Camera className="size-6 text-ink-400" aria-hidden />}
          <span>{photo ? 'Change photo' : 'Take a photo'}</span>
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} data-testid="fail-photo" />
        </label>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-500" data-testid="fail-location">
        <LocateFixed className="size-3.5" aria-hidden />
        {pos === 'loading' ? 'Getting your location…' : pos ? 'Your location is saved with this attempt.' : 'Location is off — turn it on so the attempt can be checked.'}
      </p>
    </Dialog>
  );
}

/** While switched on: sends the phone's position for the jobs on the way, at most every 45 s. */
function useLiveLocation(on: boolean, jobIds: string[], onDenied: () => void) {
  const last = useRef(0);
  const ids = jobIds.join(',');
  useEffect(() => {
    if (!on || !ids || !('geolocation' in navigator)) return;
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        if (Date.now() - last.current < 45_000) return;
        last.current = Date.now();
        for (const id of ids.split(',')) {
          void api(`/courier/jobs/${id}/location`, { method: 'POST', body: { lat: p.coords.latitude, lng: p.coords.longitude } }).catch(() => undefined);
        }
      },
      () => onDenied(),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [on, ids, onDenied]);
}

