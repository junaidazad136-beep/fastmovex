'use client';

import { CheckCircle2, CircleDashed } from 'lucide-react';
import { Card } from '@/components/ui';
import { useApi } from '@/lib/use-api';

interface Integrations { payments: string | null; email: boolean; sms: boolean; whatsapp: boolean; push: boolean }

/** Which outside services the server is connected to. Keys live on the server, never in the panel. */
export function IntegrationsCard() {
  const s = useApi<Integrations>('/admin/countries/integrations');
  if (!s.data) return null;
  const d = s.data;
  const rows: [string, boolean, string][] = [
    ['Card payments', d.payments === 'dibsy', d.payments === 'dibsy' ? 'Dibsy — cards, Himyan, Apple Pay, Google Pay' : d.payments === 'test' ? 'Test sandbox only (no real money)' : 'Not connected — cash on delivery only'],
    ['Email', d.email, d.email ? 'Order and account emails are sent' : 'Not connected (RESEND_API_KEY)'],
    ['WhatsApp', d.whatsapp, d.whatsapp ? 'Order updates to customers who opted in' : 'Not connected (WhatsApp Cloud API keys)'],
    ['SMS', d.sms, d.sms ? 'Sign-in codes and delivery-day messages' : 'Not connected (Twilio)'],
  ];
  return (
    <Card title="Connected services" description="Set on the server by your developer. Shown here so you know what customers receive." className="xl:col-span-2">
      <ul className="grid gap-2 sm:grid-cols-2" data-testid="integrations">
        {rows.map(([name, on, text]) => (
          <li key={name} className="flex items-start gap-2.5 rounded-lg border border-ink-100 px-3 py-2.5 text-sm">
            {on ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-600" aria-hidden /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />}
            <span><span className="block font-medium text-ink-900">{name}</span><span className="block text-xs text-ink-500">{text}</span></span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
