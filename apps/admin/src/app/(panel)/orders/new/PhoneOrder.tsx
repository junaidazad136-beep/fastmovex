'use client';

import { Minus, Phone, Plus, Search, Trash2, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { TagBadges } from '@/components/customers/tags';
import { summaryStale } from '@/components/layout/Shell';
import { Badge, Card, PageHeader, Spinner, TextArea, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatMoney, formatSlot } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';

interface Customer {
  id: string; fullName: string; phone: string | null; email: string | null; isGuest: boolean; tags: string[]; codBlocked: boolean; orders: number;
  addresses: { id: string; label: string | null; recipientName: string; phone: string; city: string; zone: string | null; street: string | null; building: string | null; unit: string | null; line1: string | null }[];
}
interface Product { variantId: string; sku: string; title: string; store: string; priceMinor: string; currencyCode: string; available: number; options: Record<string, string> | null }
interface Line extends Product { quantity: number }
interface Quote {
  customer: { isNew: boolean; fullName: string };
  cart: { coupon?: { code: string; applied: boolean; message?: string; discountMinor?: string } | null; lines?: { variantId: string; title?: string; quantity: number; unitPriceMinor: string; issues?: string[] }[]; totals: { subtotalMinor: string; discountMinor: string; deliveryFeeMinor: string; taxMinor: string; taxIncluded: boolean; totalMinor: string }; canCheckout: boolean; notices: { message?: string; code?: string }[] };
}
interface Slots { enabled: boolean; required: boolean; days: { date: string; slots: { start: string; end: string; left: number; available: boolean }[] }[] }

const addrLine = (a: Customer['addresses'][number]) => [a.unit, a.zone && `Zone ${a.zone}`, a.street && `Street ${a.street}`, a.building && `Bldg ${a.building}`, a.line1, a.city].filter(Boolean).join(', ');
const EMPTY = { recipientName: '', phone: '', city: 'Doha', zone: '', street: '', building: '', unit: '' };

/** Take an order on the phone: find or add the customer, add products, choose where and when, check the price, place it (cash on delivery). */
export function PhoneOrder() {
  const router = useRouter();
  const { busy, run } = useAction();
  // customer
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Customer[] | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [nc, setNc] = useState({ fullName: '', phone: '', email: '' });
  // items
  const [pq, setPq] = useState('');
  const [products, setProducts] = useState<Product[] | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  // delivery
  const [addressId, setAddressId] = useState<string>('');
  const [addr, setAddr] = useState(EMPTY);
  const [saveAddress, setSaveAddress] = useState(true);
  const [slot, setSlot] = useState('');
  const [note, setNote] = useState('');
  const [coupon, setCoupon] = useState('');
  const slots = useApi<Slots>('/delivery/slots');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [key] = useState(() => `phone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => setQuote(null), [lines, addressId, addr, customer, isNew, nc, coupon]);
  useEffect(() => {
    if (customer?.addresses.length) setAddressId(customer.addresses[0].id);
    else setAddressId('');
    if (customer) setAddr({ ...EMPTY, recipientName: customer.fullName, phone: customer.phone ?? '' });
  }, [customer]);
  useEffect(() => { if (isNew) setAddr((a) => ({ ...a, recipientName: a.recipientName || nc.fullName, phone: a.phone || nc.phone })); }, [isNew, nc.fullName, nc.phone]);

  async function searchCustomers(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 3) return;
    const r = await run('cust', () => api<Customer[]>(`/admin/phone-orders/customers?q=${encodeURIComponent(q.trim())}`));
    if (r) setFound(r);
  }
  async function searchProducts(e: React.FormEvent) {
    e.preventDefault();
    if (pq.trim().length < 3) return;
    const r = await run('prod', () => api<Product[]>(`/admin/phone-orders/products?q=${encodeURIComponent(pq.trim())}`));
    if (r) setProducts(r);
  }
  function add(p: Product) {
    setLines((ls) => (ls.some((l) => l.variantId === p.variantId) ? ls.map((l) => (l.variantId === p.variantId ? { ...l, quantity: Math.min(l.available, l.quantity + 1) } : l)) : [...ls, { ...p, quantity: 1 }]));
  }
  const body = useMemo(() => {
    const cust = customer ? { userId: customer.id } : { fullName: nc.fullName.trim(), phone: nc.phone.replace(/\s/g, ''), email: nc.email.trim() || undefined };
    const address = addressId ? undefined : Object.fromEntries(Object.entries(addr).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
    return { customer: cust, items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), addressId: addressId || undefined, address, saveAddress: !addressId && !!customer && !customer.isGuest && saveAddress, deliverySlot: slot || undefined, note: note.trim() || undefined, couponCode: coupon.trim() || undefined };
  }, [customer, nc, lines, addressId, addr, saveAddress, slot, note, coupon]);
  const ready = (customer || (isNew && nc.fullName.trim().length > 1 && /^\+\d{8,15}$/.test(nc.phone.replace(/\s/g, '')))) && lines.length > 0 && (addressId || (addr.recipientName && addr.phone && addr.city));

  async function check() {
    const r = await run('quote', () => api<Quote>('/admin/phone-orders/quote', { method: 'POST', body }));
    if (r) setQuote(r);
  }
  async function place() {
    const r = await run('place', () => api<{ orderNumber: string }>('/admin/phone-orders', { method: 'POST', body, headers: { 'Idempotency-Key': key } }), (x) => `Order ${x.orderNumber} placed`);
    if (r) { summaryStale(); router.push(`/orders/${r.orderNumber}`); }
  }
  const cur = lines[0]?.currencyCode ?? 'QAR';
  const windows = slots.data?.days.flatMap((d) => d.slots) ?? [];

  return (
    <>
      <PageHeader back={{ href: '/orders', label: 'Orders' }} title={<span className="flex items-center gap-2"><Phone className="size-5 text-ink-400" aria-hidden />Phone order</span>}
        description="An order taken on the phone or WhatsApp. Priced exactly like the website, paid cash on delivery; the customer gets the usual confirmation." />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Card title="1 · Customer">
            {customer ? (
              <div className="flex flex-wrap items-center gap-3" data-testid="chosen-customer">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{customer.fullName} <TagBadges tags={customer.tags} className="ms-1 align-middle" />{customer.codBlocked ? <Badge tone="red" className="ms-1">Cash blocked</Badge> : null}</p>
                  <p className="text-sm text-ink-600">{[customer.phone, customer.email, `${customer.orders} orders`].filter(Boolean).join(' · ')}</p>
                </div>
                <button type="button" className="btn-ghost btn-sm" onClick={() => { setCustomer(null); setFound(null); }}>Change</button>
              </div>
            ) : isNew ? (
              <div className="space-y-3" data-testid="new-customer">
                <div className="grid gap-3 sm:grid-cols-3">
                  <TextField label="Name" value={nc.fullName} onChange={(e) => setNc({ ...nc, fullName: e.target.value })} required />
                  <TextField label="Mobile" value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} placeholder="+974 5555 1234" required />
                  <TextField label="Email (optional)" type="email" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} />
                </div>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setIsNew(false)}>Search instead</button>
              </div>
            ) : (
              <div className="space-y-3">
                <form onSubmit={searchCustomers} className="flex gap-2">
                  <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mobile, email or name" aria-label="Find customer" />
                  <button type="submit" className="btn-secondary" disabled={busy === 'cust'}>{busy === 'cust' ? <Spinner /> : <Search className="size-4" aria-hidden />}Find</button>
                  <button type="button" className="btn-ghost" onClick={() => { setIsNew(true); setNc({ fullName: '', phone: /^\+?\d[\d\s]{6,}$/.test(q.trim()) ? q.trim() : '', email: '' }); }} data-testid="new-customer-btn"><UserPlus className="size-4" aria-hidden />New</button>
                </form>
                {found ? (
                  <ul className="divide-y divide-ink-100 rounded-lg border border-ink-100" data-testid="customer-results">
                    {found.map((c) => (
                      <li key={c.id}>
                        <button type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-start hover:bg-ink-50" onClick={() => setCustomer(c)}>
                          <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{c.fullName} <TagBadges tags={c.tags} className="ms-1" /></span><span className="block text-xs text-ink-500">{[c.phone, c.email].filter(Boolean).join(' · ')}</span></span>
                          <span className="text-xs text-ink-500">{c.orders} orders</span>
                        </button>
                      </li>
                    ))}
                    {found.length === 0 ? <li className="px-3 py-3 text-sm text-ink-500">Nobody found. Use “New” to add the caller.</li> : null}
                  </ul>
                ) : null}
              </div>
            )}
          </Card>

          <Card title="2 · Products">
            <form onSubmit={searchProducts} className="flex gap-2">
              <input className="input" value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Product name, SKU or barcode" aria-label="Find product" />
              <button type="submit" className="btn-secondary" disabled={busy === 'prod'}>{busy === 'prod' ? <Spinner /> : <Search className="size-4" aria-hidden />}Find</button>
            </form>
            {products ? (
              <ul className="mt-3 max-h-64 divide-y divide-ink-100 overflow-y-auto rounded-lg border border-ink-100" data-testid="product-results">
                {products.map((p) => (
                  <li key={p.variantId} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{p.title}</span><span className="block text-xs text-ink-500">{p.sku} · {p.store} · {p.available} free</span></span>
                    <span className="text-sm tabular">{formatMoney(p.priceMinor, p.currencyCode)}</span>
                    <button type="button" className="btn-secondary btn-sm" disabled={p.available < 1} onClick={() => add(p)} aria-label={`Add ${p.title}`}><Plus className="size-4" aria-hidden /></button>
                  </li>
                ))}
                {products.length === 0 ? <li className="px-3 py-3 text-sm text-ink-500">No product found.</li> : null}
              </ul>
            ) : null}
            {lines.length ? (
              <ul className="mt-4 divide-y divide-ink-100" data-testid="order-lines">
                {lines.map((l) => (
                  <li key={l.variantId} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{l.title}</span><span className="block text-xs text-ink-500">{l.sku} · {formatMoney(l.priceMinor, l.currencyCode)} each</span></span>
                    <button type="button" className="btn-secondary btn-sm px-2" onClick={() => setLines(lines.map((x) => (x.variantId === l.variantId ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x)))} aria-label="One fewer"><Minus className="size-3.5" aria-hidden /></button>
                    <span className="w-8 text-center text-sm font-semibold tabular">{l.quantity}</span>
                    <button type="button" className="btn-secondary btn-sm px-2" onClick={() => setLines(lines.map((x) => (x.variantId === l.variantId ? { ...x, quantity: Math.min(x.available, x.quantity + 1) } : x)))} aria-label="One more"><Plus className="size-3.5" aria-hidden /></button>
                    <button type="button" className="rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-danger-600" onClick={() => setLines(lines.filter((x) => x.variantId !== l.variantId))} aria-label={`Remove ${l.title}`}><Trash2 className="size-4" aria-hidden /></button>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm text-ink-500">No products yet.</p>}
          </Card>

          <Card title="3 · Delivery">
            {customer?.addresses.length ? (
              <fieldset className="mb-4 space-y-2">
                <legend className="mb-1 text-sm font-medium">Saved addresses</legend>
                {customer.addresses.map((a) => (
                  <label key={a.id} className="flex items-start gap-2 text-sm"><input type="radio" name="addr" checked={addressId === a.id} onChange={() => setAddressId(a.id)} className="mt-1" /> <span>{a.label ? <strong>{a.label}: </strong> : null}{addrLine(a)}</span></label>
                ))}
                <label className="flex items-center gap-2 text-sm"><input type="radio" name="addr" checked={addressId === ''} onChange={() => setAddressId('')} /> A new address</label>
              </fieldset>
            ) : null}
            {!addressId ? (
              <div className="grid gap-3 sm:grid-cols-2" data-testid="new-address">
                <TextField label="Recipient" value={addr.recipientName} onChange={(e) => setAddr({ ...addr, recipientName: e.target.value })} required />
                <TextField label="Phone" value={addr.phone} onChange={(e) => setAddr({ ...addr, phone: e.target.value })} required />
                <TextField label="City" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} required />
                <TextField label="Zone" value={addr.zone} onChange={(e) => setAddr({ ...addr, zone: e.target.value })} />
                <TextField label="Street" value={addr.street} onChange={(e) => setAddr({ ...addr, street: e.target.value })} />
                <TextField label="Building" value={addr.building} onChange={(e) => setAddr({ ...addr, building: e.target.value })} />
                <TextField label="Unit / flat" value={addr.unit} onChange={(e) => setAddr({ ...addr, unit: e.target.value })} />
                {customer && !customer.isGuest ? <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} /> Save to their address book</label> : null}
              </div>
            ) : null}
            {slots.data?.enabled ? (
              <label className="mt-4 block text-sm font-medium">Delivery time
                <select className="input mt-1" value={slot} onChange={(e) => setSlot(e.target.value)} data-testid="phone-slot">
                  <option value="">{slots.data.required ? 'Choose a window…' : 'Any time'}</option>
                  {windows.map((w) => <option key={w.start} value={w.start} disabled={!w.available}>{formatSlot(w.start, w.end)}{w.available ? ` · ${w.left} left` : ' (full)'}</option>)}
                </select>
              </label>
            ) : null}
            <TextArea label="Note for the driver (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className="mt-4" />
            <TextField label="Promo code (optional)" hint="Checked for this customer, same rules as the website" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} maxLength={40} className="mt-4 max-w-xs" data-testid="phone-coupon" />
          </Card>
        </div>

        <div className="min-w-0">
          <Card title="Summary" className="xl:sticky xl:top-20">
            {quote ? (
              <dl className="space-y-1.5 text-sm" data-testid="phone-quote">
                <div className="flex justify-between"><dt className="text-ink-600">Subtotal</dt><dd className="tabular">{formatMoney(quote.cart.totals.subtotalMinor, cur)}</dd></div>
                {BigInt(quote.cart.totals.discountMinor) > 0n ? <div className="flex justify-between"><dt className="text-ink-600">{quote.cart.coupon?.applied ? `Promo ${quote.cart.coupon.code}` : 'Deals'}</dt><dd className="tabular" data-testid="phone-discount">−{formatMoney(quote.cart.totals.discountMinor, cur)}</dd></div> : null}
                {quote.cart.coupon && !quote.cart.coupon.applied ? <p className="text-xs text-warning-700" data-testid="phone-coupon-note">{quote.cart.coupon.code}: {quote.cart.coupon.message}</p> : null}
                <div className="flex justify-between"><dt className="text-ink-600">Delivery</dt><dd className="tabular">{BigInt(quote.cart.totals.deliveryFeeMinor) === 0n ? 'Free' : formatMoney(quote.cart.totals.deliveryFeeMinor, cur)}</dd></div>
                <div className="flex justify-between border-t border-ink-100 pt-1.5 text-base font-semibold"><dt>Cash to collect</dt><dd className="tabular" data-testid="phone-total">{formatMoney(quote.cart.totals.totalMinor, cur)}</dd></div>
                {quote.customer.isNew ? <p className="pt-1 text-xs text-ink-500">A new customer profile is created for {quote.customer.fullName}.</p> : null}
                {quote.cart.notices.map((n, i) => <p key={i} className="text-xs text-warning-700">{n.message ?? n.code}</p>)}
              </dl>
            ) : <p className="text-sm text-ink-500">Check the price before placing the order.</p>}
            <div className="mt-4 flex flex-col gap-2">
              <button type="button" className="btn-secondary" disabled={!ready || busy === 'quote'} onClick={check} data-testid="phone-check">{busy === 'quote' ? <Spinner /> : null}Check price</button>
              <button type="button" className="btn-primary" disabled={!ready || !quote?.cart.canCheckout || busy === 'place'} onClick={place} data-testid="phone-place">{busy === 'place' ? <Spinner /> : null}Place order · cash on delivery</button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
