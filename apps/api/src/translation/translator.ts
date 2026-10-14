import type { Lang } from './text';

/**
 * A machine translator. Texts go in as light XML: <k>…</k> must come back untouched, <b>…</b> is bold.
 * Providers: DeepL (DEEPL_API_KEY; a key ending in ":fx" is the free plan) and "fake" for tests.
 */
export interface Translator {
  readonly name: 'deepl' | 'fake';
  translate(texts: string[], from: Lang, to: Lang): Promise<string[]>;
  /** characters used / allowed this billing period, when the provider tells */
  usage(): Promise<{ used: number; limit: number } | null>;
}

/** The monthly allowance is used up: wait until it renews. */
export class QuotaExceededError extends Error {}
/** The key was refused: someone has to fix it on the server. */
export class KeyRejectedError extends Error {}

const TIMEOUT_MS = 8_000;
/** DeepL accepts up to 50 texts per request. */
const PER_REQUEST = 50;

export class DeepLTranslator implements Translator {
  readonly name = 'deepl' as const;
  private readonly base: string;

  constructor(private readonly key: string, base?: string) {
    this.base = base ?? (key.trim().endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com');
  }

  private async call(path: string, body?: unknown): Promise<unknown> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${this.base}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `DeepL-Auth-Key ${this.key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
      if (res.status === 456) throw new QuotaExceededError('DeepL monthly character allowance used up');
      if (res.status === 401 || res.status === 403) throw new KeyRejectedError('DeepL refused the key (check DEEPL_API_KEY)');
      if (!res.ok) throw new Error(`DeepL ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async translate(texts: string[], from: Lang, to: Lang): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < texts.length; i += PER_REQUEST) {
      const chunk = texts.slice(i, i + PER_REQUEST);
      const r = (await this.call('/v2/translate', {
        text: chunk,
        source_lang: from === 'ar' ? 'AR' : 'EN',
        target_lang: to === 'ar' ? 'AR' : 'EN-GB',
        tag_handling: 'xml',
        ignore_tags: ['k'],
        preserve_formatting: true,
        // not charged: tells DeepL these are shop listings, which gives shop wording
        context: 'Product listing in an online shop in Qatar (electronics, fashion, home, beauty).',
      })) as { translations?: { text: string }[] };
      if (!r.translations || r.translations.length !== chunk.length) throw new Error('DeepL returned an unexpected answer');
      out.push(...r.translations.map((t) => t.text));
    }
    return out;
  }

  async usage() {
    const r = (await this.call('/v2/usage')) as { character_count?: number; character_limit?: number };
    return typeof r.character_count === 'number' && typeof r.character_limit === 'number' ? { used: r.character_count, limit: r.character_limit } : null;
  }
}

/** For tests and local runs: marks the text instead of translating it (Arabic output really is Arabic script). */
export class FakeTranslator implements Translator {
  readonly name = 'fake' as const;
  calls: { texts: string[]; from: Lang; to: Lang }[] = [];
  async translate(texts: string[], from: Lang, to: Lang) {
    this.calls.push({ texts, from, to });
    return texts.map((t) => (to === 'ar' ? `عربي ${t}` : `EN ${t}`));
  }
  async usage() { return { used: this.calls.reduce((n, c) => n + c.texts.join('').length, 0), limit: 500_000 }; }
}
