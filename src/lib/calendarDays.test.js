import { describe, it, expect } from 'vitest';
import { buildMonthCells, monthBounds, groupLogsByDay, parseISODate } from './calendarDays.js';

describe('buildMonthCells', () => {
  it('pads to the first weekday (Sun-first) and covers every day', () => {
    const cells = buildMonthCells(new Date(2026, 10, 15)); // Nov 2026 starts on Sunday
    expect(cells[0].iso).toBe('2026-11-01');
    expect(cells.length).toBe(30);
    const feb = buildMonthCells(new Date(2026, 1, 1)); // Feb 2026 starts on Sunday, 28 days
    expect(feb.length).toBe(28);
    const dec = buildMonthCells(new Date(2026, 11, 1)); // Dec 2026 starts on Tuesday
    expect(dec.slice(0, 2)).toEqual([null, null]);
    expect(dec[2].iso).toBe('2026-12-01');
    expect(dec.length).toBe(2 + 31);
  });
});

describe('monthBounds', () => {
  it('rolls December into January', () => {
    const { start, end } = monthBounds(new Date(2026, 11, 20));
    expect(start.getMonth()).toBe(11);
    expect(end.getFullYear()).toBe(2027);
    expect(end.getMonth()).toBe(0);
  });
});

describe('groupLogsByDay', () => {
  it('groups by local day, tags kind, sorts by time', () => {
    const at = (d, h) => ({ toDate: () => new Date(2026, 10, d, h) });
    const out = groupLogsByDay(
      {
        water: [{ id: 'a', wateredAt: at(3, 15) }, { id: 'b', wateredAt: at(3, 9) }],
        check: [{ id: 'c', checkedAt: at(4, 8) }],
        feed: [{ id: 'd' }],
      },
      { water: 'wateredAt', check: 'checkedAt', feed: 'fertilizedAt' },
    );
    expect(out['2026-11-03'].map(l => l.id)).toEqual(['b', 'a']);
    expect(out['2026-11-04'][0].kind).toBe('check');
    expect(Object.keys(out)).toHaveLength(2);
  });
});

describe('parseISODate', () => {
  it('parses valid and rejects invalid', () => {
    expect(parseISODate('2026-11-05').getDate()).toBe(5);
    expect(parseISODate('')).toBeNull();
  });
});
