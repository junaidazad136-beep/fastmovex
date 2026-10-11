import { courierCan, mapLink, runOrder } from '../src/delivery/delivery-rules';

const job = (id: string, status: string, slot: string | null, zone: string | null, assigned = '2026-10-02T05:00:00Z') =>
  ({ id, status, slotStart: slot ? new Date(slot) : null, zone, assignedAt: new Date(assigned) });

describe('driver run', () => {
  it('open jobs first, by delivery window, then zone (neighbours together), then when given; finished at the end', () => {
    const jobs = [
      job('done', 'DELIVERED', '2026-10-02T06:00:00Z', '25'),
      job('noSlot', 'ASSIGNED', null, '10'),
      job('late70', 'ASSIGNED', '2026-10-02T10:00:00Z', '70'),
      job('early70', 'OUT_FOR_DELIVERY', '2026-10-02T06:00:00Z', '70'),
      job('early25', 'ASSIGNED', '2026-10-02T06:00:00Z', '25'),
      job('failed', 'FAILED', null, '30'),
      job('early25b', 'ASSIGNED', '2026-10-02T06:00:00Z', '25', '2026-10-02T04:00:00Z'),
    ];
    expect(runOrder(jobs).map((j) => j.id)).toEqual(['early25b', 'early25', 'early70', 'late70', 'noSlot', 'done', 'failed']);
  });

  it('a failed attempt can be tried again; nothing else goes backwards', () => {
    expect(courierCan('FAILED', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(courierCan('DELIVERED', 'OUT_FOR_DELIVERY')).toBe(false);
    expect(courierCan('ASSIGNED', 'DELIVERED')).toBe(false);
  });

  it('map link: the exact pin when known, otherwise the written Qatar address', () => {
    expect(mapLink({ lat: 25.2854, lng: 51.531 })).toBe('https://www.google.com/maps/dir/?api=1&destination=25.2854,51.531');
    expect(mapLink({ zone: '66', street: '901', building: '12', city: 'Doha' }))
      .toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Building 12, Street 901, Zone 66, Doha, Qatar')}`);
  });
});
