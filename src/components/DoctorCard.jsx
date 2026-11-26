import { useState } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

const btn = {
  minHeight: '44px', padding: '0 14px', borderRadius: '10px', boxSizing: 'border-box',
  fontSize: '14px', fontWeight: '600', cursor: 'pointer', touchAction: 'manipulation',
};

/**
 * Amber plant-doctor card. `onResolved(patch)` runs after a successful write so the
 * caller can hide the card straight away (a pending serverTimestamp reads as null).
 */
export default function DoctorCard({ plant, suggestion, onResolved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function write(patch) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await updateDoc(doc(db, 'plants', plant.id), { ...patch, doctorDismissedAt: serverTimestamp() });
      onResolved?.(patch);
    } catch (err) {
      console.error('Plant doctor update failed', err);
      setError(true);
      setBusy(false);
    }
  }

  const stop = e => e.stopPropagation();
  return (
    <div
      role="region"
      aria-label={`Plant doctor: ${suggestion.title}`}
      onClick={stop}
      onPointerDown={stop}
      onKeyDown={stop}
      style={{
        background: '#2a2614', border: '1px solid #8a7030', borderRadius: '12px',
        padding: '12px', boxSizing: 'border-box', width: '100%', cursor: 'default',
      }}
    >
      <div style={{ color: '#e0c070', fontSize: '14px', fontWeight: '700' }}>🩺 {suggestion.title}</div>
      <div style={{ color: '#d8d0b0', fontSize: '13px', lineHeight: 1.45, margin: '6px 0 10px' }}>{suggestion.reason}</div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {suggestion.proposedDays != null && (
          <button
            type="button"
            disabled={busy}
            onClick={() => write({ waterIntervalDays: suggestion.proposedDays })}
            style={{ ...btn, background: '#4caf50', border: '1px solid #4caf50', color: '#0f1f0f' }}
          >
            Apply · every {suggestion.proposedDays} days
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => write({})}
          style={{ ...btn, background: 'transparent', border: '1px solid #4a4020', color: '#e0c070' }}
        >
          Dismiss
        </button>
      </div>
      {error && <div role="alert" style={{ color: '#e07b39', fontSize: '12px', marginTop: '8px' }}>Couldn't save. Try again.</div>}
    </div>
  );
}
