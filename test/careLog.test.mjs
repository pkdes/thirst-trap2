// Runs src/lib/careLog.js against the Firestore emulator *with the real security
// rules*, as a signed-in household member. Run via `npm run test:care`.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, getDocs, collection, Timestamp } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { logCare, undoCare, deleteCare, restoreCare, editCare } from '../src/lib/careLog.js';

const H = 'HOUSE1';
let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${String(e).split('\n')[0]}`); fail++; }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${b}, got ${a}`);
}
const ms = ts => (ts ? ts.toMillis() : null);
const day = (y, m, d) => new Date(y, m - 1, d);
const noon = (y, m, d) => new Date(y, m - 1, d, 12).getTime();

const env = await initializeTestEnvironment({
  projectId: 'thirst-trap-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});
await env.clearFirestore();
const override = Timestamp.fromDate(day(2030, 1, 1));
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users/amy'), { householdId: H });
  await setDoc(doc(db, 'households', H), { members: ['amy'] });
  await setDoc(doc(db, 'plants/p1'), { householdId: H, name: 'Mint', waterIntervalDays: 7, lastWateredAt: null, nextWateringOverride: override });
  await setDoc(doc(db, 'plants/p2'), { householdId: H, name: 'Basil', waterIntervalDays: 3, lastWateredAt: null });
});

const db = env.authenticatedContext('amy').firestore();
const user = { uid: 'amy', displayName: 'Amy L' };
const household = { id: H };
// Assertions read through an admin context: the rules (correctly) deny listing a
// whole collection or reading a doc that no longer exists.
const admin = async fn => { let out; await env.withSecurityRulesDisabled(async ctx => { out = await fn(ctx.firestore()); }); return out; };
const plant = id => admin(async a => ({ id, ...(await getDoc(doc(a, 'plants', id))).data() }));
const logsOf = coll => admin(async a => (await getDocs(collection(a, coll))).docs
  .map(d => ({ id: d.id, ...d.data() })).filter(l => l.householdId === H));
const raw = (coll, id) => admin(async a => getDoc(doc(a, coll, id)));

console.log('\n--- logCare / undoCare ---');
let token;
await check('water two plants in one batch sets lastWateredAt and clears the override', async () => {
  token = await logCare(db, { plants: [await plant('p1'), await plant('p2')], kind: 'water', household, user });
  eq((await logsOf('wateringLogs')).length, 2, 'log count');
  const p1 = await plant('p1');
  if (!p1.lastWateredAt) throw new Error('lastWateredAt not set');
  eq(p1.nextWateringOverride, undefined, 'override cleared');
});
await check('undo deletes the logs, nulls lastWateredAt, restores the override', async () => {
  await undoCare(db, token);
  eq((await logsOf('wateringLogs')).length, 0, 'log count');
  const p1 = await plant('p1');
  eq(p1.lastWateredAt, null, 'lastWateredAt');
  eq(ms(p1.nextWateringOverride), ms(override), 'override restored');
  eq((await plant('p2')).nextWateringOverride, undefined, 'p2 had no override, still none');
});

await check('back-dating an OLDER watering does not move lastWateredAt back or clear a newer override', async () => {
  await logCare(db, { plants: [await plant('p1')], kind: 'water', date: day(2026, 11, 20), household, user });
  const ref = await plant('p1');
  eq(ms(ref.lastWateredAt), noon(2026, 11, 20), 'first');
  await logCare(db, { plants: [await plant('p1')], kind: 'check', pushDays: 2, household, user });
  await logCare(db, { plants: [await plant('p1')], kind: 'water', date: day(2026, 11, 10), household, user });
  const p1 = await plant('p1');
  eq(ms(p1.lastWateredAt), noon(2026, 11, 20), 'still the 20th');
  if (!p1.nextWateringOverride) throw new Error('override from the check was cleared');
});

console.log('\n--- deleteCare / restoreCare ---');
let delToken;
await check('deleting the newest watering falls back to the previous one', async () => {
  const logs = await logsOf('wateringLogs');
  const newest = logs.find(l => ms(l.wateredAt) === noon(2026, 11, 20));
  delToken = await deleteCare(db, { log: newest, kind: 'water', householdId: H });
  eq(ms((await plant('p1')).lastWateredAt), noon(2026, 11, 10), 'fell back to the 10th');
});
await check('restore puts the same doc id back and lastWateredAt forward again', async () => {
  await restoreCare(db, delToken);
  eq(!!(await raw('wateringLogs', delToken.id)).exists(), true, 'doc back');
  eq(ms((await plant('p1')).lastWateredAt), noon(2026, 11, 20), 'back to the 20th');
});
await check('deleting the only watering sets lastWateredAt to null', async () => {
  const t = await logCare(db, { plants: [await plant('p2')], kind: 'water', household, user });
  const log = (await logsOf('wateringLogs')).find(l => l.id === t.logIds[0]);
  await deleteCare(db, { log, kind: 'water', householdId: H });
  eq((await plant('p2')).lastWateredAt, null, 'null');
});

console.log('\n--- editCare ---');
await check('changing the date updates the log and recomputes lastWateredAt', async () => {
  const log = (await logsOf('wateringLogs')).find(l => ms(l.wateredAt) === noon(2026, 11, 20));
  await editCare(db, { log, kind: 'water', newDate: day(2026, 11, 22), user, householdId: H });
  const after = (await raw('wateringLogs', log.id)).data();
  eq(ms(after.wateredAt), noon(2026, 11, 22), 'log date');
  eq(after.editedBy.userId, 'amy', 'editedBy');
  eq(ms((await plant('p1')).lastWateredAt), noon(2026, 11, 22), 'plant field');
});
await check('changing water -> check moves the log and fixes both fields', async () => {
  const log = (await logsOf('wateringLogs')).find(l => ms(l.wateredAt) === noon(2026, 11, 22));
  const newId = await editCare(db, { log, kind: 'water', newKind: 'check', user, householdId: H });
  eq((await raw('wateringLogs', log.id)).exists(), false, 'old doc gone');
  const moved = (await raw('checkLogs', newId)).data();
  eq(ms(moved.checkedAt), noon(2026, 11, 22), 'kept its date');
  eq(moved.loggedBy.userId, 'amy', 'kept original author');
  const p1 = await plant('p1');
  eq(ms(p1.lastWateredAt), noon(2026, 11, 10), 'water falls back');
  if (ms(p1.lastCheckedAt) < noon(2026, 11, 22)) throw new Error('lastCheckedAt not moved forward');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
await env.cleanup();
process.exit(fail ? 1 : 0);
