// Plant doctor: rule-based watering-interval suggestions from a plant's own logs.
// Pure functions only; callers convert Firestore Timestamps to Dates first.

import { calendarDaysBetween, toDate } from './dates';

export const WINDOW_DAYS = 90;
export const MIN_WATERINGS = 4;
export const DISMISS_DAYS = 30;
export const MIN_INTERVAL = 1;
export const MAX_INTERVAL = 60;

const clamp = n => Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, n));

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function joinGaps(gaps) {
  if (gaps.length === 1) return String(gaps[0]);
  return `${gaps.slice(0, -1).join(', ')} and ${gaps[gaps.length - 1]}`;
}

function inWindow(dates, now) {
  const cutoff = now.getTime() - WINDOW_DAYS * 86400000;
  return (dates || [])
    .map(toDate)
    .filter(d => d && !isNaN(d) && d.getTime() >= cutoff && d.getTime() <= now.getTime())
    .sort((a, b) => a - b); // oldest first
}

function build(kind, proposedDays, title, reason, chip) {
  const out = { id: `${kind}:${proposedDays ?? ''}`, kind, title, reason, chip };
  if (proposedDays !== undefined) out.proposedDays = proposedDays;
  return out;
}

/**
 * @returns null or { id, kind: 'longer'|'shorter'|'overdue', proposedDays?, title, reason, chip }
 */
export function suggest(plant, { waterLogs = [], checkLogs = [] } = {}, now = new Date()) {
  const interval = plant?.waterIntervalDays;
  if (!interval || interval < 1) return null;

  const dismissed = toDate(plant.doctorDismissedAt);
  if (dismissed && calendarDaysBetween(dismissed, now) < DISMISS_DAYS) return null;

  const waters = inWindow(waterLogs, now);
  if (waters.length < MIN_WATERINGS) return null;
  const checks = inWindow(checkLogs, now);

  const gaps = waters.slice(1).map((d, i) => calendarDaysBetween(waters[i], d));

  // longer: still damp on at least 3 of the last 5 care events
  const events = [
    ...waters.map(d => ({ t: d.getTime(), check: false })),
    ...checks.map(d => ({ t: d.getTime(), check: true })),
  ].sort((a, b) => b.t - a.t).slice(0, 5);
  const damp = events.filter(e => e.check).length;
  if (damp >= 3) {
    const proposed = clamp(Math.round(median(gaps)));
    if (proposed >= interval + 1) {
      const recent = gaps.slice(-4);
      return build(
        'longer', proposed,
        `Water every ${proposed} days instead of ${interval}?`,
        `You checked it ${damp} of the last ${events.length} times and it was still damp. ` +
          `Waterings were ${joinGaps(recent)} days apart.`,
        `Damp ${damp} of ${events.length} · every ${proposed}d?`,
      );
    }
  }

  const recent = gaps.slice(-4); // 3 or 4 gaps given >= 4 waterings

  // shorter: consistently watering early, with no checks in between
  if (median(recent) <= interval - 2) {
    const since = waters[waters.length - 1 - recent.length].getTime();
    const checkedBetween = checks.some(c => c.getTime() > since);
    if (!checkedBetween) {
      const proposed = clamp(Math.round(median(recent)));
      return build(
        'shorter', proposed,
        `Water every ${proposed} days instead of ${interval}?`,
        `The last ${recent.length + 1} waterings were ${joinGaps(recent)} days apart, ` +
          `sooner than the ${interval}-day schedule, with no checks in between.`,
        `Watered early · every ${proposed}d?`,
      );
    }
  }

  // overdue: 3+ of the last 4 waterings came 2+ days after they were due
  const late = recent.filter(g => g > interval + 1).length;
  if (late >= 3) {
    return build(
      'overdue', undefined,
      'Often overdue',
      `${late} of the last ${recent.length} waterings were 2 or more days late ` +
        `(${joinGaps(recent)} days apart on a ${interval}-day schedule). ` +
        'Try turning on reminders, or a shorter interval.',
      'Often overdue',
    );
  }

  return null;
}
