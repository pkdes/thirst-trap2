import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { readFileSync } from 'fs';

const HOUSE_A = 'AAA111';
const HOUSE_B = 'BBB222';

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${String(e).split('\n')[0]}`); fail++; }
}

const env = await initializeTestEnvironment({
  projectId: 'thirst-trap-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

// Seed: amy in household A, stranger in household B, one plant in each.
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users/amy'), { householdId: HOUSE_A });
  await setDoc(doc(db, 'users/pujan'), { householdId: HOUSE_A });
  await setDoc(doc(db, 'users/stranger'), { householdId: HOUSE_B });
  await setDoc(doc(db, 'households', HOUSE_A), { name: 'Amy', members: ['amy', 'pujan'] });
  await setDoc(doc(db, 'households', HOUSE_B), { name: 'Other', members: ['stranger'] });
  await setDoc(doc(db, 'plants/plantA'), { householdId: HOUSE_A, name: 'Alma' });
  await setDoc(doc(db, 'plants/plantB'), { householdId: HOUSE_B, name: 'Bruno' });
  await setDoc(doc(db, 'wateringLogs/logA'), { householdId: HOUSE_A, plantId: 'plantA' });
  await setDoc(doc(db, 'familyEvents/evA'), { householdId: HOUSE_A, plantId: 'plantA', type: 'repot' });
});

const amy = env.authenticatedContext('amy').firestore();
const stranger = env.authenticatedContext('stranger').firestore();
const anon = env.unauthenticatedContext().firestore();

console.log('\n--- own household ---');
await check('amy reads her own plant', () => assertSucceeds(getDoc(doc(amy, 'plants/plantA'))));
await check('amy lists her household plants', () =>
  assertSucceeds(getDocs(query(collection(amy, 'plants'), where('householdId', '==', HOUSE_A)))));
await check('amy writes a watering log in her household', () =>
  assertSucceeds(setDoc(doc(amy, 'wateringLogs/new1'), { householdId: HOUSE_A, plantId: 'plantA' })));
await check('amy lists logs by household+plant (the app query)', () =>
  assertSucceeds(getDocs(query(collection(amy, 'wateringLogs'),
    where('householdId', '==', HOUSE_A), where('plantId', '==', 'plantA')))));
await check('amy lists familyEvents by household+plant', () =>
  assertSucceeds(getDocs(query(collection(amy, 'familyEvents'),
    where('householdId', '==', HOUSE_A), where('plantId', '==', 'plantA')))));
await check('amy reads her own user doc', () => assertSucceeds(getDoc(doc(amy, 'users/amy'))));

console.log('\n--- THE OLD HOLE: cross-household access must be denied ---');
await check('stranger CANNOT read amy\'s plant', () => assertFails(getDoc(doc(stranger, 'plants/plantA'))));
await check('stranger CANNOT list amy\'s plants', () =>
  assertFails(getDocs(query(collection(stranger, 'plants'), where('householdId', '==', HOUSE_A)))));
await check('stranger CANNOT list ALL plants', () =>
  assertFails(getDocs(collection(stranger, 'plants'))));
await check('stranger CANNOT overwrite amy\'s plant', () =>
  assertFails(updateDoc(doc(stranger, 'plants/plantA'), { name: 'pwned' })));
await check('stranger CANNOT delete amy\'s plant', () =>
  assertFails(deleteDoc(doc(stranger, 'plants/plantA'))));
await check('stranger CANNOT read amy\'s watering logs', () =>
  assertFails(getDoc(doc(stranger, 'wateringLogs/logA'))));
await check('stranger CANNOT read amy\'s user doc', () => assertFails(getDoc(doc(stranger, 'users/amy'))));
await check('stranger CANNOT plant a doc INTO amy\'s household', () =>
  assertFails(setDoc(doc(stranger, 'plants/evil'), { householdId: HOUSE_A, name: 'evil' })));
await check('stranger CANNOT move amy\'s plant into their household', () =>
  assertFails(updateDoc(doc(stranger, 'plants/plantA'), { householdId: HOUSE_B })));

console.log('\n--- anonymous ---');
await check('signed-out CANNOT read plants', () => assertFails(getDoc(doc(anon, 'plants/plantA'))));
await check('signed-out CANNOT read households', () => assertFails(getDoc(doc(anon, 'households/' + HOUSE_A))));

console.log('\n--- invite-code join flow still works ---');
const newbie = env.authenticatedContext('newbie').firestore();
await check('a signed-in user can GET a household by its invite code', () =>
  assertSucceeds(getDoc(doc(newbie, 'households/' + HOUSE_B))));
await check('but CANNOT enumerate households', () =>
  assertFails(getDocs(collection(newbie, 'households'))));
await check('newbie can join a household with room (adds self)', () =>
  assertSucceeds(updateDoc(doc(newbie, 'households/' + HOUSE_B), { members: ['stranger', 'newbie'] })));
await check('newbie CANNOT join a FULL household', () =>
  assertFails(updateDoc(doc(newbie, 'households/' + HOUSE_A), { members: ['amy', 'pujan', 'newbie'] })));
await check('newbie can create their own household', () =>
  assertSucceeds(setDoc(doc(newbie, 'households/CCC333'), { name: 'New', members: ['newbie'] })));
await check('newbie CANNOT create a household owned by someone else', () =>
  assertFails(setDoc(doc(newbie, 'households/DDD444'), { name: 'X', members: ['amy'] })));

console.log('\n--- user doc: householdId must be a household that lists you ---');
const intruder = env.authenticatedContext('intruder').firestore();
await check('intruder CANNOT point their user doc at a household they are not in', () =>
  assertFails(setDoc(doc(intruder, 'users/intruder'), { householdId: HOUSE_A, displayName: 'X' })));
await check('so intruder still CANNOT read that household\'s plants', () =>
  assertFails(getDoc(doc(intruder, 'plants/plantA'))));
await check('amy CANNOT switch her user doc to another household', () =>
  assertFails(updateDoc(doc(amy, 'users/amy'), { householdId: HOUSE_B })));
await check('amy can update her own notification settings', () =>
  assertSucceeds(updateDoc(doc(amy, 'users/amy'), { 'notifications.enabled': true, 'notifications.time': 'morning' })));
await check('amy CANNOT add arbitrary keys to her user doc', () =>
  assertFails(updateDoc(doc(amy, 'users/amy'), { isAdmin: true })));
await check('newbie (now a member of B) can set householdId to B', () =>
  assertSucceeds(setDoc(doc(newbie, 'users/newbie'), { householdId: HOUSE_B, displayName: 'N', email: 'n@x', photoURL: null })));
await check('newbie can set householdId to the household they created', () =>
  assertSucceeds(setDoc(doc(newbie, 'users/newbie'), { householdId: 'CCC333', displayName: 'N' })));

console.log('\n--- care log edits ---');
const { Timestamp } = await import('firebase/firestore');
await env.withSecurityRulesDisabled(async ctx => {
  await setDoc(doc(ctx.firestore(), 'wateringLogs/logEdit'),
    { householdId: HOUSE_A, plantId: 'plantA', wateredAt: Timestamp.now(), loggedBy: { userId: 'amy' } });
});
await check('amy can change the date of her household\'s log', () =>
  assertSucceeds(updateDoc(doc(amy, 'wateringLogs/logEdit'),
    { wateredAt: Timestamp.fromDate(new Date(2026, 0, 1, 12)), editedBy: 'amy', editedAt: Timestamp.now() })));
await check('amy CANNOT re-point a log at another plant', () =>
  assertFails(updateDoc(doc(amy, 'wateringLogs/logEdit'), { plantId: 'plantB' })));
await check('amy CANNOT rewrite who logged it', () =>
  assertFails(updateDoc(doc(amy, 'wateringLogs/logEdit'), { loggedBy: { userId: 'pujan' } })));
await check('amy CANNOT set the date to a non-timestamp', () =>
  assertFails(updateDoc(doc(amy, 'wateringLogs/logEdit'), { wateredAt: 'yesterday' })));
await check('stranger CANNOT edit amy\'s log', () =>
  assertFails(updateDoc(doc(stranger, 'wateringLogs/logEdit'), { wateredAt: Timestamp.now() })));
await check('amy can delete her household\'s log', () =>
  assertSucceeds(deleteDoc(doc(amy, 'wateringLogs/logEdit'))));

console.log('\n--- calendar month query ---');
await check('amy can query a month of her household\'s watering logs', () =>
  assertSucceeds(getDocs(query(collection(amy, 'wateringLogs'), where('householdId', '==', HOUSE_A),
    where('wateredAt', '>=', Timestamp.fromDate(new Date(2026, 10, 1))),
    where('wateredAt', '<', Timestamp.fromDate(new Date(2026, 11, 1)))))));
await check('stranger CANNOT run that query on amy\'s household', () =>
  assertFails(getDocs(query(collection(stranger, 'wateringLogs'), where('householdId', '==', HOUSE_A),
    where('wateredAt', '>=', Timestamp.fromDate(new Date(2026, 10, 1)))))));

console.log(`\n${pass} passed, ${fail} failed\n`);
await env.cleanup();
process.exit(fail ? 1 : 0);
