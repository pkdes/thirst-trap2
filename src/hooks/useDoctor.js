import { useEffect, useMemo, useState, useCallback } from 'react';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { suggest, WINDOW_DAYS } from '../lib/doctor';
import { toDate } from '../lib/dates';

const TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // householdId -> { at, byPlant } (module scope)

/** One-off household-wide fetch of the last 90 days of logs, grouped by plant. */
async function fetchLogs(householdId) {
  const hit = cache.get(householdId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.byPlant;

  const since = Timestamp.fromMillis(Date.now() - WINDOW_DAYS * 86400000);
  const read = async (name, field) => {
    const snap = await getDocs(query(
      collection(db, name),
      where('householdId', '==', householdId),
      where(field, '>=', since),
    ));
    return snap.docs.map(d => ({ plantId: d.data().plantId, date: toDate(d.data()[field]) }));
  };
  const [waters, checks] = await Promise.all([
    read('wateringLogs', 'wateredAt'),
    read('checkLogs', 'checkedAt'),
  ]);

  const byPlant = {};
  const slot = id => (byPlant[id] ||= { waterLogs: [], checkLogs: [] });
  for (const w of waters) if (w.date) slot(w.plantId).waterLogs.push(w.date);
  for (const c of checks) if (c.date) slot(c.plantId).checkLogs.push(c.date);
  cache.set(householdId, { at: Date.now(), byPlant });
  return byPlant;
}

/** Suggestions by plant id for the Home list, plus `hide(plantId)` for instant dismissal. */
export function useDoctor(householdId, plants) {
  const [byPlant, setByPlant] = useState(null);
  const [hidden, setHidden] = useState(() => new Set());

  useEffect(() => {
    if (!householdId) return undefined;
    let live = true;
    fetchLogs(householdId).then(
      data => { if (live) setByPlant(data); },
      err => console.warn('Plant doctor unavailable', err),
    );
    return () => { live = false; };
  }, [householdId]);

  const suggestions = useMemo(() => {
    const out = {};
    if (!byPlant) return out;
    const now = new Date();
    for (const p of plants) {
      if (p.archived || hidden.has(p.id)) continue;
      const s = suggest(p, byPlant[p.id] || {}, now);
      if (s) out[p.id] = s;
    }
    return out;
  }, [byPlant, plants, hidden]);

  const hide = useCallback(id => setHidden(prev => new Set(prev).add(id)), []);
  return { suggestions, hide };
}
