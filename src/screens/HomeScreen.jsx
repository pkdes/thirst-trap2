import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { db, auth } from '../lib/firebase';
import AddPlantModal from '../components/AddPlantModal';
import HouseholdModal from '../components/HouseholdModal';
import ThirstQuencher from '../components/ThirstQuencher';
import NotificationSettings from '../components/NotificationSettings';
import PlantList from '../components/PlantList';
import PlantTile from '../components/PlantTile';
import UndoToast from '../components/UndoToast';
import { thirstScore, todayISO, CARE_COLORS } from '../lib/dates';
import { logCare, undoCare, CARE_KINDS } from '../lib/logging';
import { vibrate } from '../lib/sounds';
import { format } from 'date-fns';
import { useBackGuard } from '../hooks/useBackGuard';

const OLIVE = CARE_COLORS.check;
const NAV_HEIGHT = 64;

const storage = {
  get(store, key) { try { return window[store].getItem(key); } catch { return null; } },
  set(store, key, value) { try { window[store].setItem(key, value); } catch { /* storage unavailable */ } },
};

function readRooms(householdId) {
  try {
    const arr = JSON.parse(storage.get('sessionStorage', `tt:rooms:${householdId}`) || '[]');
    return new Set(Array.isArray(arr) ? arr.filter(r => typeof r === 'string') : []);
  } catch { return new Set(); }
}

const SORT_OPTIONS = [
  { key: 'thirstiest', label: '💧 Thirstiest' },
  { key: 'alpha', label: 'A → Z' },
  { key: 'recent', label: '🆕 Recent' },
];

export default function HomeScreen({ user, household, onSelectPlant }) {
  const [plants, setPlants] = useState([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [sort, setSort] = useState('thirstiest');
  const [roomFilter, setRoomFilter] = useState(() => readRooms(household.id));
  const [view, setView] = useState(() => (storage.get('localStorage', `tt:view:${household.id}`) === 'grid' ? 'grid' : 'list'));
  const [toast, setToast] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showHousehold, setShowHousehold] = useState(false);
  const [showQuencher, setShowQuencher] = useState(false);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [batching, setBatching] = useState(false);
  const [showNotifSettings, setShowNotifSettings] = useState(false);
  const [showBatchDatePicker, setShowBatchDatePicker] = useState(false);
  const [pendingBatchType, setPendingBatchType] = useState(null);
  const [batchDate, setBatchDate] = useState('');

  // Back gesture unwinds these layers instead of closing the app
  useBackGuard(showBatchDatePicker, () => setShowBatchDatePicker(false));
  useBackGuard(multiSelect && !showBatchDatePicker, () => { setMultiSelect(false); setSelected(new Set()); });
  useBackGuard(showArchived && !multiSelect, () => setShowArchived(false));

  useEffect(() => {
    if (!household) return;
    const q = query(collection(db, 'plants'), where('householdId', '==', household.id));
    return onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      docs.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      setPlants(docs);
    });
  }, [household]);

  const activePlants = plants.filter(p => !p.archived);
  const archivedPlants = plants.filter(p => p.archived);
  const locations = [...new Set(activePlants.map(p => p.location).filter(Boolean))].sort();
  // Only rooms that still exist count; an empty selection means every room
  const activeRooms = locations.length > 1 ? locations.filter(l => roomFilter.has(l)) : [];

  function chooseView(next) {
    setView(next);
    storage.set('localStorage', `tt:view:${household.id}`, next);
  }

  function updateRooms(next) {
    setRoomFilter(next);
    storage.set('sessionStorage', `tt:rooms:${household.id}`, JSON.stringify([...next]));
  }

  function toggleRoom(loc) {
    const next = new Set(roomFilter);
    next.has(loc) ? next.delete(loc) : next.add(loc);
    updateRooms(next);
  }

  const dismissToast = useCallback(() => setToast(null), []);

  async function careLog(plant, kind, date = null) {
    const id = Date.now();
    try {
      const token = await logCare({ plants: [plant], kind, date, household, user });
      if (kind === 'water') vibrate(30);
      const when = date ? ` · ${format(date, 'MMM d')}` : '';
      setToast({ id, message: `${CARE_KINDS[kind].label} ${plant.name}${when}`, token });
    } catch (err) {
      console.error('Care log failed', err);
      setToast({ id, message: `Couldn't log ${plant.name}` });
    }
  }

  async function undoToast(t) {
    setToast(null);
    try { await undoCare(t.token); } catch (err) { console.error('Undo failed', err); }
  }

  function sortedPlants() {
    const pool = showArchived ? archivedPlants : activePlants;
    const term = search.toLowerCase();
    let filtered = pool.filter(p =>
      p.name.toLowerCase().includes(term) || p.location?.toLowerCase().includes(term)
    );
    if (activeRooms.length && !showArchived) filtered = filtered.filter(p => activeRooms.includes(p.location));
    if (showArchived) {
      return [...filtered].sort((a, b) => (b.archivedAt?.seconds ?? 0) - (a.archivedAt?.seconds ?? 0));
    }
    if (sort === 'alpha') return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'recent') return filtered;
    return [...filtered].sort(
      (a, b) =>
        thirstScore(b, b.lastWateredAt, b.lastCheckedAt) -
        thirstScore(a, a.lastWateredAt, a.lastCheckedAt)
    );
  }

  function enterMultiSelect(plantId) {
    if (showArchived) return;
    setMultiSelect(true);
    setSelected(new Set([plantId]));
  }

  function toggleSelect(plantId) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(plantId) ? next.delete(plantId) : next.add(plantId);
      return next;
    });
  }

  function exitMultiSelect() {
    setMultiSelect(false);
    setSelected(new Set());
  }

  function initiateBatch(type) {
    if (!selected.size) return;
    setPendingBatchType(type);
    setBatchDate(todayISO());
    setShowBatchDatePicker(true);
  }

  async function confirmBatchLog() {
    if (!pendingBatchType || !batchDate || batching) return;
    setBatching(true);
    const [year, month, day] = batchDate.split('-').map(Number);
    try {
      await logCare({
        plants: plants.filter(p => selected.has(p.id)),
        kind: pendingBatchType === 'fertilize' ? 'feed' : pendingBatchType,
        date: new Date(year, month - 1, day),
        household,
        user,
      });
      setShowBatchDatePicker(false);
      exitMultiSelect();
    } catch (err) {
      console.error('Batch log failed', err);
    }
    setBatching(false);
  }

  const displayPlants = sortedPlants();

  return (
    <div style={{
      minHeight: '100dvh', background: '#0f1f0f',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      paddingBottom: multiSelect ? `${NAV_HEIGHT + 92}px` : `${NAV_HEIGHT + 24}px`,
    }}>
      <div style={{ padding: '20px 16px 12px', position: 'sticky', top: 0, background: '#0f1f0f', zIndex: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '8px' }}>
          <h1 style={{ color: '#fff', fontSize: '24px', fontWeight: '700', margin: 0 }}>
            🌿 {household.name ? `${household.name}'s Plants` : 'My Plants'}
          </h1>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={() => setShowHousehold(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                background: '#1e331e', border: '1px solid #2d4a2d',
                borderRadius: '10px', padding: '6px 10px', cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: '14px' }}>🏠</span>
              <span style={{ fontSize: '13px', fontWeight: '700', color: '#fff', maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {household.name || household.id}
              </span>
            </button>
            <button
              onClick={() => setShowNotifSettings(true)}
              style={iconBtn}
            >
              🔔
            </button>
            <button
              onClick={() => signOut(auth)}
              style={iconBtn}
            >
              ⏻
            </button>
          </div>
        </div>

        {!multiSelect && (
          <>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'center' }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or location..."
                aria-label="Search plants"
                style={{
                  flex: 1, minWidth: 0, background: '#1e331e', border: '1px solid #2d4a2d',
                  borderRadius: '10px', padding: '0 14px', height: '44px', color: '#fff', fontSize: '15px',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
              <ViewButton label="List view" active={view === 'list'} onClick={() => chooseView('list')}>☰</ViewButton>
              <ViewButton label="Grid view" active={view === 'grid'} onClick={() => chooseView('grid')}>▦</ViewButton>
            </div>
            <div className="no-scrollbar" style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px', alignItems: 'center' }}>
              {!showArchived && (
                <>
                  <span style={{ color: '#6a8f6a', fontSize: '12px', flexShrink: 0 }}>Sort:</span>
                  {SORT_OPTIONS.map(opt => (
                    <Chip key={opt.key} active={sort === opt.key} onClick={() => setSort(opt.key)}>
                      {opt.label}
                    </Chip>
                  ))}
                </>
              )}
              {archivedPlants.length > 0 && (
                <Chip
                  active={showArchived}
                  activeBg="#3a3018"
                  activeColor="#e0c070"
                  activeBorder="#8a7030"
                  onClick={() => { setShowArchived(v => !v); exitMultiSelect(); }}
                >
                  📦 Archived ({archivedPlants.length})
                </Chip>
              )}
            </div>

            {locations.length > 1 && !showArchived && (
              <div className="no-scrollbar" style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px', marginTop: '6px' }}>
                <span style={{ color: '#6a8f6a', fontSize: '12px', flexShrink: 0, alignSelf: 'center' }}>📍</span>
                <Chip active={!activeRooms.length} activeBg="#2d4a1e" activeColor="#a8e080" activeBorder="#4caf50" onClick={() => updateRooms(new Set())}>
                  All
                </Chip>
                {locations.map(loc => (
                  <Chip
                    key={loc}
                    active={roomFilter.has(loc)}
                    activeBg="#2d4a1e"
                    activeColor="#a8e080"
                    activeBorder="#4caf50"
                    onClick={() => toggleRoom(loc)}
                  >
                    {loc}
                  </Chip>
                ))}
              </div>
            )}
          </>
        )}

        {multiSelect && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: '#a8c5a0', fontSize: '14px' }}>
              {selected.size} plant{selected.size !== 1 ? 's' : ''} selected
            </span>
            <button onClick={exitMultiSelect} style={{ background: 'none', border: 'none', color: '#a8c5a0', cursor: 'pointer', fontSize: '14px' }}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {displayPlants.length === 0 && !search && (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: '#a8c5a0' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>{showArchived ? '📦' : '🪴'}</div>
          <p style={{ fontSize: '16px', margin: 0 }}>
            {showArchived ? 'Nothing archived.' : 'No plants yet. Add your first one!'}
          </p>
        </div>
      )}

      {view === 'list' ? (
        <PlantList
          plants={displayPlants}
          householdId={household.id}
          multiSelect={multiSelect}
          selected={selected}
          onOpen={onSelectPlant}
          onToggle={toggleSelect}
          onEnterSelect={enterMultiSelect}
          onLog={careLog}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', padding: '12px 16px 0' }}>
          {displayPlants.map(plant => (
            <PlantTile
              key={plant.id}
              plant={plant}
              multiSelect={multiSelect}
              isSelected={selected.has(plant.id)}
              onLongPress={() => enterMultiSelect(plant.id)}
              onClick={() => (multiSelect ? toggleSelect(plant.id) : onSelectPlant(plant))}
            />
          ))}
        </div>
      )}

      {!multiSelect && !showArchived && (
        <>
          <button
            onClick={() => setShowQuencher(true)}
            style={{
              position: 'fixed', bottom: `${NAV_HEIGHT + 16}px`, left: '20px',
              width: '56px', height: '56px', borderRadius: '50%',
              background: '#1e3a1e', border: '1px solid #4caf50', color: '#fff',
              cursor: 'pointer', boxShadow: '0 4px 16px rgba(76,175,80,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20,
              fontSize: '24px',
            }}
          >
            🚿
          </button>
          <button
            onClick={() => setShowAdd(true)}
            style={{
              position: 'fixed', bottom: `${NAV_HEIGHT + 16}px`, right: '20px',
              width: '56px', height: '56px', borderRadius: '50%',
              background: '#4caf50', color: '#fff', border: 'none',
              cursor: 'pointer', boxShadow: '0 4px 16px rgba(76,175,80,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20,
            }}
          >
            <span style={{ fontSize: '24px' }}>🌱</span>
          </button>
        </>
      )}

      {multiSelect && (
        <div style={{
          position: 'fixed', bottom: `${NAV_HEIGHT}px`, left: 0, right: 0,
          background: '#1a2e1a', borderTop: '1px solid #2d4a2d',
          padding: '16px', display: 'flex', gap: '8px', zIndex: 30,
        }}>
          <button
            onClick={() => initiateBatch('water')}
            disabled={!selected.size || batching}
            style={{
              flex: 1, background: CARE_COLORS.water, color: '#fff', border: 'none',
              borderRadius: '12px', padding: '14px 6px', fontSize: '14px', fontWeight: '700',
              cursor: 'pointer', opacity: !selected.size ? 0.5 : 1,
            }}
          >
            💧 Water
          </button>
          <button
            onClick={() => initiateBatch('check')}
            disabled={!selected.size || batching}
            style={{
              flex: 1, background: 'transparent', color: OLIVE,
              border: `2px solid ${OLIVE}`, borderRadius: '12px', padding: '14px 6px',
              fontSize: '14px', fontWeight: '700', cursor: 'pointer', opacity: !selected.size ? 0.5 : 1,
            }}
          >
            ✓ Check
          </button>
          <button
            onClick={() => initiateBatch('fertilize')}
            disabled={!selected.size || batching}
            style={{
              flex: 1, background: CARE_COLORS.fertilizer, color: '#fff', border: 'none',
              borderRadius: '12px', padding: '14px 6px', fontSize: '14px', fontWeight: '700',
              cursor: 'pointer', opacity: !selected.size ? 0.5 : 1,
            }}
          >
            🌿 Fert.
          </button>
        </div>
      )}

      {showBatchDatePicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#1a2e1a', borderRadius: '16px', padding: '24px', width: '300px', margin: '20px', border: '1px solid #2d4a2d' }}>
            <h3 style={{ color: '#fff', margin: '0 0 6px', fontSize: '18px' }}>
              {pendingBatchType === 'water' ? '💧' : pendingBatchType === 'check' ? '✓' : '🌿'} When?
            </h3>
            <p style={{ color: '#a8c5a0', fontSize: '13px', margin: '0 0 16px' }}>
              {selected.size} plant{selected.size !== 1 ? 's' : ''} selected
            </p>
            <input
              type="date"
              value={batchDate}
              max={todayISO()}
              onChange={e => setBatchDate(e.target.value)}
              style={{
                width: '100%', background: '#0f1f0f', border: '1px solid #2d4a2d',
                borderRadius: '10px', padding: '12px', color: '#fff', fontSize: '16px',
                boxSizing: 'border-box', marginBottom: '16px', outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={confirmBatchLog}
                disabled={!batchDate || batching}
                style={{
                  flex: 1,
                  background: pendingBatchType === 'water' ? CARE_COLORS.water : pendingBatchType === 'check' ? OLIVE : CARE_COLORS.fertilizer,
                  color: '#fff', border: 'none', borderRadius: '10px', padding: '12px',
                  fontWeight: '700', cursor: 'pointer', fontSize: '15px',
                }}
              >
                {batching ? 'Saving...' : 'Confirm'}
              </button>
              <button
                onClick={() => setShowBatchDatePicker(false)}
                style={{ flex: 1, background: 'transparent', color: '#a8c5a0', border: '1px solid #2d4a2d', borderRadius: '10px', padding: '12px', cursor: 'pointer', fontSize: '15px' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {!multiSelect && <UndoToast toast={toast} onUndo={undoToast} onDismiss={dismissToast} />}
      {showNotifSettings && <NotificationSettings user={user} onClose={() => setShowNotifSettings(false)} />}
      {showAdd && <AddPlantModal user={user} household={household} onClose={() => setShowAdd(false)} />}
      {showHousehold && <HouseholdModal household={household} onClose={() => setShowHousehold(false)} />}
      {showQuencher && (
        <ThirstQuencher
          plants={activePlants}
          user={user}
          household={household}
          onClose={() => setShowQuencher(false)}
        />
      )}
    </div>
  );
}

function Chip({ active, onClick, children, activeBg = '#4caf50', activeColor = '#fff', activeBorder }) {
  return (
    <button
      onClick={onClick}
      style={{
        flexShrink: 0, padding: '5px 10px', borderRadius: '20px', fontSize: '12px',
        fontWeight: active ? '700' : '400',
        background: active ? activeBg : '#1e331e',
        color: active ? activeColor : '#a8c5a0',
        border: active && !activeBorder ? 'none' : `1px solid ${active ? activeBorder : '#2d4a2d'}`,
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

function ViewButton({ label, active, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      style={{
        width: '44px', height: '44px', flexShrink: 0, borderRadius: '10px', cursor: 'pointer',
        fontSize: '18px', lineHeight: 1, padding: 0,
        background: active ? '#2d4a1e' : '#1e331e',
        color: active ? '#a8e080' : '#a8c5a0',
        border: `1px solid ${active ? '#4caf50' : '#2d4a2d'}`,
      }}
    >
      {children}
    </button>
  );
}

const iconBtn = {
  background: '#1e331e', border: '1px solid #2d4a2d', borderRadius: '10px',
  padding: '6px 10px', cursor: 'pointer', fontSize: '16px', color: '#a8c5a0', lineHeight: 1,
};
