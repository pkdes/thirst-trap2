// Pure helpers for the Calendar tab.
import { toDate, todayISO, CARE_COLORS } from './dates.js';

/** Sun-first grid cells for a month: leading nulls pad to the first weekday. */
export function buildMonthCells(month) {
  const y = month.getFullYear();
  const m = month.getMonth();
  const count = new Date(y, m + 1, 0).getDate();
  const cells = Array(new Date(y, m, 1).getDay()).fill(null);
  for (let d = 1; d <= count; d++) {
    const date = new Date(y, m, d);
    cells.push({ date, iso: todayISO(date) });
  }
  return cells;
}

/** [start, nextStart) bounds of a month, for the log range queries. */
export function monthBounds(month) {
  return {
    start: new Date(month.getFullYear(), month.getMonth(), 1),
    end: new Date(month.getFullYear(), month.getMonth() + 1, 1),
  };
}

/**
 * Group log docs by local day ('YYYY-MM-DD'). `byKind` is
 * { water: [...], check: [...], feed: [...] } and `atFields` maps kind to the
 * timestamp field. Each result item is { ...log, kind, at: Date }, oldest first.
 */
export function groupLogsByDay(byKind, atFields) {
  const out = {};
  for (const [kind, logs] of Object.entries(byKind)) {
    for (const log of logs) {
      const at = toDate(log[atFields[kind]]);
      if (!at) continue;
      (out[todayISO(at)] ||= []).push({ ...log, kind, at });
    }
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.at - b.at);
  return out;
}

/** Parse 'YYYY-MM-DD' into a local Date, or null. */
export function parseISODate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Dot / label colour per care kind. */
export const KIND_COLOR = {
  water: CARE_COLORS.water,
  check: CARE_COLORS.check,
  feed: CARE_COLORS.fertilizer,
};
