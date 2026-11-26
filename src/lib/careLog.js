// Every water / check / feed write goes through here.
//
// Each plant carries denormalized lastWateredAt / lastCheckedAt / lastFertilizedAt
// so the Home screen and the reminder function never have to read the whole log
// history. These helpers keep those fields in step with the logs on every create,
// undo, edit and delete. `null` means "never"; a missing field means "not
// backfilled yet" (see scripts/backfill-last-care.mjs).
//
// The functions take the Firestore instance as their first argument so they can
// run against the emulator in tests; src/lib/logging.js binds them to the app's db.

import {
  collection, doc, writeBatch, getDocs, query, where,
  Timestamp, deleteField,
} from 'firebase/firestore';
import { startOfLocalDay } from './dates.js';
import { addDays } from 'date-fns';

export const CARE_KINDS = {
  water: { coll: 'wateringLogs', at: 'wateredAt', last: 'lastWateredAt', label: 'Watered' },
  check: { coll: 'checkLogs', at: 'checkedAt', last: 'lastCheckedAt', label: 'Checked' },
  feed: { coll: 'fertilizerLogs', at: 'fertilizedAt', last: 'lastFertilizedAt', label: 'Fed' },
};

export function kindOf(name) {
  const k = CARE_KINDS[name];
  if (!k) throw new Error(`Unknown care kind: ${name}`);
  return k;
}

/** Back-dated entries are stamped at local noon so they never slip across midnight. */
export function stampFor(date) {
  if (!date) return Timestamp.now();
  return Timestamp.fromDate(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0));
}

const millis = ts => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : null);

function later(a, b) {
  const ma = millis(a), mb = millis(b);
  if (ma === null) return b ?? null;
  if (mb === null) return a ?? null;
  return ma >= mb ? a : b;
}

export function loggedByFor(user) {
  return { userId: user.uid, displayName: user.displayName?.split(' ')[0] || 'Someone' };
}

/**
 * Log one kind of care for one or more plants in a single batch.
 *
 * `plants` are the current plant objects (from the plants listener), which is
 * where the undo snapshot comes from — no extra reads. `pushDays` (checks only)
 * pushes the next watering out by that many days, as the Care tab's check popup does.
 *
 * Returns an undo token for undoCare().
 */
export async function logCare(db, { plants, kind, date = null, household, user, pushDays = null }) {
  const k = kindOf(kind);
  const at = stampFor(date);
  const batch = writeBatch(db);
  const logIds = [];
  const prior = [];

  for (const plant of plants) {
    const logRef = doc(collection(db, k.coll));
    logIds.push(logRef.id);
    batch.set(logRef, {
      plantId: plant.id,
      householdId: household.id,
      [k.at]: at,
      loggedBy: loggedByFor(user),
    });

    prior.push({
      id: plant.id,
      last: plant[k.last] ?? null,
      override: plant.nextWateringOverride ?? null,
    });

    const newest = later(plant[k.last] ?? null, at);
    const update = { [k.last]: newest };

    // A watering resets the schedule — but only if it is now the latest one
    // (back-dating an old watering shouldn't clear a check made since).
    if (kind === 'water' && newest === at) update.nextWateringOverride = deleteField();

    if (kind === 'check' && pushDays !== null) {
      update.nextWateringOverride = Timestamp.fromDate(addDays(startOfLocalDay(new Date()), pushDays));
    }

    batch.update(doc(db, 'plants', plant.id), update);
  }

  await batch.commit();
  return { kind, logIds, prior, householdId: household.id };
}

/** Newest timestamp among a plant's logs of one kind, ignoring `excludeIds`. */
async function latestFor(db, k, householdId, plantId, excludeIds = []) {
  const snap = await getDocs(query(
    collection(db, k.coll),
    where('householdId', '==', householdId),
    where('plantId', '==', plantId),
  ));
  let best = null;
  snap.forEach(d => {
    if (excludeIds.includes(d.id)) return;
    best = later(best, d.data()[k.at] ?? null);
  });
  return best;
}

/**
 * Reverse a logCare() call: delete its logs and restore each plant.
 *
 * The last-care field is recomputed from the logs that remain rather than
 * restored from the snapshot, so a log the other household member made in the
 * meantime isn't lost. The watering override is restored from the snapshot.
 */
export async function undoCare(db, token) {
  const k = kindOf(token.kind);
  const batch = writeBatch(db);
  for (const id of token.logIds) batch.delete(doc(db, k.coll, id));

  for (const p of token.prior) {
    const last = await latestFor(db, k, token.householdId, p.id, token.logIds);
    const update = { [k.last]: last };
    if (token.kind === 'water' || token.kind === 'check') {
      update.nextWateringOverride = p.override ?? deleteField();
    }
    batch.update(doc(db, 'plants', p.id), update);
  }
  await batch.commit();
}

/**
 * Delete one log. `log` is {id, plantId, ...data}. Returns an undo token for
 * restoreCare(), which puts the exact document back under the same id.
 */
export async function deleteCare(db, { log, kind, householdId }) {
  const k = kindOf(kind);
  const last = await latestFor(db, k, householdId, log.plantId, [log.id]);
  const batch = writeBatch(db);
  batch.delete(doc(db, k.coll, log.id));
  batch.update(doc(db, 'plants', log.plantId), { [k.last]: last });
  await batch.commit();
  const { id, ...data } = log;
  return { kind, id, data, householdId };
}

export async function restoreCare(db, token) {
  const k = kindOf(token.kind);
  const last = await latestFor(db, k, token.householdId, token.data.plantId);
  const batch = writeBatch(db);
  batch.set(doc(db, k.coll, token.id), token.data);
  batch.update(doc(db, 'plants', token.data.plantId), { [k.last]: later(last, token.data[k.at]) });
  await batch.commit();
}

/**
 * Change a log's date and/or kind. Changing kind moves it to the other
 * collection (delete + create); the security rules only let an update touch the
 * date, so a log can never be re-pointed at another plant.
 */
export async function editCare(db, { log, kind, newKind = kind, newDate = null, user, householdId }) {
  const from = kindOf(kind);
  const to = kindOf(newKind);
  const at = newDate ? stampFor(newDate) : log[from.at];
  const editedBy = loggedByFor(user);
  const editedAt = Timestamp.now();
  const batch = writeBatch(db);

  if (newKind === kind) {
    batch.update(doc(db, from.coll, log.id), { [from.at]: at, editedBy, editedAt });
    const others = await latestFor(db, from, householdId, log.plantId, [log.id]);
    batch.update(doc(db, 'plants', log.plantId), { [from.last]: later(others, at) });
    await batch.commit();
    return log.id;
  }

  const newRef = doc(collection(db, to.coll));
  batch.delete(doc(db, from.coll, log.id));
  batch.set(newRef, {
    plantId: log.plantId,
    householdId,
    [to.at]: at,
    loggedBy: log.loggedBy ?? editedBy,
    editedBy,
    editedAt,
  });
  const fromLast = await latestFor(db, from, householdId, log.plantId, [log.id]);
  const toLast = await latestFor(db, to, householdId, log.plantId);
  batch.update(doc(db, 'plants', log.plantId), {
    [from.last]: fromLast,
    [to.last]: later(toLast, at),
  });
  await batch.commit();
  return newRef.id;
}
