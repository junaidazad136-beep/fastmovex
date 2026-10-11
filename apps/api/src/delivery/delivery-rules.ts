import { DeliveryMethod, DeliveryStatus, OrderStatus } from '@prisma/client';
import { randomInt, timingSafeEqual } from 'crypto';

/**
 * How a seller shipment status maps onto the delivery record.
 *  - READY_FOR_PICKUP   -> seller wants FastMoveX to collect: a FastMoveX-fleet job is opened, waiting for a courier
 *  - SHIPPED            -> seller delivers itself (new record) or the FastMoveX courier picked it up (existing record)
 */
export function deliveryStatusFor(so: OrderStatus, hasRecord: boolean, method?: DeliveryMethod): DeliveryStatus | null {
  switch (so) {
    case 'READY_FOR_PICKUP': return 'CREATED';
    case 'SHIPPED': return hasRecord && method === 'JOVIA' ? 'PICKED_UP' : 'IN_TRANSIT';
    case 'OUT_FOR_DELIVERY': return 'OUT_FOR_DELIVERY';
    case 'DELIVERED': return 'DELIVERED';
    case 'CANCELLED': return 'CANCELLED';
    default: return null;
  }
}

/** Courier state machine for FastMoveX fleet jobs. */
const COURIER_FLOW: Partial<Record<DeliveryStatus, DeliveryStatus[]>> = {
  ASSIGNED: ['PICKED_UP'],
  PICKED_UP: ['OUT_FOR_DELIVERY'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED'],
  // the customer called back or opened the door later: try again on the same run
  FAILED: ['OUT_FOR_DELIVERY'],
};

export interface RunJob { status: string; slotStart: Date | null; zone: string | null; assignedAt: Date | null }
const DONE = ['DELIVERED', 'FAILED'];
/**
 * The driver's order of work: jobs still to do first, by delivery window (earliest first, no window last), then by
 * zone so neighbouring stops follow each other, then by when they were given; finished jobs at the end. Pure, tested.
 */
export function runOrder<T extends RunJob>(jobs: T[]): T[] {
  const zone = (z: string | null) => (z && /^\d+$/.test(z) ? Number(z) : Number.MAX_SAFE_INTEGER);
  const time = (d: Date | null) => (d ? d.getTime() : Number.MAX_SAFE_INTEGER);
  return [...jobs].sort((a, b) =>
    Number(DONE.includes(a.status)) - Number(DONE.includes(b.status))
    || time(a.slotStart) - time(b.slotStart)
    || zone(a.zone) - zone(b.zone)
    || time(a.assignedAt) - time(b.assignedAt));
}

/** Google Maps link for a stop: the exact pin when the address has one, otherwise the written Qatar address. */
export function mapLink(a: { lat?: number | null; lng?: number | null; zone?: string | null; street?: string | null; building?: string | null; city?: string | null; line1?: string | null }): string {
  if (typeof a.lat === 'number' && typeof a.lng === 'number') return `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}`;
  const parts = [a.building && `Building ${a.building}`, a.street && `Street ${a.street}`, a.zone && `Zone ${a.zone}`, a.line1, a.city, 'Qatar'].filter(Boolean);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(', '))}`;
}

export function courierCan(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return (COURIER_FLOW[from] ?? []).includes(to);
}

export function newDeliveryCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0');
}

/** Constant-time compare so the code cannot be guessed by timing. */
export function codeMatches(expected: string | null, given: string): boolean {
  if (!expected || expected.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

/** Only first name of the courier is shown to customers. */
export const firstName = (n: string | null) => (n ? n.trim().split(/\s+/)[0] : null);

/** Metres between two points (haversine): how far the driver was from the address pin when an attempt failed. */
export function distanceMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Rough city driving: roads are ~1.4× the straight line, ~25 km/h average in Doha traffic, ~8 minutes per stop. */
export const ETA = { ROAD_FACTOR: 1.4, KMH: 25, STOP_MIN: 8, STALE_MIN: 20, MIN_MIN: 5 } as const;

/**
 * When the driver should arrive: straight-line distance from the driver's last known position to the address pin,
 * made into road time, plus the stops still before this one. Null when there is no fresh position or no pin
 * (the website then shows the delivery window). Exported for tests.
 */
export function estimateArrival(p: { now: Date; driver: { lat: number; lng: number; at: Date } | null; pin: { lat: number; lng: number } | null; stopsBefore: number }) {
  if (!p.driver || !p.pin) return null;
  if (p.now.getTime() - p.driver.at.getTime() > ETA.STALE_MIN * 60_000) return null;
  const km = (distanceMetres(p.driver, p.pin) / 1000) * ETA.ROAD_FACTOR;
  const minutes = Math.max(ETA.MIN_MIN, Math.round((km / ETA.KMH) * 60 + Math.max(0, p.stopsBefore) * ETA.STOP_MIN));
  // rounded to 5 minutes: precise-looking numbers promise more than we know
  const at = new Date(Math.ceil((p.now.getTime() + minutes * 60_000) / 300_000) * 300_000);
  return { at, minutes, stopsBefore: Math.max(0, p.stopsBefore) };
}

/** Driver reasons (driver page) → a code the website shows in the customer's language. */
export type FailureKind = 'NO_ANSWER' | 'NOT_HOME' | 'ADDRESS' | 'ANOTHER_DAY' | 'REFUSED' | 'OTHER';
export function failureKind(reason: string | null | undefined): FailureKind | null {
  if (!reason) return null;
  const r = reason.toLowerCase();
  if (r.startsWith('refused') || r.includes('refused')) return 'REFUSED';
  if (r.includes('not answering')) return 'NO_ANSWER';
  if (r.includes('not at home')) return 'NOT_HOME';
  if (r.includes('address')) return 'ADDRESS';
  if (r.includes('another day')) return 'ANOTHER_DAY';
  return 'OTHER';
}

/** A failed attempt this far from the address pin is flagged for operations to check. */
export const FAR_FROM_ADDRESS_M = 500;
