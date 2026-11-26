// Calendar-day math for care schedules.
//
// Everything normalizes to local midnight before subtracting, so a plant watered
// at 11pm and one watered at 1am the same day read identically. Previously three
// screens each rolled their own version of this and two of them floored raw
// elapsed milliseconds, which made "In 2 days" linger a day too long and let the
// "Tomorrow" step get skipped entirely.

import { addDays } from 'date-fns';

export const CARE_COLORS = {
  water: '#5ba3be',
  fertilizer: '#c06080',
  check: '#8eb85a',
  ok: '#4caf50',
  late: '#e07b39',
  muted: '#a8c5a0',
};

export function toDate(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  return null;
}

export function startOfLocalDay(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Local calendar date as 'YYYY-MM-DD' (toISOString would give the UTC date). */
export function todayISO(date = new Date()) {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole calendar days from `from` to `to`. Negative when `to` is earlier. */
export function calendarDaysBetween(from, to) {
  return Math.round((startOfLocalDay(to) - startOfLocalDay(from)) / 86400000);
}

/** Calendar days elapsed since a Firestore timestamp, or null if there isn't one. */
export function daysSince(ts) {
  const d = toDate(ts);
  return d === null ? null : calendarDaysBetween(d, new Date());
}

/** Calendar days from today until a Firestore timestamp, or null if there isn't one. */
export function daysUntil(ts) {
  const d = toDate(ts);
  return d === null ? null : calendarDaysBetween(new Date(), d);
}

function secondsOf(ts) {
  const d = toDate(ts);
  return d === null ? -Infinity : d.getTime();
}

/**
 * Human wording for "how long until this is due".
 * `short` trims it for tight spots like the Thirst Quencher rows.
 */
export function dueLabel(until, { short = false } = {}) {
  if (until === null) return short ? 'Never' : 'Never watered';
  if (until === 0) return 'Due today';
  if (until === 1) return 'Tomorrow';
  if (until > 1) return short ? `In ${until}d` : `In ${until} days`;
  const late = Math.abs(until);
  if (short) return `${late}d late`;
  return `${late} day${late !== 1 ? 's' : ''} late`;
}

export function agoLabel(days) {
  if (days === null) return 'Never';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

/**
 * Local-midnight Date the next watering is due, using the same rules as
 * wateringStatus: a check after the last watering with a nextWateringOverride
 * wins over the interval. Returns null when there is no interval, or when the
 * plant has never been watered and has no override (nothing to count from).
 * Past dates are returned as-is when overdue.
 */
export function nextDueDate(plant, lastWateredTs, lastCheckedTs, today = new Date()) {
  void today; // due date is independent of "today"; kept for a uniform call signature
  const interval = plant?.waterIntervalDays || null;
  if (!interval) return null;
  const watered = toDate(lastWateredTs);
  const checkedAfterWatering =
    !!lastCheckedTs && secondsOf(lastCheckedTs) > secondsOf(lastWateredTs);
  const override =
    checkedAfterWatering && plant?.nextWateringOverride ? toDate(plant.nextWateringOverride) : null;
  if (override) return startOfLocalDay(override);
  if (!watered) return null;
  return addDays(startOfLocalDay(watered), interval);
}

/**
 * Everything the UI needs to render a plant's watering badge.
 *
 * state is one of:
 *   'unset' — no interval configured, we only know how long it's been
 *   'never' — interval set but never watered and nothing has pushed the schedule
 *   'late'  — past due
 *   'due'   — due today
 *   'ok'    — due tomorrow or later
 */
export function wateringStatus(plant, lastWateredTs, lastCheckedTs) {
  const interval = plant?.waterIntervalDays || null;
  const ago = daysSince(lastWateredTs);
  const checkedAfterWatering =
    !!lastCheckedTs && secondsOf(lastCheckedTs) > secondsOf(lastWateredTs);

  if (!interval) {
    return {
      interval: null,
      daysAgo: ago,
      daysUntil: null,
      checkedAfterWatering,
      state: 'unset',
      label: ago === null ? 'Never watered' : ago === 0 ? 'Watered today' : agoLabel(ago),
      shortLabel: ago === null ? 'Never' : ago === 0 ? 'Today' : `${ago}d ago`,
      icon: checkedAfterWatering ? '✓' : '💧',
      color: ago === null ? CARE_COLORS.late : CARE_COLORS.ok,
    };
  }

  // nextDueDate applies the check override (which wins over the interval until the
  // plant is watered again), so the day count always matches the due date.
  const due = nextDueDate(plant, lastWateredTs, lastCheckedTs);
  const until = due === null ? null : calendarDaysBetween(new Date(), due);

  let state;
  if (until === null) state = 'never';
  else if (until < 0) state = 'late';
  else if (until === 0) state = 'due';
  else state = 'ok';

  const color =
    state === 'never' || state === 'late'
      ? CARE_COLORS.late
      : state === 'due'
        ? CARE_COLORS.water
        : checkedAfterWatering
          ? CARE_COLORS.check
          : CARE_COLORS.ok;

  return {
    interval,
    daysAgo: ago,
    daysUntil: until,
    checkedAfterWatering,
    state,
    label: state === 'never' ? 'Never watered' : dueLabel(until),
    shortLabel: state === 'never' ? 'Never' : dueLabel(until, { short: true }),
    icon: state === 'ok' && checkedAfterWatering ? '✓' : '💧',
    color,
  };
}

/** Same shape as wateringStatus, for the fertilizer schedule. */
export function fertilizerStatus(plant, lastFertilizedTs) {
  const interval = plant?.fertilizerIntervalDays || null;
  const ago = daysSince(lastFertilizedTs);

  if (!interval) {
    return {
      interval: null,
      daysAgo: ago,
      daysUntil: null,
      state: 'unset',
      label: ago === null ? 'Never fertilized' : ago === 0 ? 'Fertilized today' : agoLabel(ago),
      color: CARE_COLORS.fertilizer,
    };
  }

  const until = ago === null ? null : interval - ago;
  const state = until === null ? 'never' : until < 0 ? 'late' : until === 0 ? 'due' : 'ok';

  return {
    interval,
    daysAgo: ago,
    daysUntil: until,
    state,
    label:
      state === 'never'
        ? 'Never fertilized'
        : until === 0
          ? 'Due today'
          : until === 1
            ? 'Tomorrow'
            : until > 1
              ? `In ${until} days`
              : `${Math.abs(until)} day${Math.abs(until) !== 1 ? 's' : ''} late`,
    color:
      state === 'never' || state === 'late' ? CARE_COLORS.late : CARE_COLORS.fertilizer,
  };
}

function projectFrom(first, interval, rangeStart, rangeEnd, today) {
  const start = startOfLocalDay(rangeStart);
  const end = startOfLocalDay(rangeEnd);
  const todayStart = startOfLocalDay(today);
  const out = [];
  // Overdue (or never done) items show on today; later ones follow the interval.
  let d = first === null || first < todayStart ? todayStart : first;
  for (let i = 0; d <= end && i < 10000; i++) {
    if (d >= start) out.push(d);
    d = addDays(d, interval);
  }
  return out;
}

/** Local-midnight dates in [rangeStart, rangeEnd] when watering is projected. */
export function projectDueDates(plant, lastWateredTs, lastCheckedTs, rangeStart, rangeEnd, today = new Date()) {
  const interval = plant?.waterIntervalDays || null;
  if (!interval) return [];
  const first = nextDueDate(plant, lastWateredTs, lastCheckedTs, today);
  return projectFrom(first, interval, rangeStart, rangeEnd, today);
}

/** Same as projectDueDates, mirroring fertilizerStatus (no override concept). */
export function projectFertilizerDates(plant, lastFertilizedTs, rangeStart, rangeEnd, today = new Date()) {
  const interval = plant?.fertilizerIntervalDays || null;
  if (!interval) return [];
  const last = toDate(lastFertilizedTs);
  const first = last ? addDays(startOfLocalDay(last), interval) : null;
  return projectFrom(first, interval, rangeStart, rangeEnd, today);
}

/** Sort key for the "Thirstiest" sort — higher means needs water sooner. */
export function thirstScore(plant, lastWateredTs, lastCheckedTs) {
  const status = wateringStatus(plant, lastWateredTs, lastCheckedTs);
  if (!status.interval) return -1;
  if (status.daysUntil === null) return status.interval + 1000;
  return -status.daysUntil / status.interval;
}
