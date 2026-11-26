import { describe, it, expect } from 'vitest';
import { suggest } from './doctor';

const NOW = new Date(2026, 5, 30, 12, 0, 0);
const day = n => { const d = new Date(NOW); d.setDate(d.getDate() - n); return d; };
// ages in days-ago, any order
const logs = ages => ages.map(day);
// waterings with the given gaps, newest 2 days ago
function watersFromGaps(gaps, newestAgo = 2) {
  const ages = [newestAgo];
  for (const g of [...gaps].reverse()) ages.push(ages[ages.length - 1] + g);
  return logs(ages);
}
const plant = (extra = {}) => ({ waterIntervalDays: 7, ...extra });

describe('suggest: preconditions', () => {
  it('null without an interval', () => {
    expect(suggest({}, { waterLogs: watersFromGaps([9, 9, 9]), checkLogs: [] }, NOW)).toBeNull();
  });
  it('null with fewer than 4 waterings', () => {
    expect(suggest(plant(), { waterLogs: watersFromGaps([9, 9]), checkLogs: [] }, NOW)).toBeNull();
  });
  it('ignores waterings older than 90 days', () => {
    const w = [...watersFromGaps([9, 9]), day(100), day(110)];
    expect(suggest(plant(), { waterLogs: w, checkLogs: [] }, NOW)).toBeNull();
  });
  it('null for a steady on-schedule plant', () => {
    expect(suggest(plant(), { waterLogs: watersFromGaps([7, 7, 7, 7]), checkLogs: [] }, NOW)).toBeNull();
  });
});

describe('longer', () => {
  const water = watersFromGaps([8, 10, 9]); // days ago: 2, 11, 21, 29
  it('fires when 3 of the last 5 events are checks', () => {
    const s = suggest(plant(), { waterLogs: water, checkLogs: logs([1, 5, 8]) }, NOW);
    expect(s.kind).toBe('longer');
    expect(s.proposedDays).toBe(9);
    expect(s.id).toBe('longer:9');
    expect(s.title).toBe('Water every 9 days instead of 7?');
    expect(s.reason).toContain('3 of the last 5');
    expect(s.reason).toContain('8, 10 and 9');
    expect(s.chip).toBe('Damp 3 of 5 · every 9d?');
  });
  it('does not fire with only 2 checks in the last 5 events', () => {
    // events newest first: check1, water2, check5, water11, water21 (two checks)
    expect(suggest(plant(), { waterLogs: water, checkLogs: logs([1, 5]) }, NOW)).toBeNull();
  });
  it('only counts the newest 5 events', () => {
    // 3 old checks fall outside the newest 5 (waters at 2, 11, 21, 29 + 1 check at 1)
    const s = suggest(plant(), { waterLogs: water, checkLogs: logs([1, 40, 41, 42]) }, NOW);
    expect(s).toBeNull();
  });
  it('requires median gap >= interval + 1', () => {
    const w = watersFromGaps([7, 7, 7]);
    expect(suggest(plant(), { waterLogs: w, checkLogs: logs([1, 3, 5]) }, NOW)).toBeNull();
    const w8 = watersFromGaps([8, 8, 8]);
    expect(suggest(plant(), { waterLogs: w8, checkLogs: logs([1, 3, 5]) }, NOW).proposedDays).toBe(8);
  });
  it('handles the longest gaps a 90-day window allows (clamp is 1..60)', () => {
    const w = watersFromGaps([29, 29, 29], 2); // 4 waterings spanning 87 days
    const s = suggest(plant(), { waterLogs: w, checkLogs: logs([0, 1, 1]) }, NOW);
    expect(s.proposedDays).toBe(29);
    expect(s.proposedDays).toBeLessThanOrEqual(60);
  });
  it('rounds the median of an even number of gaps', () => {
    const w = watersFromGaps([8, 9, 10, 11]); // median 9.5 -> 10
    const s = suggest(plant(), { waterLogs: w, checkLogs: logs([1, 3, 5]) }, NOW);
    expect(s.proposedDays).toBe(10);
  });
});

describe('shorter', () => {
  it('fires when the last 4 gaps have median <= interval - 2 and no checks', () => {
    const s = suggest(plant(), { waterLogs: watersFromGaps([5, 4, 5, 5]), checkLogs: [] }, NOW);
    expect(s.kind).toBe('shorter');
    expect(s.proposedDays).toBe(5);
    expect(s.id).toBe('shorter:5');
  });
  it('threshold: median 5 fires at interval 7, 6 does not', () => {
    expect(suggest(plant(), { waterLogs: watersFromGaps([5, 5, 5]), checkLogs: [] }, NOW)).not.toBeNull();
    expect(suggest(plant(), { waterLogs: watersFromGaps([6, 6, 6]), checkLogs: [] }, NOW)).toBeNull();
  });
  it('suppressed by a check within the gaps', () => {
    expect(suggest(plant(), { waterLogs: watersFromGaps([5, 5, 5]), checkLogs: logs([8]) }, NOW)).toBeNull();
  });
  it('a check before the window of gaps does not suppress', () => {
    const s = suggest(plant(), { waterLogs: watersFromGaps([5, 5, 5]), checkLogs: logs([40]) }, NOW);
    expect(s.kind).toBe('shorter');
  });
  it('minimum of 1 day', () => {
    const s = suggest(plant({ waterIntervalDays: 3 }), { waterLogs: watersFromGaps([0, 0, 0]), checkLogs: [] }, NOW);
    expect(s.proposedDays).toBe(1);
  });
});

describe('overdue', () => {
  it('fires when 3 of the last 4 gaps exceed interval + 1', () => {
    const s = suggest(plant(), { waterLogs: watersFromGaps([9, 10, 7, 9]), checkLogs: [] }, NOW);
    expect(s.kind).toBe('overdue');
    expect(s.proposedDays).toBeUndefined();
    expect(s.id).toBe('overdue:');
    expect(s.title).toBe('Often overdue');
    expect(s.reason).toMatch(/reminders/);
  });
  it('gap of exactly interval + 1 is not late', () => {
    expect(suggest(plant(), { waterLogs: watersFromGaps([8, 8, 8, 8]), checkLogs: [] }, NOW)).toBeNull();
  });
  it('2 of 4 is not enough', () => {
    expect(suggest(plant(), { waterLogs: watersFromGaps([9, 9, 7, 7]), checkLogs: [] }, NOW)).toBeNull();
  });
  it('longer takes precedence when it fires', () => {
    const s = suggest(plant(), { waterLogs: watersFromGaps([9, 10, 9, 9]), checkLogs: logs([1, 3, 5]) }, NOW);
    expect(s.kind).toBe('longer');
  });
});

describe('dismissal', () => {
  const base = { waterLogs: watersFromGaps([5, 5, 5]), checkLogs: [] };
  it('suppressed within 30 days', () => {
    expect(suggest(plant({ doctorDismissedAt: day(29) }), base, NOW)).toBeNull();
    expect(suggest(plant({ doctorDismissedAt: day(0) }), base, NOW)).toBeNull();
  });
  it('returns after 30 days', () => {
    expect(suggest(plant({ doctorDismissedAt: day(30) }), base, NOW)).not.toBeNull();
  });
  it('accepts Firestore-like timestamps', () => {
    const ts = { toDate: () => day(3) };
    expect(suggest(plant({ doctorDismissedAt: ts }), base, NOW)).toBeNull();
  });
});
