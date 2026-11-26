import { useEffect } from 'react';

export const TOAST_MS = 6000;

/**
 * Bottom toast with an UNDO button. `toast` is {id, message, token?}; a new id
 * restarts the timer. The wrapper stays mounted so screen readers pick up
 * changes to its role="status" live region.
 */
export default function UndoToast({ toast, onUndo, onDismiss, bottom = 64 + 12 }) {
  const id = toast?.id;
  useEffect(() => {
    if (id === undefined) return undefined;
    const t = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(t);
  }, [id, onDismiss]);

  return (
    <div
      role="status"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: `${bottom}px`, zIndex: 150,
        display: 'flex', justifyContent: 'center', padding: '0 16px',
        pointerEvents: 'none',
      }}
    >
      {toast && (
        <div style={{
          pointerEvents: 'auto', width: '100%', maxWidth: '448px', boxSizing: 'border-box',
          background: '#e8f2e0', color: '#12200f', borderRadius: '14px',
          padding: '4px 4px 4px 16px', display: 'flex', alignItems: 'center', gap: '8px',
          boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: '15px', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {toast.message}
          </span>
          {toast.token && (
            <button
              type="button"
              onClick={() => onUndo(toast)}
              style={{
                minHeight: '44px', minWidth: '44px', padding: '0 14px', background: 'transparent',
                border: 'none', borderRadius: '10px', cursor: 'pointer',
                color: '#1e5a1e', fontSize: '14px', fontWeight: '800', letterSpacing: '0.5px',
              }}
            >
              UNDO
            </button>
          )}
        </div>
      )}
    </div>
  );
}
