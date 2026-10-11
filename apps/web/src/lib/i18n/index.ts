import ar from './messages/ar';
import en, { type Messages } from './messages/en';
import type { Locale } from './config';
import { createTranslator, type Translator } from './translate';

export type { Messages };
export type T = Translator<Messages>;

const DICTS: Record<Locale, Messages> = { en, ar: ar as unknown as Messages };

export function getMessages(locale: Locale): Messages {
  return DICTS[locale];
}

/** Server components: `const t = getT(locale)`. */
export function getT(locale: Locale): T {
  return createTranslator(locale, DICTS[locale]);
}
