// careLog.js bound to the app's Firestore instance. UI code imports from here.
import { db } from './firebase';
import * as care from './careLog.js';

export { CARE_KINDS, stampFor } from './careLog.js';

export const logCare = opts => care.logCare(db, opts);
export const undoCare = token => care.undoCare(db, token);
export const deleteCare = opts => care.deleteCare(db, opts);
export const restoreCare = token => care.restoreCare(db, token);
export const editCare = opts => care.editCare(db, opts);
