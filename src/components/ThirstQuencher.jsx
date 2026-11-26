import { useState, useRef, useEffect } from 'react';
import { logCare, undoCare } from '../lib/logging';
import { playWaterDrop, playCompletionChime, vibrate } from '../lib/sounds';
import { wateringStatus, thirstScore, startOfLocalDay } from '../lib/dates';
import { useBackGuard } from '../hooks/useBackGuard';
import { format, addDays } from 'date-fns';

const ELSEWHERE = '📦 Elsewhere';
// Anything further out than this collapses into one "Later" group so the list
// doesn't turn into a wall of single-plant date headers.
const HORIZON_DAYS = 7;
const UNDO_MS = 6000;
const GROUP_KEY = 'tt:quencher-group';

function without(obj, key) {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

function readGroup() {
  try {
    const v = localStorage.getItem(GROUP_KEY);
    return v === 'room' ? 'room' : 'day';
  } catch { return 'day'; }
}

export default function ThirstQuencher({ plants: livePlants, user, household, onClose }) {
  const [checked, setChecked] = useState(new Set());
  const [quenching, setQuenching] = useState(false);
  const [done, setDone] = useState(false);
  const [groupBy, setGroupBy] = useState(readGroup);
  // Plants watered with a section's "Water all" (they show as done, and aren't logged again)
  const [watered, setWatered] = useState(new Set());
  // sectionKey -> {token, ids} while its Undo is on offer
  const [undoable, setUndoable] = useState({});
  // Once something is logged the live data would reshuffle sections under the
  // user's thumb, so grouping holds the list as it was.
  const [frozen, setFrozen] = useState(null);
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useBackGuard(!done, onClose);

  const plants = frozen ?? livePlants;

  function chooseGroup(key) {
    setGroupBy(key);
    try { localStorage.setItem(GROUP_KEY, key); } catch { /* storage unavailable */ }
  }

  const statusFor = plant => wateringStatus(plant, plant.lastWateredAt, plant.lastCheckedAt);
  const scoreFor = plant => thirstScore(plant, plant.lastWateredAt, plant.lastCheckedAt);

  const byThirst = [...plants].sort((a, b) => scoreFor(b) - scoreFor(a));

  // --- by room -------------------------------------------------------------
  function roomGroups() {
    const map = new Map();
    byThirst.forEach(plant => {
      const key = plant.location || ELSEWHERE;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(plant);
    });
    return [...map.keys()]
      .sort((a, b) => (a === ELSEWHERE ? 1 : b === ELSEWHERE ? -1 : a.localeCompare(b)))
      .map(key => ({
        key,
        title: key === ELSEWHERE ? ELSEWHERE : `📍 ${key}`,
        subtitle: null,
        plants: map.get(key),
        urgent: false,
      }));
  }

  // --- by day --------------------------------------------------------------
  // Buckets: everything already due lands in Overdue, then one group per
  // calendar day out to the horizon, then Later, then plants with no schedule.
  function dayGroups() {
    const buckets = new Map();
    const push = (key, plant) => {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(plant);
    };

    byThirst.forEach(plant => {
      const { state, daysUntil } = statusFor(plant);
      if (state === 'unset') push('none', plant);
      else if (state === 'never' || state === 'late') push('overdue', plant);
      else if (daysUntil > HORIZON_DAYS) push('later', plant);
      else push(`d${daysUntil}`, plant);
    });

    const today = startOfLocalDay(new Date());
    const dayTitle = n =>
      n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : format(addDays(today, n), 'EEEE');

    const order = [
      { key: 'overdue', title: '⚠️ Overdue', subtitle: 'Should already have been watered', urgent: true },
      ...Array.from({ length: HORIZON_DAYS + 1 }, (_, n) => ({
        key: `d${n}`,
        title: dayTitle(n),
        subtitle: format(addDays(today, n), 'MMM d'),
        urgent: n === 0,
      })),
      { key: 'later', title: 'Later', subtitle: `More than ${HORIZON_DAYS} days out`, urgent: false },
      { key: 'none', title: 'No schedule', subtitle: 'No watering interval set', urgent: false },
    ];

    return order
      .filter(g => buckets.has(g.key))
      .map(g => ({
        ...g,
        // Within a day, walk room by room so you're not criss-crossing the house
        plants: [...buckets.get(g.key)].sort(
          (a, b) =>
            (a.location || '￿').localeCompare(b.location || '￿') ||
            a.name.localeCompare(b.name)
        ),
      }));
  }

  const sections = groupBy === 'day' ? dayGroups() : roomGroups();

  function toggle(plantId) {
    if (watered.has(plantId)) return;
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(plantId)) {
        next.delete(plantId);
      } else {
        next.add(plantId);
        playWaterDrop();
        vibrate(40);
      }
      return next;
    });
  }

  async function quench() {
    if (!checked.size || quenching) return;
    setQuenching(true);
    try {
      await logCare({
        plants: plants.filter(p => checked.has(p.id)),
        kind: 'water',
        household,
        user,
      });
      playCompletionChime();
      vibrate([50, 50, 100]);
      setDone(true);
      setTimeout(onClose, 1800);
    } catch (err) {
      console.error(err);
      setQuenching(false);
    }
  }

  async function waterAll(section) {
    const targets = section.plants.filter(p => !checked.has(p.id) && !watered.has(p.id));
    if (!targets.length || section.key in undoable) return;
    try {
      const token = await logCare({ plants: targets, kind: 'water', household, user });
      const ids = targets.map(p => p.id);
      setFrozen(f => f ?? livePlants);
      setWatered(prev => new Set([...prev, ...ids]));
      setUndoable(prev => ({ ...prev, [section.key]: { token, ids } }));
      playWaterDrop();
      vibrate([40, 40, 40]);
      timers.current.push(setTimeout(() => {
        setUndoable(prev => without(prev, section.key));
      }, UNDO_MS));
    } catch (err) {
      console.error(err);
    }
  }

  async function undoWaterAll(sectionKey) {
    const entry = undoable[sectionKey];
    if (!entry) return;
    setUndoable(prev => without(prev, sectionKey));
    try {
      await undoCare(entry.token);
      setWatered(prev => {
        const next = new Set(prev);
        entry.ids.forEach(id => next.delete(id));
        return next;
      });
    } catch (err) {
      console.error(err);
    }
  }

  if (done) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#0f1f0f', zIndex: 50,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <div style={{ fontSize: '64px', marginBottom: '16px' }}>💧</div>
        <p style={{ color: '#4caf50', fontSize: '22px', fontWeight: '700', margin: 0 }}>
          {checked.size} plant{checked.size !== 1 ? 's' : ''} quenched!
        </p>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#0f1f0f', zIndex: 50,
      display: 'flex', flexDirection: 'column',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        padding: '20px 16px 12px', background: '#0f1f0f',
        borderBottom: '1px solid #1a2e1a', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ color: '#fff', margin: '0 0 2px', fontSize: '20px', fontWeight: '700' }}>
              🚿 Thirst Quencher
            </h2>
            <p style={{ color: '#6a8f6a', margin: 0, fontSize: '13px' }}>
              Tap each plant as you water it
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '10px',
              color: '#fff', padding: '8px 12px', cursor: 'pointer', fontSize: '18px', lineHeight: 1,
            }}
          >
            ←
          </button>
        </div>

        <div style={{ display: 'flex', gap: '6px', marginTop: '12px', alignItems: 'center' }}>
          <span style={{ color: '#6a8f6a', fontSize: '12px' }}>Group by:</span>
          {[
            { key: 'day', label: '📅 Day' },
            { key: 'room', label: '📍 Room' },
          ].map(opt => (
            <button
              key={opt.key}
              onClick={() => chooseGroup(opt.key)}
              style={{
                padding: '5px 12px', borderRadius: '20px', fontSize: '12px',
                fontWeight: groupBy === opt.key ? '700' : '400',
                background: groupBy === opt.key ? '#4caf50' : '#1e331e',
                color: groupBy === opt.key ? '#fff' : '#a8c5a0',
                border: groupBy === opt.key ? 'none' : '1px solid #2d4a2d',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Plant list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 100px' }}>
        {sections.map(section => (
          <div key={section.key} style={{ marginBottom: '20px' }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
              marginBottom: '8px', paddingBottom: '6px',
              borderBottom: `1px solid ${section.urgent ? '#2d4a2d' : '#1a2e1a'}`,
            }}>
              <span style={{
                color: section.urgent ? '#e0a060' : '#6a8f6a', fontSize: '12px', fontWeight: '700',
                textTransform: 'uppercase', letterSpacing: '1px',
              }}>
                {section.title}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ color: '#3a5a3a', fontSize: '11px', whiteSpace: 'nowrap' }}>
                  {section.subtitle ? `${section.subtitle} · ` : ''}
                  {section.plants.length} plant{section.plants.length !== 1 ? 's' : ''}
                </span>
                <SectionAction
                  pending={section.plants.filter(p => !checked.has(p.id) && !watered.has(p.id))}
                  undo={undoable[section.key]}
                  onWaterAll={() => waterAll(section)}
                  onUndo={() => undoWaterAll(section.key)}
                />
              </span>
            </div>
            {section.plants.map(plant => {
              const isChecked = checked.has(plant.id) || watered.has(plant.id);
              const status = statusFor(plant);
              const overdue = status.state === 'late' || status.state === 'never';
              const dueLabel = status.shortLabel;
              const dueColor = status.color;

              return (
                <div
                  key={plant.id}
                  onClick={() => toggle(plant.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    background: isChecked ? '#0a2a0a' : '#1a2e1a',
                    borderRadius: '12px', padding: '10px 12px',
                    marginBottom: '8px', cursor: 'pointer',
                    border: `1px solid ${isChecked ? '#4caf50' : overdue ? '#e07b39' : '#2d4a2d'}`,
                    opacity: isChecked ? 0.6 : 1,
                    transition: 'all 0.15s',
                  }}
                >
                  {/* Photo */}
                  <div style={{
                    width: '52px', height: '52px', borderRadius: '10px',
                    overflow: 'hidden', flexShrink: 0, background: '#2d4a2d',
                  }}>
                    {plant.photoUrl ? (
                      <img src={plant.photoUrl} alt={plant.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>🌿</div>
                    )}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      color: isChecked ? '#6a8f6a' : '#fff',
                      fontWeight: '600', fontSize: '15px',
                      textDecoration: isChecked ? 'line-through' : 'none',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {plant.name}
                    </div>
                    <div style={{
                      color: isChecked ? '#3a5a3a' : groupBy === 'day' ? '#6a8f6a' : dueColor,
                      fontSize: '12px', marginTop: '2px', fontWeight: '600',
                    }}>
                      {groupBy === 'day'
                        ? (plant.location ? `📍 ${plant.location}` : ELSEWHERE)
                        : `${status.icon} ${dueLabel}`}
                    </div>
                  </div>

                  {/* Checkbox */}
                  <div style={{
                    width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
                    border: `2px solid ${isChecked ? '#4caf50' : '#2d4a2d'}`,
                    background: isChecked ? '#4caf50' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: '14px', fontWeight: '700',
                  }}>
                    {isChecked ? '✓' : ''}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Bottom action bar */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: '#0f1f0f', borderTop: '1px solid #2d4a2d',
        padding: '16px', zIndex: 60,
      }}>
        <button
          onClick={quench}
          disabled={!checked.size || quenching}
          style={{
            width: '100%', background: checked.size ? '#4caf50' : '#1e331e',
            color: checked.size ? '#fff' : '#3a5a3a', border: 'none',
            borderRadius: '14px', padding: '16px', fontSize: '17px',
            fontWeight: '700', cursor: checked.size ? 'pointer' : 'default',
            transition: 'all 0.2s',
          }}
        >
          {quenching ? 'Quenching...' : checked.size
            ? `🚿 Quench ${checked.size} plant${checked.size !== 1 ? 's' : ''}`
            : 'Tap plants to check them off'}
        </button>
      </div>
    </div>
  );
}

function SectionAction({ pending, undo, onWaterAll, onUndo }) {
  const base = {
    minHeight: '44px', padding: '0 12px', borderRadius: '10px', fontSize: '12px', fontWeight: '700',
    cursor: 'pointer', whiteSpace: 'nowrap', textTransform: 'none', letterSpacing: 0,
  };
  if (undo) {
    return (
      <button type="button" onClick={onUndo} style={{ ...base, background: 'transparent', color: '#a8e080', border: '1px solid #4caf50' }}>
        Watered {undo.ids.length} · Undo
      </button>
    );
  }
  if (!pending.length) return null;
  return (
    <button
      type="button"
      aria-label={`Water all ${pending.length} unchecked plants in this section`}
      onClick={onWaterAll}
      style={{ ...base, background: '#1e331e', color: '#5ba3be', border: '1px solid #5ba3be' }}
    >
      💧 Water all
    </button>
  );
}
