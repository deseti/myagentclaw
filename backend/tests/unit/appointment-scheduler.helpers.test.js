import { describe, expect, it } from 'vitest';
import { buildAppointmentStats } from '../../src/lib/appointment-scheduler.js';

describe('appointment scheduler helpers', () => {
  it('counts missed appointments and today appointments using each appointment timezone', () => {
    const now = new Date('2026-04-14T03:30:00.000Z');
    const stats = buildAppointmentStats([
      {
        status: 'MISSED',
        scheduledAt: new Date('2026-04-14T03:00:00.000Z'),
        timezone: 'America/New_York',
      },
      {
        status: 'CONFIRMED',
        scheduledAt: new Date('2026-04-14T03:10:00.000Z'),
        timezone: 'America/New_York',
      },
      {
        status: 'CONFIRMED',
        scheduledAt: new Date('2026-04-14T05:30:00.000Z'),
        timezone: 'America/New_York',
      },
    ], now);

    expect(stats.total).toBe(3);
    expect(stats.missed).toBe(1);
    expect(stats.today).toBe(2);
  });
});