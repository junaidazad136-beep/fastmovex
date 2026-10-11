import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describeItems, isQuiet, parseReminderConfig, readReminderConfig, REMINDERS_OFF } from '../src/marketing/cart-reminders';
import { WhatsAppSender } from '../src/notifications/channels/senders';
import { NotificationsService } from '../src/notifications/notifications.service';
import { TEMPLATES } from '../src/notifications/templates';

const cfg = (v: Record<string, unknown>) => ({ get: (k: string) => v[k] }) as unknown as ConfigService<never, true>;
const cloud = cfg({ WHATSAPP_DRIVER: 'cloud', WHATSAPP_TOKEN: 'EAAG-test-token-123456789', WHATSAPP_PHONE_NUMBER_ID: '1234567890', WHATSAPP_API_URL: 'https://graph.example/v22.0' });

describe('WhatsApp sender', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('is off unless the Cloud API keys are set', () => {
    expect(new WhatsAppSender(cfg({ WHATSAPP_DRIVER: 'none' })).enabled()).toBe(false);
    expect(new WhatsAppSender(cfg({ WHATSAPP_DRIVER: 'cloud' })).enabled()).toBe(false);
    expect(new WhatsAppSender(cloud).enabled()).toBe(true);
  });

  it('sends an approved template with the parameters in order', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    global.fetch = jest.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{"messages":[{"id":"wamid.1"}]}', { status: 200 }); }) as never;
    await new WhatsAppSender(cloud).send({ to: '+974 5555 1234', title: 't', body: 'b', data: { whatsapp: { template: 'fastmovex_order_placed', lang: 'ar', params: ['Sara', 'FMX-QA-1', 'QAR 75.00', '  line\nbreak  '] } } });
    expect(calls[0].url).toBe('https://graph.example/v22.0/1234567890/messages');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer EAAG-test-token-123456789');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      messaging_product: 'whatsapp', to: '97455551234', type: 'template',
      template: { name: 'fastmovex_order_placed', language: { code: 'ar' }, components: [{ type: 'body', parameters: ['Sara', 'FMX-QA-1', 'QAR 75.00', 'line break'].map((text) => ({ type: 'text', text })) }] },
    });
  });

  it('empty parameters become "-" (the API refuses empty ones); bad numbers and API errors are reported', async () => {
    const bodies: unknown[] = [];
    global.fetch = jest.fn(async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ error: { code: 132000, message: 'Number of parameters does not match' } }), { status: 400 }); }) as never;
    const s = new WhatsAppSender(cloud);
    await expect(s.send({ to: '+97455551234', title: '', body: '', data: { whatsapp: { template: 'x', lang: 'en', params: ['', 'a'] } } })).rejects.toThrow('WhatsApp 132000: Number of parameters does not match');
    expect((bodies[0] as { template: { components: { parameters: { text: string }[] }[] } }).template.components[0].parameters[0].text).toBe('-');
    await expect(s.send({ to: 'abc', title: '', body: '', data: { whatsapp: { template: 'x', lang: 'en', params: [] } } })).rejects.toThrow('Not a valid WhatsApp number');
    await expect(s.send({ to: '+97455551234', title: '', body: '' })).rejects.toThrow('No WhatsApp template');
  });
});

describe('which channels a notification uses', () => {
  const sender = (on = true) => ({ enabled: () => on, send: jest.fn() });
  const build = (user: object, wa = true) => {
    const createMany = jest.fn();
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', locale: 'ar', email: 'a@b.qa', phone: '+97455551234', fullName: 'Sara Ahmed', marketingOptIn: false, whatsappOptIn: false, _count: { deviceTokens: 0 }, ...user }) }, notification: { createMany }, $queryRaw: jest.fn().mockResolvedValue([]) };
    return { svc: new NotificationsService(prisma as never, sender() as never, sender() as never, sender() as never, sender(wa) as never), createMany };
  };

  it('WhatsApp only with consent and a mobile number; it replaces the SMS for the same news', async () => {
    const off = build({});
    expect(await off.svc.notify('u', 'ORDER_OUT_FOR_DELIVERY', { orderNumber: 'FMX-1', store: 'FastMoveX', code: '4821' })).toEqual(['IN_APP', 'EMAIL', 'SMS']);
    const on = build({ whatsappOptIn: true });
    expect(await on.svc.notify('u', 'ORDER_OUT_FOR_DELIVERY', { orderNumber: 'FMX-1', store: 'FastMoveX', code: '4821' })).toEqual(['IN_APP', 'EMAIL', 'WHATSAPP']);
    const row = on.createMany.mock.calls[0][0].data.find((r: { channel: string }) => r.channel === 'WHATSAPP');
    expect(row.data.whatsapp).toEqual({ template: 'fastmovex_out_for_delivery_code', lang: 'ar', params: ['Sara', 'FMX-1', '4821'] }); // the delivery code travels with it
    const noPhone = build({ whatsappOptIn: true, phone: null });
    expect(await noPhone.svc.notify('u', 'ORDER_OUT_FOR_DELIVERY', { orderNumber: 'FMX-1' })).toEqual(['IN_APP', 'EMAIL']);
    const notConnected = build({ whatsappOptIn: true }, false);
    expect(await notConnected.svc.notify('u', 'ORDER_OUT_FOR_DELIVERY', { orderNumber: 'FMX-1' })).toEqual(['IN_APP', 'EMAIL', 'SMS']);
  });

  it('cart reminders are promotions: nothing at all without marketing consent', async () => {
    expect(await build({ whatsappOptIn: true }).svc.notify('u', 'CART_REMINDER', { items: '"Dates"', link: 'https://fastmovex.qa/ar/cart' })).toEqual([]);
    const ok = build({ whatsappOptIn: true, marketingOptIn: true });
    expect(await ok.svc.notify('u', 'CART_REMINDER', { items: '"Dates"', link: 'https://fastmovex.qa/ar/cart' })).toEqual(['IN_APP', 'EMAIL', 'WHATSAPP']);
    const email = ok.createMany.mock.calls[0][0].data.find((r: { channel: string }) => r.channel === 'EMAIL');
    expect(email.body).toContain('مرحباً Sara');
    expect(email.body).toContain('https://fastmovex.qa/ar/cart');
  });

  it('every WhatsApp template uses only variables its notification provides', () => {
    for (const [type, t] of Object.entries(TEMPLATES)) {
      if (!t.whatsapp) continue;
      const text = `${t.en.title} ${t.en.body}`;
      for (const p of t.whatsapp.params) if (p !== 'name' && p !== 'delivery' && p !== 'total' && p !== 'code') // code: the listener sends it (in {{codeLine}}) expect([type, text.includes(`{{${p}}}`)]).toEqual([type, true]);
      expect(t.whatsapp.template).toMatch(/^fastmovex_[a-z_]+$/);
    }
  });
});

describe('cart reminder settings', () => {
  it('defaults and limits', () => {
    expect(parseReminderConfig({ enabled: true })).toEqual({ enabled: true, firstAfterMinutes: 60, secondAfterHours: 24, quietFrom: 21, quietTo: 9 });
    expect(parseReminderConfig({ enabled: true, secondAfterHours: null }).secondAfterHours).toBeNull();
    for (const bad of [{ firstAfterMinutes: 5 }, { firstAfterMinutes: 5000 }, { secondAfterHours: 2 }, { quietFrom: 25 }, { quietTo: -1 }]) {
      expect(() => parseReminderConfig(bad)).toThrow(BadRequestException);
    }
    expect(readReminderConfig({ firstAfterMinutes: 'x' })).toEqual(REMINDERS_OFF);
  });
  it('quiet hours wrap past midnight in Doha time', () => {
    const c = parseReminderConfig({ enabled: true, quietFrom: 21, quietTo: 9 });
    const at = (hhmmUtc: string) => new Date(`2026-10-01T${hhmmUtc}:00Z`);
    expect(isQuiet(c, at('05:59'), 180)).toBe(true); // 08:59 in Doha
    expect(isQuiet(c, at('06:00'), 180)).toBe(false); // 09:00
    expect(isQuiet(c, at('17:59'), 180)).toBe(false); // 20:59
    expect(isQuiet(c, at('18:00'), 180)).toBe(true); // 21:00
    expect(isQuiet(c, at('23:30'), 180)).toBe(true); // 02:30
    expect(isQuiet(parseReminderConfig({ quietFrom: 0, quietTo: 0 }), at('23:30'), 180)).toBe(false); // no quiet hours
    expect(isQuiet(parseReminderConfig({ quietFrom: 13, quietTo: 15 }), at('10:30'), 180)).toBe(true); // 13:30, same-day range
  });
  it('describes the cart in the customer\'s language', () => {
    expect(describeItems(['Khalas Dates 1kg'], 'en')).toBe('"Khalas Dates 1kg"');
    expect(describeItems(['Dates', 'Mug'], 'en')).toBe('"Dates" and 1 more item');
    expect(describeItems(['Dates', 'Mug', 'Lamp'], 'en')).toBe('"Dates" and 2 more items');
    expect(describeItems(['تمر', 'كوب'], 'ar')).toBe('"تمر" ومنتج آخر');
    expect(describeItems(['تمر', 'كوب', 'مصباح', 'شاي'], 'ar')).toBe('"تمر" و3 منتجات أخرى');
  });
});
