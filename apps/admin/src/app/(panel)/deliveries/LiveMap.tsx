'use client';

import 'leaflet/dist/leaflet.css';
import clsx from 'clsx';
import { Banknote, MapPin, Phone, RefreshCw, Truck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { useConfig } from '@/components/layout/Providers';
import { Badge, Card, EmptyState, ErrorState, Spinner, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatMoney, formatSlot, initials, timeAgo } from '@/lib/format';

interface LiveJob {
  id: string; status: string; orderNumber: string; recipient: string | null; zone: string | null;
  slotStart: string | null; slotEnd: string | null; pin: { lat: number; lng: number } | null; late: boolean;
}
interface LiveDriver {
  id: string; name: string; phone: string | null; cashInHandMinor: string; onTheRoad: boolean;
  location: { lat: number; lng: number; at: string; stale: boolean } | null;
  jobs: LiveJob[];
}
interface Live { at: string; drivers: LiveDriver[]; waitingForDriver: number }

/** Each driver keeps one colour on the map and in the list. */
const COLOURS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#db2777', '#65a30d'];
const REFRESH_MS = 30_000;
/** Doha, when nobody has a position yet. */
const HOME: [number, number] = [25.2854, 51.531];

/** Where the drivers are now, their open jobs and the customers' pins. Refreshes every 30 seconds while visible. */
export function LiveMap() {
  const [data, setData] = useState<Live>();
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);

  async function load() {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    setLoading(true);
    try {
      setData(await api<Live>('/admin/deliveries/live'));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    const onShow = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onShow);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onShow); };
  }, []);

  const colour = useMemo(() => new Map(data?.drivers.map((d, i) => [d.id, COLOURS[i % COLOURS.length]]) ?? []), [data]);
  const located = data?.drivers.filter((d) => d.location).length ?? 0;

  return (
    <div className="grid gap-0 lg:grid-cols-[1fr_360px]" data-testid="live-map">
      <div className="relative min-h-[420px] border-b border-ink-100 lg:min-h-[600px] lg:border-e lg:border-b-0">
        {data ? <MapCanvas data={data} colour={colour} focus={focus} /> : <div className="flex h-full min-h-[420px] items-center justify-center text-ink-400"><Spinner className="size-6" /></div>}
        <div className="pointer-events-none absolute start-14 top-3 z-[500] flex flex-wrap gap-2">
          <span className="pointer-events-auto rounded-lg bg-white/95 px-2.5 py-1 text-xs font-medium text-ink-700 shadow-sm">
            {located} of {data?.drivers.length ?? 0} drivers sharing location
          </span>
          {data?.waitingForDriver ? (
            <span className="pointer-events-auto rounded-lg bg-warning-50 px-2.5 py-1 text-xs font-semibold text-warning-700 shadow-sm">{data.waitingForDriver} waiting for a driver</span>
          ) : null}
        </div>
      </div>
      <div className="max-h-[600px] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5 text-xs text-ink-500">
          <span>Updated {data ? timeAgo(data.at) : '…'} · every 30 s</span>
          <button type="button" className="btn-ghost btn-sm" onClick={() => void load()} disabled={loading} aria-label="Refresh now">
            {loading ? <Spinner /> : <RefreshCw className="size-3.5" aria-hidden />}
          </button>
        </div>
        {error ? <ErrorState error={error} onRetry={() => void load()} /> : null}
        {data?.drivers.length === 0 ? <EmptyState title="No drivers yet" description="Add a staff account with the Delivery Agent role." /> : null}
        <ul className="divide-y divide-ink-100">
          {data?.drivers.map((d) => (
            <li key={d.id} data-testid="live-driver">
              <button type="button" onClick={() => setFocus(focus === d.id ? null : d.id)} className={clsx('w-full px-4 py-3 text-start hover:bg-ink-50', focus === d.id && 'bg-brand-50/60')}>
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: d.location?.stale || !d.location ? '#9ca3af' : colour.get(d.id) }} aria-hidden>{initials(d.name)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink-900">{d.name}</p>
                    <p className="text-xs text-ink-500">
                      {d.location ? (d.location.stale ? `Last seen ${timeAgo(d.location.at)}` : `Live · ${timeAgo(d.location.at)}`) : 'No location shared'}
                      {d.onTheRoad ? ' · on the road' : ''}
                    </p>
                  </div>
                  <span className="text-end text-xs text-ink-500">
                    <Truck className="me-1 inline size-3.5" aria-hidden />{d.jobs.length}
                    {BigInt(d.cashInHandMinor) > 0n ? <span className="mt-0.5 block font-medium text-ink-700"><Banknote className="me-1 inline size-3.5" aria-hidden />{formatMoney(d.cashInHandMinor)}</span> : null}
                  </span>
                </div>
              </button>
              {focus === d.id ? (
                <div className="space-y-2 bg-ink-50/60 px-4 pb-3" data-testid="live-driver-jobs">
                  {d.phone ? <a href={`tel:${d.phone}`} className="btn-ghost btn-sm -ms-2"><Phone className="size-3.5" aria-hidden />{d.phone}</a> : null}
                  {d.jobs.length === 0 ? <p className="text-xs text-ink-500">No open jobs.</p> : null}
                  {d.jobs.map((j, i) => (
                    <div key={j.id} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: colour.get(d.id) }}>{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <Link href={`/orders/${j.orderNumber}`} className="font-mono text-xs font-semibold hover:text-brand-700">{j.orderNumber}</Link>
                        <p className="truncate text-xs text-ink-600">{j.recipient ?? '—'}{j.zone ? ` · Zone ${j.zone}` : ''}{j.pin ? '' : ' · no map pin'}</p>
                        <p className="text-xs text-ink-500">{formatSlot(j.slotStart, j.slotEnd) || 'Any time'}{j.late ? <Badge tone="red" className="ms-1.5">Late</Badge> : null}</p>
                      </div>
                      <StatusBadge status={j.status} />
                    </div>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The Leaflet map. Loaded in the browser only; markers are redrawn on every refresh, the view only moves on focus. */
function MapCanvas({ data, colour, focus }: { data: Live; colour: Map<string, string>; focus: string | null }) {
  const { mapTileUrl, mapAttribution } = useConfig();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((mod) => {
      if (cancelled || !el.current || map.current) return;
      const lf = (mod.default ?? mod) as typeof Leaflet;
      L.current = lf;
      const m = lf.map(el.current, { zoomControl: true, attributionControl: true }).setView(HOME, 11);
      m.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
      if (mapTileUrl) lf.tileLayer(mapTileUrl, { maxZoom: 19, attribution: esc(mapAttribution) }).addTo(m);
      layer.current = lf.layerGroup().addTo(m);
      map.current = m;
      setReady(true);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, [mapTileUrl, mapAttribution]);

  useEffect(() => {
    const lf = L.current;
    const m = map.current;
    if (!ready || !lf || !m || !layer.current) return;
    layer.current.clearLayers();
    const points: [number, number][] = [];
    for (const d of data.drivers) {
      if (focus && d.id !== focus) continue;
      const c = colour.get(d.id) ?? '#2563eb';
      d.jobs.forEach((j, i) => {
        if (!j.pin) return;
        points.push([j.pin.lat, j.pin.lng]);
        lf.marker([j.pin.lat, j.pin.lng], {
          icon: lf.divIcon({
            className: '',
            html: `<span style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:9999px 9999px 9999px 2px;transform:rotate(-45deg);background:#fff;border:2px solid ${c};box-shadow:0 1px 3px rgba(0,0,0,.3)"><b style="transform:rotate(45deg);font:700 10px system-ui;color:${c}">${i + 1}</b></span>`,
            iconSize: [22, 22], iconAnchor: [3, 21],
          }),
          title: `${j.orderNumber} — ${j.recipient ?? ''}`,
        }).bindPopup(`<b>${esc(j.orderNumber)}</b><br>${esc(j.recipient ?? '')}${j.zone ? ` · Zone ${esc(j.zone)}` : ''}<br>${esc(d.name)} · ${esc(j.status.replace(/_/g, ' ').toLowerCase())}${j.late ? ' · <span style="color:#dc2626">late</span>' : ''}`).addTo(layer.current!);
      });
      if (d.location) {
        points.push([d.location.lat, d.location.lng]);
        const bg = d.location.stale ? '#9ca3af' : c;
        lf.marker([d.location.lat, d.location.lng], {
          zIndexOffset: 1000,
          icon: lf.divIcon({
            className: '',
            html: `<span style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9999px;background:${bg};color:#fff;font:700 11px system-ui;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)">${esc(initials(d.name))}</span>`,
            iconSize: [34, 34], iconAnchor: [17, 17],
          }),
          title: d.name,
        }).bindPopup(`<b>${esc(d.name)}</b><br>${d.location.stale ? 'Last seen' : 'Live'} ${esc(timeAgo(d.location.at))}<br>${d.jobs.length} open job(s)`).addTo(layer.current!);
      }
    }
    // fit once on first data, and whenever a driver is picked
    if (points.length && (!fitted.current || focus)) {
      m.fitBounds(lf.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
      fitted.current = true;
    }
  }, [data, colour, focus, ready]);

  return (
    <>
      <div ref={el} className="absolute inset-0 z-0 bg-ink-100" role="region" aria-label="Map of drivers and deliveries" />
      {!mapTileUrl ? <p className="absolute end-3 bottom-3 z-[500] flex items-center gap-1 rounded bg-white/90 px-2 py-1 text-xs text-ink-500"><MapPin className="size-3" aria-hidden />Background map is off (MAP_TILE_URL=none)</p> : null}
    </>
  );
}
