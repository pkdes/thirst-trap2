// Backfill plants.lastWateredAt / lastCheckedAt / lastFertilizedAt from the log collections.
//
// Usage (from repo root):
//   node scripts/backfill-last-care.mjs [--project <id>] [--apply]
//
// Dry run by default: prints planned changes and counts. Writes only with --apply.
// Auth: Application Default Credentials (gcloud auth application-default login), or set
// FIRESTORE_EMULATOR_HOST to target the emulator. Project defaults to .firebaserc "default".
// A field is deleted from the plant when it has no logs. Re-running is safe.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'functions', 'index.js'));
const admin = require('firebase-admin');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const pIdx = args.indexOf('--project');
let projectId = pIdx >= 0 ? args[pIdx + 1] : undefined;
if (!projectId) {
  projectId = JSON.parse(readFileSync(path.join(root, '.firebaserc'), 'utf8')).projects?.default;
}
if (!projectId) {
  console.error('No project: pass --project <id> or set projects.default in .firebaserc');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

const SOURCES = [
  { field: 'lastWateredAt', collection: 'wateringLogs', tsField: 'wateredAt' },
  { field: 'lastCheckedAt', collection: 'checkLogs', tsField: 'checkedAt' },
  { field: 'lastFertilizedAt', collection: 'fertilizerLogs', tsField: 'fertilizedAt' },
];

// One full read per collection, reduced to plantId -> newest Timestamp.
async function latestByPlant({ collection, tsField }) {
  const snap = await db.collection(collection).get();
  const latest = new Map();
  for (const d of snap.docs) {
    const { plantId } = d.data();
    const ts = d.get(tsField);
    if (!plantId || !ts || typeof ts.toMillis !== 'function') continue;
    const cur = latest.get(plantId);
    if (!cur || ts.toMillis() > cur.toMillis()) latest.set(plantId, ts);
  }
  return latest;
}

const sameTs = (a, b) => (a && b ? a.toMillis() === b.toMillis() : !a && !b);
const fmt = (ts) => (ts ? ts.toDate().toISOString() : '-');

console.log(`Project: ${projectId}${process.env.FIRESTORE_EMULATOR_HOST ? ` (emulator ${process.env.FIRESTORE_EMULATOR_HOST})` : ''}`);
console.log(apply ? 'Mode: APPLY' : 'Mode: dry run (pass --apply to write)');

const maps = await Promise.all(SOURCES.map(latestByPlant));
const plantsSnap = await db.collection('plants').get();

const changes = [];
for (const plantDoc of plantsSnap.docs) {
  const update = {};
  const rows = [];
  SOURCES.forEach((src, i) => {
    const want = maps[i].get(plantDoc.id) ?? null;
    // null (not a missing field) means "never": the reminder function treats a
    // missing field as "not backfilled yet" and falls back to querying logs.
    const present = plantDoc.get(src.field) !== undefined;
    const have = plantDoc.get(src.field) ?? null;
    if (present && sameTs(want, have)) return;
    update[src.field] = want;
    rows.push(`${src.field}: ${present ? fmt(have) : '(missing)'} -> ${want ? fmt(want) : 'null'}`);
  });
  if (rows.length) changes.push({ ref: plantDoc.ref, id: plantDoc.id, name: plantDoc.get('name'), update, rows });
}

console.log(`\nPlants: ${plantsSnap.size}, needing change: ${changes.length}, already correct: ${plantsSnap.size - changes.length}`);
if (changes.length) {
  console.table(changes.flatMap((c) => c.rows.map((r) => ({ plant: c.id, name: c.name ?? '', change: r }))));
}

if (apply && changes.length) {
  for (let i = 0; i < changes.length; i += 400) {
    const batch = db.batch();
    for (const c of changes.slice(i, i + 400)) batch.update(c.ref, c.update);
    await batch.commit();
  }
  console.log(`Wrote ${changes.length} plant update(s).`);
} else if (!apply && changes.length) {
  console.log('Dry run: nothing written.');
}
