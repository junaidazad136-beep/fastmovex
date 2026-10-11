import { BadRequestException } from '@nestjs/common';

export const RANGE_PRESETS = ['today', 'yesterday', '7d', '30d', '3m', '6m', '12m', 'custom'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export type Bucket = 'hour' | 'day' | 'week' | 'month';

/** Market time zones. Gulf markets and Pakistan have no daylight saving, so fixed offsets are exact. */
export const MARKET_TZ: Record<string, { tz: string; offsetMin: number }> = {
  QA: { tz: 'Asia/Qatar', offsetMin: 180 },
  AE: { tz: 'Asia/Dubai', offsetMin: 240 },
  SA: { tz: 'Asia/Riyadh', offsetMin: 180 },
  KW: { tz: 'Asia/Kuwait', offsetMin: 180 },
  BH: { tz: 'Asia/Bahrain', offsetMin: 180 },
  OM: { tz: 'Asia/Muscat', offsetMin: 240 },
  PK: { tz: 'Asia/Karachi', offsetMin: 300 },
};
export const tzFor = (country: string) => MARKET_TZ[country] ?? { tz: 'UTC', offsetMin: 0 };

const DAY = 86_400_000;

function localMidnightUtc(instant: Date, offsetMin: number): Date {
  const local = instant.getTime() + offsetMin * 60_000;
  return new Date(Math.floor(local / DAY) * DAY - offsetMin * 60_000);
}

function minusMonths(d: Date, months: number, offsetMin: number): Date {
  const local = new Date(d.getTime() + offsetMin * 60_000);
  local.setUTCMonth(local.getUTCMonth() - months);
  return new Date(local.getTime() - offsetMin * 60_000);
}

/** "Today" means today in the MARKET's time zone (Doha midnight), not the server's. Pure — exported for tests. */
export function resolveRange(preset: RangePreset, now: Date, country: string, custom?: { from?: string; to?: string }): { from: Date; to: Date; bucket: Bucket } {
  const { offsetMin } = tzFor(country);
  const today = localMidnightUtc(now, offsetMin);
  let from: Date;
  let to: Date = now;
  switch (preset) {
    case 'today': from = today; break;
    case 'yesterday': from = new Date(today.getTime() - DAY); to = today; break;
    case '7d': from = new Date(today.getTime() - 6 * DAY); break;
    case '30d': from = new Date(today.getTime() - 29 * DAY); break;
    case '3m': from = minusMonths(today, 3, offsetMin); break;
    case '6m': from = minusMonths(today, 6, offsetMin); break;
    case '12m': from = minusMonths(today, 12, offsetMin); break;
    case 'custom': {
      const re = /^\d{4}-\d{2}-\d{2}$/;
      if (!custom?.from || !custom?.to || !re.test(custom.from) || !re.test(custom.to)) throw new BadRequestException('Custom range needs from and to as YYYY-MM-DD');
      from = new Date(Date.parse(`${custom.from}T00:00:00Z`) - offsetMin * 60_000);
      to = new Date(Date.parse(`${custom.to}T00:00:00Z`) - offsetMin * 60_000 + DAY); // inclusive end date
      if (!(from < to)) throw new BadRequestException('from must be before to');
      if (to.getTime() - from.getTime() > 731 * DAY) throw new BadRequestException('Custom range can be at most 2 years');
      break;
    }
  }
  const span = to.getTime() - from.getTime();
  const bucket: Bucket = span <= 2 * DAY ? 'hour' : span <= 32 * DAY ? 'day' : span <= 190 * DAY ? 'week' : 'month';
  return { from, to, bucket };
}
