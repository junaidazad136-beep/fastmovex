import { BadRequestException } from '@nestjs/common';

/**
 * Delivery time slots. A market offers a few daily windows ("09:00–13:00") for the next N days; each window takes a
 * limited number of orders. Everything here is pure (no database), so it is easy to test; times are in the market's
 * local time, converted with its fixed UTC offset (Gulf markets have no daylight saving).
 */
export interface SlotWindow {
  start: string; // "HH:MM" local
  end: string; // "HH:MM" local, after start
  capacity: number; // orders per window per day
}

export interface SlotConfig {
  enabled: boolean;
  /** true = the customer must pick a window; false = "As soon as possible" is also allowed */
  required: boolean;
  /** how many days are offered, today included (1–14) */
  daysAhead: number;
  /** a window can be chosen until this many minutes before it starts */
  leadMinutes: number;
  /** 0 = Sunday … 6 = Saturday (local) */
  closedWeekdays: number[];
  /** "YYYY-MM-DD" local dates without delivery (holidays) */
  closedDates: string[];
  windows: SlotWindow[];
}

export const SLOTS_OFF: SlotConfig = { enabled: false, required: false, daysAhead: 3, leadMinutes: 120, closedWeekdays: [], closedDates: [], windows: [] };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const minutes = (hhmm: string) => {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** Strict check for what staff save. Throws a readable 400. */
export function parseSlotConfig(raw: unknown): SlotConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bad = (msg: string): never => { throw new BadRequestException(`Delivery slots: ${msg}`); };
  const enabled = c.enabled === true;
  const required = c.required === true;
  const daysAhead = c.daysAhead === undefined ? 3 : Number(c.daysAhead);
  if (!Number.isInteger(daysAhead) || daysAhead < 1 || daysAhead > 14) bad('offer between 1 and 14 days');
  const leadMinutes = c.leadMinutes === undefined ? 120 : Number(c.leadMinutes);
  if (!Number.isInteger(leadMinutes) || leadMinutes < 0 || leadMinutes > 2880) bad('order lead time must be 0–2880 minutes');
  const closedWeekdays = Array.isArray(c.closedWeekdays) ? [...new Set(c.closedWeekdays.map(Number))].sort() : [];
  if (closedWeekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) bad('closed days must be 0 (Sunday) to 6 (Saturday)');
  if (closedWeekdays.length === 7) bad('at least one day must be open');
  const closedDates = Array.isArray(c.closedDates) ? [...new Set(c.closedDates.map(String))].sort() : [];
  if (closedDates.length > 60 || closedDates.some((d) => !DATE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)))) bad('holidays must be dates (YYYY-MM-DD), at most 60');
  const rawWindows = Array.isArray(c.windows) ? c.windows : [];
  if (rawWindows.length > 12) bad('at most 12 windows a day');
  const windows = rawWindows.map((w, i) => {
    const o = (w ?? {}) as Record<string, unknown>;
    const start = String(o.start ?? '');
    const end = String(o.end ?? '');
    const capacity = Number(o.capacity);
    if (!HHMM.test(start) || !HHMM.test(end)) bad(`window ${i + 1}: times must look like 09:00`);
    if (minutes(end) <= minutes(start)) bad(`window ${i + 1}: must end after it starts`);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10_000) bad(`window ${i + 1}: orders per window must be 1–10000`);
    return { start, end, capacity };
  }).sort((a, b) => minutes(a.start) - minutes(b.start));
  for (let i = 1; i < windows.length; i++) if (minutes(windows[i].start) < minutes(windows[i - 1].end)) bad(`windows ${windows[i - 1].start} and ${windows[i].start} overlap`);
  if (enabled && !windows.length) bad('add at least one window, or turn slots off');
  return { enabled, required: enabled && required, daysAhead, leadMinutes, closedWeekdays, closedDates, windows };
}

/** Lenient read of what is stored: anything broken means "off" (never blocks checkout). */
export function readSlotConfig(raw: unknown): SlotConfig {
  try {
    return parseSlotConfig(raw);
  } catch {
    return SLOTS_OFF;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Local calendar date ("YYYY-MM-DD") and weekday of an instant. */
export function localDay(at: Date, offsetMin: number) {
  const l = new Date(at.getTime() + offsetMin * 60_000);
  return { date: `${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}-${pad(l.getUTCDate())}`, weekday: l.getUTCDay() };
}
/** The UTC instant of a local "YYYY-MM-DD" + "HH:MM". */
export function localToUtc(date: string, hhmm: string, offsetMin: number): Date {
  return new Date(Date.parse(`${date}T${hhmm}:00Z`) - offsetMin * 60_000);
}
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export interface SlotOption {
  start: string; // ISO (UTC)
  end: string;
  from: string; // "HH:MM" local
  to: string;
  left: number;
  available: boolean;
}
export interface SlotDay {
  date: string;
  weekday: number;
  slots: SlotOption[];
}

/** The days and windows to show, with what is left. Days with nothing bookable any more are dropped. */
export function buildSlotDays(cfg: SlotConfig, offsetMin: number, now: Date, booked: Map<string, number>): SlotDay[] {
  if (!cfg.enabled) return [];
  const today = localDay(now, offsetMin).date;
  const days: SlotDay[] = [];
  for (let i = 0; i < cfg.daysAhead; i++) {
    const date = addDays(today, i);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (cfg.closedWeekdays.includes(weekday) || cfg.closedDates.includes(date)) continue;
    const slots = cfg.windows
      .map((w) => {
        const start = localToUtc(date, w.start, offsetMin);
        const end = localToUtc(date, w.end, offsetMin);
        const open = start.getTime() - cfg.leadMinutes * 60_000 > now.getTime();
        const left = Math.max(0, w.capacity - (booked.get(start.toISOString()) ?? 0));
        return { start: start.toISOString(), end: end.toISOString(), from: w.start, to: w.end, left, available: open && left > 0, open };
      })
      .filter((s) => s.open)
      .map(({ open: _open, ...s }) => s);
    if (slots.length) days.push({ date, weekday, slots });
  }
  return days;
}

/** Turns the customer's choice (a window start, ISO) into a real, still-open window, or says why not. */
export function resolveSlot(cfg: SlotConfig, offsetMin: number, now: Date, startIso: string): { start: Date; end: Date; capacity: number } {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) throw new BadRequestException({ message: 'Choose a delivery time', reason: 'SLOT_INVALID' });
  const { date, weekday } = localDay(start, offsetMin);
  const local = new Date(start.getTime() + offsetMin * 60_000);
  const hhmm = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  const w = cfg.windows.find((x) => x.start === hhmm);
  const today = localDay(now, offsetMin).date;
  const last = addDays(today, cfg.daysAhead - 1);
  if (!w || local.getUTCSeconds() || local.getUTCMilliseconds() || date < today || date > last || cfg.closedWeekdays.includes(weekday) || cfg.closedDates.includes(date)) {
    throw new BadRequestException({ message: 'This delivery time is not offered. Please choose another one.', reason: 'SLOT_INVALID' });
  }
  if (start.getTime() - cfg.leadMinutes * 60_000 <= now.getTime()) {
    throw new BadRequestException({ message: 'This delivery time can no longer be booked. Please choose a later one.', reason: 'SLOT_CLOSED' });
  }
  return { start, end: localToUtc(date, w.end, offsetMin), capacity: w.capacity };
}

/** "Thu 2 Oct, 09:00–13:00" in the customer's language, market time. */
export function slotLabel(start: Date, end: Date, tz: string, locale: string): string {
  const loc = locale === 'ar' ? 'ar-QA' : 'en-GB';
  const day = new Intl.DateTimeFormat(loc, { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(start);
  const t = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${day}, ${t(start)}–${t(end)}`;
}
