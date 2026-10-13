/**
 * Formatting for the admin panel. Money arrives from the API as a string of minor units ("10000" = QAR 100.00)
 * and is never turned into a float. Dates are shown in Qatar time, whatever the staff member's computer says.
 */
export const TIME_ZONE = 'Asia/Qatar';

export function minorToDecimalString(minor: string | bigint, minorUnits = 2): string {
  let v = typeof minor === 'bigint' ? minor : BigInt(minor);
  const neg = v < 0n;
  if (neg) v = -v;
  const base = 10n ** BigInt(minorUnits);
  const whole = v / base;
  const frac = (v % base).toString().padStart(minorUnits, '0');
  return `${neg ? '-' : ''}${whole}${minorUnits > 0 ? `.${frac}` : ''}`;
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(minor: string | bigint | null | undefined, currency = 'QAR', opts: { compact?: boolean } = {}): string {
  if (minor === null || minor === undefined || minor === '') return '—';
  const dec = minorToDecimalString(minor);
  const hide = !!opts.compact && /\.0+$/.test(dec);
  const key = `${currency}|${hide}`;
  let f = moneyFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-QA', { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: hide ? 0 : 2, maximumFractionDigits: 2 });
    moneyFormatters.set(key, f);
  }
  return f.format(dec as unknown as number).replace(/ /g, ' ');
}

/** "150.5" typed by staff → "15050" minor units, or null when not a valid amount. */
export function decimalToMinor(input: string, minorUnits = 2): string | null {
  const s = input.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/,/g, '');
  if (!/^\d{1,10}(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  if (frac.length > minorUnits) return null;
  return (BigInt(whole) * 10n ** BigInt(minorUnits) + BigInt(frac.padEnd(minorUnits, '0') || '0')).toString();
}

/** Minor units → the plain decimal a staff member edits ("15050" → "150.50"). */
export function minorToInput(minor: string | null | undefined): string {
  if (minor === null || minor === undefined || minor === '') return '';
  return minorToDecimalString(minor);
}

export function formatNumber(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-QA').format(Number(n));
}

/** Basis points → "12.5%". */
export function formatBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return '—';
  return `${(bps / 100).toLocaleString('en-QA', { maximumFractionDigits: 2 })}%`;
}

const dateTime = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const dateOnly = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' });

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : '—';
}
const slotDay = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'short', day: '2-digit', month: 'short' });
const hm = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false });
/** Delivery window: "Sat 03 Oct, 13:00–17:00" (Qatar time). */
export function formatSlot(start: string | null | undefined, end: string | null | undefined): string {
  return start && end ? `${slotDay.format(new Date(start))}, ${hm.format(new Date(start))}–${hm.format(new Date(end))}` : '';
}
/** Clock time in Qatar: "13:05". */
export function formatTime(iso: string | null | undefined): string {
  return iso ? hm.format(new Date(iso)) : '';
}
/** Today's date in Qatar, YYYY-MM-DD. */
export function todayInQatar(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function formatDate(iso: string | null | undefined): string {
  return iso ? dateOnly.format(new Date(iso)) : '—';
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return formatDate(iso);
}

/** A Date as the value of <input type="datetime-local">, in Qatar time (UTC+3, no daylight saving). */
export function toQatarLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 3 * 3600_000);
  return d.toISOString().slice(0, 16);
}
/** <input type="datetime-local"> value typed in Qatar time → ISO string (UTC). */
export function fromQatarLocalInput(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(`${v}:00+03:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function humanize(code: string | null | undefined): string {
  if (!code) return '—';
  const s = code.replace(/[_.]/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

const PAYMENT_METHODS: Record<string, string> = { CARD: 'Card', APPLE_PAY: 'Apple Pay', GOOGLE_PAY: 'Google Pay', COD: 'Cash on delivery', PAYLATER: 'PayLater (instalments)' };
export function paymentMethodLabel(m: string | null | undefined): string {
  return m ? PAYMENT_METHODS[m] ?? humanize(m) : '—';
}

const DELIVERY_METHODS: Record<string, string> = { SELLER: 'Store delivery', FASTMOVEX: 'FastMoveX courier', THIRD_PARTY: 'Courier partner', PICKUP: 'Customer pickup' };
export function deliveryMethodLabel(m: string | null | undefined): string {
  return m ? DELIVERY_METHODS[m] ?? humanize(m) : '—';
}

/** Qatar address as one readable block: "Building 3, Street 800, Zone 60, Doha". */
export function formatAddress(a: Record<string, unknown> | null | undefined): string[] {
  if (!a) return [];
  const s = (k: string) => (typeof a[k] === 'string' && a[k] ? String(a[k]) : null);
  const lines = [
    s('line1'),
    [s('unit') && `Unit ${s('unit')}`, s('building') && `Building ${s('building')}`, s('street') && `Street ${s('street')}`, s('zone') && `Zone ${s('zone')}`].filter(Boolean).join(', '),
    [s('city'), s('postalCode')].filter(Boolean).join(' '),
  ];
  return lines.filter((l): l is string => !!l);
}

/** "−20%" for a deal price against the normal price. */
export function percentOffLabel(normalMinor: string, dealMinor: string): string {
  const n = BigInt(normalMinor);
  const d = BigInt(dealMinor);
  if (n <= 0n || d >= n) return '0%';
  return `−${Number(((n - d) * 100n) / n)}%`;
}

/** A two-step sign-in code as typed: Arabic-Indic digits count as 0-9, spaces and other characters are dropped. */
export function cleanCode(v: string, recovery: boolean): string {
  const latin = v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  return recovery ? latin.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9) : latin.replace(/\D/g, '').slice(0, 6);
}
