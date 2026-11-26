import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calendarDaysBetween,
  nextDueDate,
  projectDueDates,
  projectFertilizerDates,
  todayISO,
  wateringStatus,
} from './dates.js';

const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const ymd = (d) => todayISO(d);

function freeze(date) {
  vi.useFakeTimers();
  vi.setSystemTime(date);
}

afterEach(() => vi.useRealTimers());

describe('todayISO', () => {
  it('uses the local date at 23:30', () => {
    expect(todayISO(at(2026, 5, 4, 23, 30))).toBe('2026-05-04');
  });
  it('uses the local date just after midnight', () => {
    expect(todayISO(at(2026, 1, 1, 0, 5))).toBe('2026-01-01');
  });
  it('defaults to now', () => {
    freeze(at(2026, 3, 9, 23, 59));
    expect(todayISO()).toBe('2026-03-09');
  });
});

describe('nextDueDate', () => {
  const plant = { waterIntervalDays: 7 };
  it('is null without an interval', () => {
    expect(nextDueDate({}, at(2026, 5, 1), null)).toBeNull();
    expect(nextDueDate(null, at(2026, 5, 1), null)).toBeNull();
  });
  it('is null when never watered and no override', () => {
    expect(nextDueDate(plant, null, null)).toBeNull();
  });
  it('adds the interval at local midnight regardless of time of day', () => {
    const d = nextDueDate(plant, at(2026, 5, 1, 23, 45), null);
    expect(d).toEqual(at(2026, 5, 8));
  });
  it('honors override only when checked after watering', () => {
    const p = { ...plant, nextWateringOverride: at(2026, 5, 20, 15) };
    expect(nextDueDate(p, at(2026, 5, 1), at(2026, 5, 3))).toEqual(at(2026, 5, 20));
    expect(nextDueDate(p, at(2026, 5, 5), at(2026, 5, 3))).toEqual(at(2026, 5, 12));
    expect(nextDueDate(p, at(2026, 5, 1), null)).toEqual(at(2026, 5, 8));
  });
  it('override works for a never-watered plant that was checked', () => {
    const p = { ...plant, nextWateringOverride: at(2026, 5, 20) };
    expect(nextDueDate(p, null, at(2026, 5, 3))).toEqual(at(2026, 5, 20));
  });
  it('returns the past date when overdue', () => {
    expect(nextDueDate(plant, at(2026, 4, 1), null, at(2026, 5, 1))).toEqual(at(2026, 4, 8));
  });
  it('accepts Firestore-like timestamps', () => {
    const ts = { toDate: () => at(2026, 5, 1, 10) };
    expect(nextDueDate(plant, ts, null)).toEqual(at(2026, 5, 8));
  });
});

describe('agreement with wateringStatus', () => {
  const today = at(2026, 5, 10, 14);
  beforeEach(() => freeze(today));
  const cases = [
    ['overdue', { waterIntervalDays: 3 }, at(2026, 5, 1), null],
    ['due today', { waterIntervalDays: 3 }, at(2026, 5, 7, 22), null],
    ['tomorrow', { waterIntervalDays: 3 }, at(2026, 5, 8, 1), null],
    ['later', { waterIntervalDays: 14 }, at(2026, 5, 9), null],
    ['override future', { waterIntervalDays: 3, nextWateringOverride: at(2026, 5, 18) }, at(2026, 5, 1), at(2026, 5, 9)],
    ['override past', { waterIntervalDays: 3, nextWateringOverride: at(2026, 5, 8) }, at(2026, 5, 1), at(2026, 5, 2)],
    ['override ignored', { waterIntervalDays: 3, nextWateringOverride: at(2026, 5, 18) }, at(2026, 5, 9), at(2026, 5, 2)],
    ['never', { waterIntervalDays: 3 }, null, null],
  ];
  it.each(cases)('%s', (_n, plant, w, c) => {
    const due = nextDueDate(plant, w, c, today);
    const st = wateringStatus(plant, w, c);
    if (due === null) expect(st.daysUntil).toBeNull();
    else expect(st.daysUntil).toBe(calendarDaysBetween(today, due));
  });
});

describe('DST boundaries (America/Los_Angeles)', () => {
  it('fall back: 2026-11-01', () => {
    const d = nextDueDate({ waterIntervalDays: 3 }, at(2026, 10, 30, 12), null);
    expect(d).toEqual(at(2026, 11, 2));
    expect(d.getHours()).toBe(0);
    freeze(at(2026, 10, 31, 20));
    expect(wateringStatus({ waterIntervalDays: 3 }, at(2026, 10, 30, 12), null).daysUntil).toBe(2);
  });
  it('spring forward: 2026-03-08', () => {
    const d = nextDueDate({ waterIntervalDays: 2 }, at(2026, 3, 7, 23), null);
    expect(d).toEqual(at(2026, 3, 9));
    expect(d.getHours()).toBe(0);
  });
  it('projection keeps local midnight across DST', () => {
    const days = projectDueDates(
      { waterIntervalDays: 1 }, at(2026, 10, 29), null,
      at(2026, 10, 30), at(2026, 11, 4), at(2026, 10, 30),
    );
    expect(days.map(ymd)).toEqual([
      '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04',
    ]);
    days.forEach((d) => expect(d.getHours()).toBe(0));
  });
});

describe('projectDueDates', () => {
  const plant = { waterIntervalDays: 3 };
  const today = at(2026, 5, 10, 9);
  it('lists first due then every interval within range', () => {
    const r = projectDueDates(plant, at(2026, 5, 10), null, at(2026, 5, 1), at(2026, 5, 25), today);
    expect(r.map(ymd)).toEqual(['2026-05-13', '2026-05-16', '2026-05-19', '2026-05-22', '2026-05-25']);
  });
  it('shows overdue on today then continues', () => {
    const r = projectDueDates(plant, at(2026, 5, 1), null, at(2026, 5, 1), at(2026, 5, 17), today);
    expect(r.map(ymd)).toEqual(['2026-05-10', '2026-05-13', '2026-05-16']);
  });
  it('never watered shows today', () => {
    const r = projectDueDates(plant, null, null, at(2026, 5, 10), at(2026, 5, 11), today);
    expect(r.map(ymd)).toEqual(['2026-05-10']);
  });
  it('respects override then interval', () => {
    const p = { ...plant, nextWateringOverride: at(2026, 5, 14) };
    const r = projectDueDates(p, at(2026, 5, 5), at(2026, 5, 9), at(2026, 5, 11), at(2026, 5, 21), today);
    expect(r.map(ymd)).toEqual(['2026-05-14', '2026-05-17', '2026-05-20']);
  });
  it('clips to the range start and handles no interval', () => {
    const r = projectDueDates(plant, at(2026, 5, 10), null, at(2026, 5, 15), at(2026, 5, 17), today);
    expect(r.map(ymd)).toEqual(['2026-05-16']);
    expect(projectDueDates({}, at(2026, 5, 10), null, at(2026, 5, 1), at(2026, 5, 30), today)).toEqual([]);
  });
});

describe('projectFertilizerDates', () => {
  const plant = { fertilizerIntervalDays: 14 };
  const today = at(2026, 5, 10);
  it('projects from last fertilized', () => {
    const r = projectFertilizerDates(plant, at(2026, 5, 5), at(2026, 5, 1), at(2026, 6, 30), today);
    expect(r.map(ymd)).toEqual(['2026-05-19', '2026-06-02', '2026-06-16', '2026-06-30']);
  });
  it('overdue shows today; never shows today; unset is empty', () => {
    expect(projectFertilizerDates(plant, at(2026, 4, 1), at(2026, 5, 1), at(2026, 5, 11), today).map(ymd)).toEqual(['2026-05-10']);
    expect(projectFertilizerDates(plant, null, at(2026, 5, 1), at(2026, 5, 11), today).map(ymd)).toEqual(['2026-05-10']);
    expect(projectFertilizerDates({}, at(2026, 5, 1), at(2026, 5, 1), at(2026, 5, 30), today)).toEqual([]);
  });
});
