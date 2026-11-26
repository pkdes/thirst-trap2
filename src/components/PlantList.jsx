import { useState } from 'react';
import { wateringStatus, CARE_COLORS, todayISO } from '../lib/dates';
import { archiveReasonLabel } from '../lib/archive';
import { useLongPress } from '../hooks/useLongPress';
import { useBackGuard } from '../hooks/useBackGuard';
import { useDoctor } from '../hooks/useDoctor';
import DoctorCard from './DoctorCard';

const BTN = 44;

/**
 * One row per plant: thumbnail, name, room, due chip and a one-tap 💧 button.
 * `onLog(plant, kind, date)` does the logging; kind is 'water' | 'check' | 'feed'.
 */
export default function PlantList({ plants, householdId, multiSelect, selected, onOpen, onToggle, onEnterSelect, onLog }) {
  const [menuPlant, setMenuPlant] = useState(null);
  const { suggestions, hide } = useDoctor(householdId, plants);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 16px 0' }}>
      {plants.map(plant => (
        <PlantRow
          key={plant.id}
          plant={plant}
          suggestion={suggestions[plant.id]}
          onDoctorResolved={() => hide(plant.id)}
          multiSelect={multiSelect}
          isSelected={selected.has(plant.id)}
          onClick={() => (multiSelect ? onToggle(plant.id) : onOpen(plant))}
          onLongPress={() => onEnterSelect(plant.id)}
          onWater={() => onLog(plant, 'water', null)}
          onMenu={() => setMenuPlant(plant)}
        />
      ))}
      {menuPlant && (
        <CareMenu
          plant={menuPlant}
          onClose={() => setMenuPlant(null)}
          onPick={(kind, date) => { onLog(menuPlant, kind, date); setMenuPlant(null); }}
        />
      )}
    </div>
  );
}

function PlantRow({ plant, suggestion, onDoctorResolved, multiSelect, isSelected, onClick, onLongPress, onWater, onMenu }) {
  const { handlers, consumeClick } = useLongPress(onLongPress);
  const status = wateringStatus(plant, plant.lastWateredAt, plant.lastCheckedAt);
  const needsAttention = !plant.archived && (status.state === 'late' || status.state === 'never');
  const border = plant.archived ? '#4a4020' : isSelected ? '#4caf50' : needsAttention ? CARE_COLORS.late : '#2d4a2d';

  const [doctorOpen, setDoctorOpen] = useState(false);

  const activate = () => { if (!consumeClick()) onClick(); };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={plant.name}
      aria-pressed={multiSelect ? isSelected : undefined}
      onClick={activate}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      {...handlers}
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', minHeight: '64px', boxSizing: 'border-box',
        background: '#1a2e1a', borderRadius: '14px', padding: '10px 10px 10px 12px', cursor: 'pointer',
        border: `1px solid ${border}`,
        boxShadow: isSelected ? '0 0 0 2px #4caf50' : 'none',
        userSelect: 'none', WebkitTouchCallout: 'none',
      }}
    >
      <div style={{ width: '44px', height: '44px', borderRadius: '10px', overflow: 'hidden', flexShrink: 0, background: '#2d4a2d' }}>
        {plant.photoUrl ? (
          <img
            src={plant.photoUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', filter: plant.archived ? 'grayscale(0.7)' : 'none', opacity: plant.archived ? 0.7 : 1 }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>🌿</div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: plant.archived ? '#a8c5a0' : '#fff', fontWeight: '600', fontSize: '15px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {plant.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px', minWidth: 0 }}>
          {plant.location && (
            <span style={{ color: '#a8c5a0', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1 }}>
              📍 {plant.location}
            </span>
          )}
          {plant.archived ? (
            <span style={{ ...chip, background: '#3a301844', color: '#e0c070', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {archiveReasonLabel(plant)}
            </span>
          ) : (
            <span style={{ ...chip, background: status.color + '22', color: status.color }}>
              {status.icon} {status.label}
            </span>
          )}
        </div>
        {suggestion && !multiSelect && (
          <button
            type="button"
            aria-expanded={doctorOpen}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); setDoctorOpen(o => !o); }}
            onKeyDown={e => e.stopPropagation()}
            style={{
              display: 'inline-flex', alignItems: 'center', minHeight: '44px', marginTop: '2px', padding: 0,
              background: 'none', border: 'none', cursor: 'pointer', touchAction: 'manipulation', maxWidth: '100%',
            }}
          >
            <span style={{
              ...chip, background: '#3a3018', color: '#e0a060', border: '1px solid #8a7030',
              overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              🩺 {suggestion.chip}
            </span>
          </button>
        )}
      </div>

      {multiSelect ? (
        <div aria-hidden="true" style={{
          width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0, marginRight: '9px',
          border: `2px solid ${isSelected ? '#4caf50' : '#2d4a2d'}`,
          background: isSelected ? '#4caf50' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '14px', fontWeight: '700',
        }}>
          {isSelected ? '✓' : ''}
        </div>
      ) : !plant.archived && (
        <WaterButton plant={plant} onWater={onWater} onMenu={onMenu} />
      )}

      {suggestion && doctorOpen && !multiSelect && (
        <DoctorCard plant={plant} suggestion={suggestion} onResolved={onDoctorResolved} />
      )}
    </div>
  );
}

function WaterButton({ plant, onWater, onMenu }) {
  const { handlers, consumeClick } = useLongPress(onMenu, { ms: 450, contextMenu: true });
  return (
    <button
      type="button"
      aria-label={`Water ${plant.name}`}
      aria-haspopup="menu"
      title="Tap to water, hold for more"
      {...handlers}
      // Keep the row from starting its own long-press or opening the plant
      onPointerDown={e => { e.stopPropagation(); handlers.onPointerDown(e); }}
      onClick={e => {
        e.stopPropagation();
        if (!consumeClick()) onWater();
      }}
      onKeyDown={e => e.stopPropagation()}
      style={{
        width: `${BTN}px`, height: `${BTN}px`, flexShrink: 0, borderRadius: '50%', padding: 0,
        background: `${CARE_COLORS.water}22`, border: `1.5px solid ${CARE_COLORS.water}`,
        fontSize: '20px', lineHeight: 1, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        userSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'manipulation',
      }}
    >
      💧
    </button>
  );
}

function CareMenu({ plant, onClose, onPick }) {
  const [pastDate, setPastDate] = useState(null); // null = menu, string = date picker
  const [openedAt] = useState(() => Date.now());
  useBackGuard(true, onClose);

  // The press that opened the menu is often still being released over the backdrop
  const dismiss = () => { if (Date.now() - openedAt > 400) onClose(); };

  const items = [
    { kind: 'check', label: '✓  Check', color: CARE_COLORS.check },
    { kind: 'feed', label: '🌿  Feed', color: CARE_COLORS.fertilizer },
  ];

  return (
    <div
      onClick={dismiss}
      style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.55)' }}
    >
      <div
        role="menu"
        aria-label={`Log care for ${plant.name}`}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed', left: '16px', right: '16px', bottom: '76px', maxWidth: '448px', margin: '0 auto',
          background: '#1a2e1a', border: '1px solid #2d4a2d', borderRadius: '16px', padding: '14px',
          boxSizing: 'border-box', fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ color: '#a8c5a0', fontSize: '13px', margin: '0 4px 10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {plant.name}
        </div>

        {pastDate === null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {items.map(it => (
              <button key={it.kind} type="button" role="menuitem" onClick={() => onPick(it.kind, null)} style={{ ...menuBtn, color: it.color }}>
                {it.label}
              </button>
            ))}
            <button type="button" role="menuitem" onClick={() => setPastDate(todayISO())} style={{ ...menuBtn, color: CARE_COLORS.water }}>
              💧  Water on a past date…
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              type="date"
              aria-label="Date watered"
              value={pastDate}
              max={todayISO()}
              onChange={e => setPastDate(e.target.value)}
              style={{
                minHeight: '44px', background: '#0f1f0f', border: '1px solid #2d4a2d', borderRadius: '10px',
                padding: '0 12px', color: '#fff', fontSize: '16px', boxSizing: 'border-box', outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                disabled={!pastDate || pastDate > todayISO()}
                onClick={() => {
                  const [y, m, d] = pastDate.split('-').map(Number);
                  onPick('water', new Date(y, m - 1, d));
                }}
                style={{ ...menuBtn, flex: 1, background: CARE_COLORS.water, color: '#fff', border: 'none', justifyContent: 'center', opacity: pastDate ? 1 : 0.5 }}
              >
                Log watering
              </button>
              <button type="button" onClick={() => setPastDate(null)} style={{ ...menuBtn, flex: 1, justifyContent: 'center', color: '#a8c5a0' }}>
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const chip = {
  borderRadius: '6px', padding: '2px 6px', fontSize: '11px', fontWeight: '600',
  whiteSpace: 'nowrap', flexShrink: 0, maxWidth: '100%',
};

const menuBtn = {
  display: 'flex', alignItems: 'center', minHeight: '48px', padding: '0 14px', boxSizing: 'border-box',
  background: '#0f1f0f', border: '1px solid #2d4a2d', borderRadius: '12px',
  fontSize: '15px', fontWeight: '600', cursor: 'pointer', textAlign: 'left',
};
