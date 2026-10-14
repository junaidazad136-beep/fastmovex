import { fromXml, hashText, isArabic, keepAsIs, optionTerms, planPairs, splitLines, toXml } from '../src/translation/text';
import { DeepLTranslator, KeyRejectedError, QuotaExceededError } from '../src/translation/translator';

const PAIRS: [string, string][] = [['title', 'titleAr'], ['description', 'descriptionAr']];

describe('Phase 31 — which side the machine writes', () => {
  it('English only: the Arabic is written from it', () => {
    const p = planPairs({ title: 'Wireless Earbuds', titleAr: null, description: '', descriptionAr: null }, PAIRS, {});
    expect(p.jobs).toEqual([{ field: 'titleAr', from: 'en', source: 'Wireless Earbuds' }]);
  });

  it("the seller's own Arabic is never touched; a machine Arabic follows a changed English", () => {
    const own = planPairs({ title: 'Wireless Earbuds v2', titleAr: 'سماعات' }, PAIRS, {});
    expect(own.jobs).toEqual([]);
    const machine = { titleAr: { text: 'سماعات لاسلكية', src: hashText('Wireless Earbuds') } };
    const same = planPairs({ title: 'Wireless Earbuds', titleAr: 'سماعات لاسلكية' }, PAIRS, machine);
    expect(same.jobs).toEqual([]);
    const changed = planPairs({ title: 'Wireless Earbuds Pro', titleAr: 'سماعات لاسلكية' }, PAIRS, machine);
    expect(changed.jobs).toEqual([{ field: 'titleAr', from: 'en', source: 'Wireless Earbuds Pro' }]);
  });

  it('a seller who corrects the machine Arabic owns it from then on', () => {
    const machine = { titleAr: { text: 'سماعات لاسلكية', src: hashText('Wireless Earbuds') } };
    const p = planPairs({ title: 'Wireless Earbuds Pro', titleAr: 'سماعات أذن لاسلكية' }, PAIRS, machine);
    expect(p.jobs).toEqual([]);
    expect(p.auto).toEqual({});
  });

  it('Arabic typed into the English box moves to the Arabic box and the English is written from it', () => {
    const p = planPairs({ title: 'عطر مسك الطهارة', titleAr: null }, PAIRS, {});
    expect(p.set).toEqual({ titleAr: 'عطر مسك الطهارة' });
    expect(p.jobs).toEqual([{ field: 'title', from: 'ar', source: 'عطر مسك الطهارة' }]);
  });

  it('Arabic only (no English) → English; clearing the English also clears its machine Arabic', () => {
    expect(planPairs({ description: '', descriptionAr: 'وصف' }, PAIRS, {}).jobs).toEqual([{ field: 'description', from: 'ar', source: 'وصف' }]);
    const machine = { descriptionAr: { text: 'وصف', src: hashText('Text') } };
    const cleared = planPairs({ title: 'X', titleAr: 'س', description: '', descriptionAr: 'وصف' }, PAIRS, machine);
    expect(cleared.set).toEqual({ descriptionAr: null });
    expect(cleared.jobs).toEqual([]);
  });
});

describe('Phase 31 — brand names, models and units are not translated', () => {
  it('marks the brand, model numbers, units, short ALL-CAPS and CamelCase names', () => {
    const x = toXml('Nova PowerCore 20000mAh power bank with USB-C & LED light', 'en', ['Nova']);
    expect(x).toBe('<k>Nova</k> <k>PowerCore</k> <k>20000mAh</k> power bank with <k>USB-C</k> &amp; <k>LED</k> light');
    expect(toXml('FEATURES of the iPhone 15', 'en')).toBe('FEATURES of the <k>iPhone</k> <k>15</k>');
  });
  it('in Arabic text every Latin word is kept; bold survives', () => {
    expect(toXml('سماعات Nova X12 **لاسلكية**', 'ar')).toBe('سماعات <k>Nova X12</k> <b>لاسلكية</b>');
    expect(fromXml('سماعات <k>Nova X12</k> <b>لاسلكية</b> &amp; أكثر')).toBe('سماعات Nova X12 **لاسلكية** & أكثر');
  });
  it('page text keeps its bullets, headings and blank lines', () => {
    expect(splitLines('## Features\n- Long battery\n\n1. Charge')).toEqual([
      { prefix: '## ', body: 'Features' }, { prefix: '- ', body: 'Long battery' }, { prefix: '', body: '' }, { prefix: '1. ', body: 'Charge' },
    ]);
  });
  it('option words: sizes and codes stay, words get Arabic', () => {
    expect(['M', 'XL', '42', '256 GB', '30ml', 'USB-C', 'أحمر'].every(keepAsIs)).toBe(true);
    expect(keepAsIs('Black')).toBe(false);
    expect(optionTerms([{ optionValues: { Colour: 'Black', Size: 'M' } }, { optionValues: { Colour: 'White', Size: 'L' } }])).toEqual(['Colour', 'Black', 'Size', 'White']);
    expect(isArabic('عطر Dana')).toBe(true);
    expect(isArabic('Dana عطر Musk Oud')).toBe(false);
  });
});

describe('Phase 31 — DeepL', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('free keys go to the free address; shop context, xml tags and the right languages are sent', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    global.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ translations: body.text.map((t: string) => ({ text: `AR:${t}` })) }), { status: 200 });
    }) as typeof fetch;
    const d = new DeepLTranslator('0123456789abcdef0123:fx');
    expect(await d.translate(['<k>Nova</k> earbuds'], 'en', 'ar')).toEqual(['AR:<k>Nova</k> earbuds']);
    expect(calls[0].url).toBe('https://api-free.deepl.com/v2/translate');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('DeepL-Auth-Key 0123456789abcdef0123:fx');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ source_lang: 'EN', target_lang: 'AR', tag_handling: 'xml', ignore_tags: ['k'] });
    await d.translate(['x'], 'ar', 'en');
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({ source_lang: 'AR', target_lang: 'EN-GB' });
    expect(new DeepLTranslator('0123456789abcdef0123-pro')['base']).toBe('https://api.deepl.com');
  });

  it('a used-up allowance and a refused key are told apart', async () => {
    global.fetch = (async () => new Response('{}', { status: 456 })) as typeof fetch;
    await expect(new DeepLTranslator('k'.repeat(24)).translate(['a'], 'en', 'ar')).rejects.toBeInstanceOf(QuotaExceededError);
    global.fetch = (async () => new Response('{}', { status: 403 })) as typeof fetch;
    await expect(new DeepLTranslator('k'.repeat(24)).translate(['a'], 'en', 'ar')).rejects.toBeInstanceOf(KeyRejectedError);
  });
});
