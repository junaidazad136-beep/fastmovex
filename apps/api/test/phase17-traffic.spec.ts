import { MemoryCacheService } from '../src/cache/cache.service';
import { classify, device, landingKey, token, TrafficService } from '../src/analytics/traffic';

describe('where a visit came from', () => {
  it('campaign tags win, cleaned', () => {
    expect(classify({ utmSource: 'Instagram', utmMedium: 'Paid Social', utmCampaign: 'Eid Sale 2026!', referrerHost: 'l.instagram.com' }))
      .toEqual({ source: 'instagram', medium: 'paid-social', campaign: 'eid-sale-2026' });
    expect(classify({ utmSource: 'newsletter' })).toEqual({ source: 'newsletter', medium: 'campaign', campaign: null });
    expect(token('<script>alert(1)</script>')).toBe('script-alert-1-script');
  });

  it('ad clicks without tags', () => {
    expect(classify({ click: 'gclid', referrerHost: 'www.google.com' })).toMatchObject({ source: 'google', medium: 'cpc' });
    expect(classify({ click: 'ttclid' })).toMatchObject({ source: 'tiktok', medium: 'cpc' });
    expect(classify({ click: 'fbclid' })).toMatchObject({ source: 'facebook', medium: 'social' });
  });

  it('search engines, social networks, messaging apps, webmail and other sites', () => {
    expect(classify({ referrerHost: 'www.google.com.qa' })).toEqual({ source: 'google', medium: 'organic', campaign: null });
    expect(classify({ referrerHost: 'duckduckgo.com' })).toMatchObject({ source: 'duckduckgo', medium: 'organic' });
    expect(classify({ referrerHost: 'l.instagram.com' })).toMatchObject({ source: 'instagram', medium: 'social' });
    expect(classify({ referrerHost: 'm.facebook.com' })).toMatchObject({ source: 'facebook', medium: 'social' });
    expect(classify({ referrerHost: 't.co' })).toMatchObject({ source: 'x', medium: 'social' });
    expect(classify({ referrerHost: 'web.whatsapp.com' })).toMatchObject({ source: 'whatsapp', medium: 'messaging' });
    expect(classify({ referrerHost: 'mail.google.com' })).toMatchObject({ source: 'email', medium: 'email' });
    expect(classify({ referrerHost: 'www.qatarliving.com' })).toEqual({ source: 'qatarliving.com', medium: 'referral', campaign: null });
    expect(classify({})).toEqual({ source: 'direct', medium: 'none', campaign: null });
    expect(classify(undefined)).toEqual({ source: 'direct', medium: 'none', campaign: null });
  });

  it('device type; bots are not counted', () => {
    expect(device('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148')).toBe('mobile');
    expect(device('Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile Safari/537.36')).toBe('mobile');
    expect(device('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('tablet');
    expect(device('Mozilla/5.0 (Linux; Android 13; SM-X200) Safari/537.36')).toBe('tablet');
    expect(device('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0')).toBe('desktop');
    expect(device('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBeNull();
    expect(device('Mozilla/5.0 HeadlessChrome/128.0')).toBeNull();
    expect(device(undefined)).toBeNull();
  });

  it('landing pages keep nothing personal', () => {
    expect(landingKey('/en/p/premium-khalas-dates-1kg?utm_source=ig')).toBe('/en/p/premium-khalas-dates-1kg');
    expect(landingKey('/ar/c/perfumes/oud')).toBe('/ar/c/perfumes');
    expect(landingKey('/en/account/orders/FMX-QA-260930-3B6AFE')).toBe('/en/account');
    expect(landingKey('/en/track?order=FMX-1&email=a@b.qa')).toBe('/en/track');
    expect(landingKey('/en/checkout/pay/abc')).toBe('/en/checkout');
    expect(landingKey('https://evil.example/x')).toBeNull();
    expect(landingKey('/')).toBe('/');
  });
});

describe('session counting', () => {
  const sid = '7b0e6a52-6f8f-4c3e-9a0c-1f2d3e4b5a69';
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148';

  it('events are added up in memory and written once; the first touch decides the source', async () => {
    const executeRaw = jest.fn();
    const svc = new TrafficService({ $executeRaw: executeRaw } as never, new MemoryCacheService());
    const at = new Date('2026-10-01T22:30:00Z'); // 01:30 on 2 October in Doha
    expect(svc.record('QA', { sessionId: sid, locale: 'ar', touch: { referrerHost: 'l.instagram.com' }, events: [{ type: 'page_view', path: '/ar/p/oud?x=1' }, { type: 'product_view' }] }, UA, at)).toBe(true);
    svc.record('QA', { sessionId: sid, touch: { utmSource: 'google' }, events: [{ type: 'page_view', path: '/ar/cart' }, { type: 'add_to_cart' }, { type: 'checkout_start' }] }, UA, at);
    svc.purchased('QA', sid, at);
    expect(svc.record('QA', { sessionId: sid, events: [{ type: 'page_view' }] }, 'Googlebot/2.1', at)).toBe(false);
    expect(await svc.flush()).toBe(1);
    expect(executeRaw.mock.calls[0][0].values).toEqual([
      sid, 'QA', '2026-10-02', at, at, 'instagram', 'social', null, '/ar/p/oud', 'mobile', 'ar', 2, 1, true, true, true,
    ]);
    expect(await svc.flush()).toBe(0);
  });
});
