'use client';

import { useEffect, useState } from 'react';
import { Card, Checkbox, ErrorState, Loading, MoneyField, PageHeader, Spinner, Switch, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { CartRemindersCard } from './CartRemindersCard';
import { CodRulesCard } from './CodRulesCard';
import { SeoSettingsCard } from './SeoSettingsCard';
import { DeliverySlotsCard } from './DeliverySlotsCard';
import { IntegrationsCard } from './IntegrationsCard';
import { decimalToMinor, minorToInput, paymentMethodLabel } from '@/lib/format';
import { useToast } from '@/lib/state/toast';
import { useAction, useApi } from '@/lib/use-api';

interface Country {
  code: string;
  name: string;
  currencyCode: string;
  vatRateBps: number;
  pricesIncludeTax: boolean;
  paymentMethods: string[];
  deliveryConfig: { label?: string; flatFeeMinor?: string; freeOverMinor?: string | null } | null;
  legalSettings: Record<string, unknown> | null;
  isActive: boolean;
  guestCheckout: boolean;
  deliverySlots?: unknown;
  cartReminders?: unknown;
  codRules?: unknown;
  seoSettings?: unknown;
}

const METHODS = ['CARD', 'APPLE_PAY', 'GOOGLE_PAY', 'COD', 'PAYLATER'];
const LEGAL: { key: string; label: string; hint?: string; type?: string }[] = [
  { key: 'companyName', label: 'Company legal name', hint: 'Printed on invoices, e.g. FastMoveX Trading W.L.L.' },
  { key: 'commercialRegNo', label: 'Commercial registration (CR) no.' },
  { key: 'taxNumber', label: 'Tax number', hint: 'Leave empty while no VAT applies in Qatar' },
  { key: 'address', label: 'Company address' },
  { key: 'supportEmail', label: 'Customer support email', type: 'email' },
  { key: 'supportPhone', label: 'Customer support phone' },
  { key: 'whatsapp', label: 'WhatsApp number for customers', hint: 'e.g. +974 4400 1234 — shows a “Chat on WhatsApp” button on the website' },
  { key: 'termsUrl', label: 'Terms & conditions link', hint: 'Leave empty to use the Terms page from Pages' },
  { key: 'privacyUrl', label: 'Privacy policy link', hint: 'Leave empty to use the Privacy page from Pages' },
];

interface Form {
  vat: string;
  pricesIncludeTax: boolean;
  methods: string[];
  label: string;
  fee: string;
  freeOver: string;
  freeEnabled: boolean;
  legal: Record<string, string>;
  isActive: boolean;
  guestCheckout: boolean;
}

function formOf(c: Country): Form {
  const legal: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.legalSettings ?? {})) if (typeof v === 'string') legal[k] = v;
  return {
    vat: String(c.vatRateBps / 100),
    pricesIncludeTax: c.pricesIncludeTax,
    methods: c.paymentMethods,
    label: c.deliveryConfig?.label ?? 'Standard delivery',
    fee: minorToInput(c.deliveryConfig?.flatFeeMinor ?? '0'),
    freeOver: minorToInput(c.deliveryConfig?.freeOverMinor ?? null),
    freeEnabled: !!c.deliveryConfig?.freeOverMinor,
    legal,
    isActive: c.isActive,
    guestCheckout: c.guestCheckout ?? true,
  };
}

function gatewayNote(provider: string | null | undefined): string {
  if (provider === 'dibsy') return 'Card payments go through Dibsy: customers see one option, “Card, Apple Pay or Google Pay”, and choose on Dibsy’s secure page (Visa, Mastercard, Himyan debit, Apple Pay, Google Pay). Keep “Credit or debit card” ticked; the Apple Pay and Google Pay ticks are not needed.';
  if (provider === 'test') return 'No payment gateway is connected: card payments use the test sandbox (no real money). Set DIBSY_SECRET_KEY on the server to take real payments.';
  return 'No payment gateway is connected, so only cash on delivery is offered. Set DIBSY_SECRET_KEY on the server to take card payments.';
}

/** Business settings per market: delivery fees, VAT, payment methods and the company details on invoices. */
export function SettingsPage() {
  const toast = useToast();
  const countries = useApi<Country[]>('/admin/countries');
  const markets = useApi<{ code: string; cardProvider?: string | null }[]>('/markets');
  const [code, setCode] = useState('QA');
  const [form, setForm] = useState<Form | null>(null);
  const { busy, run } = useAction();
  const country = countries.data?.find((c) => c.code === code);

  useEffect(() => {
    if (country) setForm(formOf(country));
  }, [country]);

  if (countries.error) return <ErrorState error={countries.error} onRetry={countries.reload} />;
  if (!countries.data || !form || !country) return <Loading />;
  const cur = country.currencyCode;

  async function save() {
    if (!form || !country) return;
    const vat = Number(form.vat);
    if (!(vat >= 0 && vat <= 50)) return toast.error('VAT must be between 0 and 50%');
    const fee = decimalToMinor(form.fee || '0');
    if (fee === null) return toast.error('Delivery fee is not a valid amount');
    const freeOver = form.freeEnabled ? decimalToMinor(form.freeOver) : null;
    if (form.freeEnabled && !freeOver) return toast.error('Enter the free-delivery amount');
    if (form.methods.length === 0) return toast.error('Keep at least one payment method');
    const legal: Record<string, string> = { ...Object.fromEntries(Object.entries(country.legalSettings ?? {}).filter(([, v]) => typeof v === 'string')) as Record<string, string> };
    for (const f of LEGAL) {
      const v = (form.legal[f.key] ?? '').trim();
      if (v) legal[f.key] = v;
      else delete legal[f.key];
    }
    for (const k of ['termsUrl', 'privacyUrl']) if (legal[k] && !/^(\/|https:\/\/)/.test(legal[k])) return toast.error('Links must start with / or https://');
    const r = await run('save', () => api(`/admin/countries/${country.code}`, {
      method: 'PATCH',
      body: {
        vatRateBps: Math.round(vat * 100),
        pricesIncludeTax: form.pricesIncludeTax,
        paymentMethods: form.methods,
        deliveryConfig: { label: form.label.trim() || 'Standard delivery', flatFeeMinor: fee, freeOverMinor: freeOver },
        legalSettings: legal,
        isActive: form.isActive,
        guestCheckout: form.guestCheckout,
      },
    }), 'Settings saved. The website shows them within a minute.');
    if (r !== undefined) countries.reload();
  }

  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));

  return (
    <>
      <PageHeader
        title="Store & delivery"
        description="Applies to new orders. Orders already placed keep the fees and prices they were placed with."
        actions={
          countries.data.length > 1 ? (
            <select className="input w-auto" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Market">
              {countries.data.map((c) => <option key={c.code} value={c.code}>{c.name}{c.isActive ? '' : ' (closed)'}</option>)}
            </select>
          ) : null
        }
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Delivery" description="Charged once per shipment.">
          <div className="space-y-4">
            <TextField label="Name shown at checkout" value={form.label} onChange={(e) => set({ label: e.target.value })} maxLength={60} />
            <MoneyField label="Delivery fee" currency={cur} value={form.fee} onChange={(e) => set({ fee: e.target.value })} hint="0 = always free" />
            <Switch checked={form.freeEnabled} onChange={(freeEnabled) => set({ freeEnabled })} label="Free delivery above an amount" />
            {form.freeEnabled ? <MoneyField label="Free delivery for orders from" currency={cur} value={form.freeOver} onChange={(e) => set({ freeOver: e.target.value })} hint="Goods total after discounts" /> : null}
          </div>
        </Card>
        <Card title="Payments & tax">
          <div className="space-y-4">
            <fieldset>
              <legend className="label">Payment methods offered</legend>
              <div className="grid grid-cols-2 gap-2">
                {METHODS.map((m) => (
                  <Checkbox key={m} label={paymentMethodLabel(m)} checked={form.methods.includes(m)} onChange={(e) => set({ methods: e.target.checked ? [...form.methods, m] : form.methods.filter((x) => x !== m) })} />
                ))}
              </div>
              <p className="hint">{gatewayNote(markets.data?.find((m) => m.code === country.code)?.cardProvider)}</p>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="VAT (%)" inputMode="decimal" value={form.vat} onChange={(e) => set({ vat: e.target.value })} hint="Qatar: 0 today" />
              <div className="sm:pt-6"><Switch checked={form.pricesIncludeTax} onChange={(pricesIncludeTax) => set({ pricesIncludeTax })} label="Prices include VAT" /></div>
            </div>
          </div>
        </Card>
        <Card title="Company details" description="On invoices and the website." className="xl:col-span-2">
          <div className="grid gap-4 md:grid-cols-2">
            {LEGAL.map((f) => (
              <TextField key={f.key} label={f.label} hint={f.hint} type={f.type} value={form.legal[f.key] ?? ''} onChange={(e) => set({ legal: { ...form.legal, [f.key]: e.target.value } })} maxLength={300} />
            ))}
          </div>
        </Card>
        <IntegrationsCard />
        <DeliverySlotsCard countryCode={country.code} stored={country.deliverySlots} onSaved={countries.reload} />
        <CartRemindersCard countryCode={country.code} currency={cur} stored={country.cartReminders} onSaved={countries.reload} />
        <CodRulesCard countryCode={country.code} currency={cur} stored={country.codRules} onSaved={countries.reload} />
        <SeoSettingsCard countryCode={country.code} stored={country.seoSettings} onSaved={countries.reload} />
        <Card title="Checkout">
          <Switch checked={form.guestCheckout} onChange={(guestCheckout) => set({ guestCheckout })} label="Allow guest checkout" description="Shoppers can order with just a name, email and phone. They get a link to track the order and can create an account later with the same email." />
        </Card>
        <Card title="Market">
          <Switch checked={form.isActive} onChange={(isActive) => set({ isActive })} label={`Open for orders in ${country.name}`} description="Closing it stops new orders in this market. The website stays online." />
        </Card>
      </div>
      <div className="no-print sticky bottom-0 z-10 -mx-4 mt-6 flex justify-end gap-2 border-t border-ink-100 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <button type="button" className="btn-ghost" onClick={() => setForm(formOf(country))}>Discard</button>
        <button type="button" className="btn-primary" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? <Spinner /> : null} Save settings</button>
      </div>
    </>
  );
}
