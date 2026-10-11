'use client';

import { useApi } from '@/lib/use-api';

interface Day {
  date: string;
  enabled: boolean;
  windows: { from: string; to: string; start: string; capacity: number; booked: number }[];
}

/** Bookings per delivery window on one day, so the team can plan drivers. */
export function SlotSchedule({ date }: { date: string }) {
  const day = useApi<Day>(`/admin/delivery-slots?date=${encodeURIComponent(date)}`);
  if (!day.data || !day.data.windows.length) return null;
  return (
    <div className="flex flex-wrap gap-2 border-b border-ink-100 bg-ink-25 p-3" data-testid="slot-schedule">
      {day.data.windows.map((w) => {
        const pct = Math.min(100, Math.round((w.booked / w.capacity) * 100));
        return (
          <div key={w.start} className="min-w-[150px] rounded-lg border border-ink-100 bg-white px-3 py-2 text-xs">
            <p className="font-semibold text-ink-800">{w.from}–{w.to}</p>
            <p className="text-ink-500">{w.booked} of {w.capacity} booked</p>
            <div className="mt-1 h-1.5 rounded-full bg-ink-100"><div className={`h-1.5 rounded-full ${pct >= 100 ? 'bg-danger-500' : pct >= 80 ? 'bg-warning-500' : 'bg-success-500'}`} style={{ width: `${pct}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}
