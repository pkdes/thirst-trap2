import { useState } from 'react';
import { format } from 'date-fns';
import { CARE_KINDS, editCare, deleteCare, restoreCare } from '../lib/logging';
import { toDate, todayISO } from '../lib/dates';
import { parseISODate } from '../lib/calendarDays';
import { useBackGuard } from '../hooks/useBackGuard';

const KIND_ORDER = ['water', 'check', 'feed'];

/**
 * Bottom sheet to change a log's kind/date or delete it.
 *
 * `log` is a log doc ({id, plantId, ...}) plus `kind` ('water'|'check'|'feed')
 * and optionally `plantName`; any extra keys are stripped before writing.
 * After a delete, `onDeleted({ message, token })` lets the parent show an undo toast.
 */
export default function EditLogSheet({ log: enriched, user, household, onClose, onDeleted }) {
  // eslint-disable-next-line no-unused-vars
  const { kind, at: _at, plantName, ...log } = enriched;
  const original = toDate(log[CARE_KINDS[kind].at]);
  const originalISO = original ? todayISO(original) : todayISO();
  const [newKind, setNewKind] = useState(kind);
  const [dateStr, setDateStr] = useState(originalISO);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useBackGuard(true, onClose);

  const who = log.loggedBy?.displayName || 'Someone';
  const validDate = !!parseISODate(dateStr) && dateStr <= todayISO();
  const changed = newKind !== kind || dateStr !== originalISO;

  async function save() {
    if (busy || !validDate) return;
    setBusy(true);
    setError('');
    try {
      await editCare({
        log, kind, newKind, householdId: household.id, user,
        newDate: dateStr === originalISO ? null : parseISODate(dateStr),
      });
      onClose();
    } catch (err) {
      console.error('Edit log failed', err);
      setError("Couldn't save. Try again.");
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const token = await deleteCare({ log, kind, householdId: household.id });
      onDeleted?.({
        message: `Deleted ${CARE_KINDS[kind].label.toLowerCase()}${plantName ? ` · ${plantName}` : ''}`,
        token,
        undo: () => restoreCare(token),
      });
      onClose();
    } catch (err) {
      console.error('Delete log failed', err);
      setError("Couldn't delete. Try again.");
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        role="dialog"
        aria-label="Edit log"
        onClick={e => e.stopPropagation()}
        style={{
          background: '#1a2e1a', borderRadius: '20px 20px 0 0', padding: '24px 20px 28px',
          width: '100%', maxWidth: '480px', boxSizing: 'border-box', color: '#fff',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <h3 style={{ margin: '0 0 4px', fontSize: '18px' }}>Edit log</h3>
        <p style={{ margin: '0 0 18px', fontSize: '13px', color: '#a8c5a0' }}>
          {plantName ? `${plantName} · ` : ''}Logged by {who}{original ? ` · ${format(original, 'MMM d, yyyy')}` : ''}
        </p>

        <div role="radiogroup" aria-label="Kind" style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
          {KIND_ORDER.map(k => {
            const active = newKind === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setNewKind(k)}
                style={{
                  flex: 1, minHeight: '44px', borderRadius: '10px', fontSize: '14px', fontWeight: '700',
                  cursor: 'pointer',
                  background: active ? '#4caf50' : '#0f1f0f',
                  color: active ? '#fff' : '#a8c5a0',
                  border: `1px solid ${active ? '#4caf50' : '#2d4a2d'}`,
                }}
              >
                {CARE_KINDS[k].label}
              </button>
            );
          })}
        </div>

        <label style={{ display: 'block', fontSize: '12px', color: '#a8c5a0', marginBottom: '6px' }}>Date</label>
        <input
          type="date"
          value={dateStr}
          max={todayISO()}
          onChange={e => setDateStr(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box', height: '44px', background: '#0f1f0f',
            border: '1px solid #2d4a2d', borderRadius: '10px', padding: '0 12px', color: '#fff',
            fontSize: '16px', colorScheme: 'dark', marginBottom: '18px',
          }}
        />

        {error && <p style={{ color: '#f08a6a', fontSize: '13px', margin: '0 0 12px' }}>{error}</p>}

        {confirming ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ flex: 1, color: '#f08a6a', fontSize: '15px', fontWeight: '600' }}>Delete?</span>
            <button type="button" onClick={remove} disabled={busy} style={{ ...btn, color: '#fff', background: '#c9573a', border: '1px solid #c9573a' }}>
              Yes
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} style={{ ...btn, color: '#a8c5a0', background: 'transparent', border: '1px solid #2d4a2d' }}>
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="button" onClick={() => setConfirming(true)} disabled={busy} style={{ ...btn, color: '#f08a6a', background: 'transparent', border: '1px solid #f08a6a' }}>
              Delete
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || !validDate || !changed}
              style={{ ...btn, color: '#fff', background: '#4caf50', border: '1px solid #4caf50', opacity: busy || !validDate || !changed ? 0.5 : 1 }}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const btn = { flex: 1, minHeight: '44px', borderRadius: '10px', fontSize: '15px', fontWeight: '700', cursor: 'pointer' };
