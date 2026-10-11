import { NotificationsService } from '../src/notifications/notifications.service';

describe('saved-product alerts on WhatsApp', () => {
  const sender = (on = true) => ({ enabled: () => on, send: jest.fn() });
  const build = (user: object) => {
    const createMany = jest.fn();
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', locale: 'en', email: 'a@b.qa', phone: '+97455551234', fullName: 'Sara Ahmed', marketingOptIn: false, whatsappOptIn: true, _count: { deviceTokens: 0 }, ...user }) }, notification: { createMany }, $queryRaw: jest.fn().mockResolvedValue([]) };
    return { svc: new NotificationsService(prisma as never, sender() as never, sender() as never, sender() as never, sender() as never), createMany };
  };

  it('the customer asked for them, so they go out without marketing consent, with the product link last', async () => {
    const b = build({});
    expect(await b.svc.notify('u', 'PRICE_DROP', { product: 'Lamp', price: 'QAR 95.00', link: 'https://fastmovex.qa/en/p/lamp' })).toEqual(['IN_APP', 'EMAIL', 'WHATSAPP']);
    const wa = b.createMany.mock.calls[0][0].data.find((r: { channel: string }) => r.channel === 'WHATSAPP');
    expect(wa.data.whatsapp).toEqual({ template: 'fastmovex_price_drop', lang: 'en', params: ['Sara', 'Lamp', 'QAR 95.00', 'https://fastmovex.qa/en/p/lamp'] });
    const inApp = b.createMany.mock.calls[0][0].data.find((r: { channel: string }) => r.channel === 'IN_APP');
    expect(inApp.body).toBe('Lamp is now QAR 95.00. https://fastmovex.qa/en/p/lamp');
  });

  it('back in stock in Arabic', async () => {
    const b = build({ locale: 'ar' });
    await b.svc.notify('u', 'BACK_IN_STOCK', { product: 'مصباح', link: 'https://fastmovex.qa/ar/p/lamp' });
    const wa = b.createMany.mock.calls[0][0].data.find((r: { channel: string }) => r.channel === 'WHATSAPP');
    expect(wa.data.whatsapp).toEqual({ template: 'fastmovex_back_in_stock', lang: 'ar', params: ['Sara', 'مصباح', 'https://fastmovex.qa/ar/p/lamp'] });
  });
});
