import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { format, isSameDay } from 'date-fns';
import { db } from '../lib/firebase';
import { logCare, undoCare, CARE_KINDS } from '../lib/logging';
import {
  projectDueDates, projectFertilizerDates, nextDueDate, toDate,
  calendarDaysBetween, startOfLocalDay, todayISO, CARE_COLORS,
} from '../lib/dates';
import { buildMonthCells, monthBounds, groupLogsByDay, KIND_COLOR } from '../lib/calendarDays';
import { vibrate } from '../lib/sounds';
import EditLogSheet from '../components/EditLogSheet';
import UndoToast from '../components/UndoToast';

const NAV_HEIGHT = 64;
const BTN = 44;

function readRooms(householdId) {
  try {
    const arr = JSON.parse(window.sessionStorage.getItem(`tt:rooms:${householdId}`) || '[]');
    return new Set(Array.isArray(arr) ? arr.filter(r => typeof r === 'string') : []);
  } catch { return new Set(); }
}

function writeRooms(householdId, set) {
  try { window.sessionStorage.setItem(`tt:rooms:${householdId}`, JSON.stringify([...set])); } catch { /* storage unavailable */ }
}

const AT_FIELDS = Object.fromEntries(Object.entries(CARE_KINDS).map(([k, v]) => [k, v.at]));
const EMPTY_LOGS = { water: [], check: [], feed: [] };

export default function CalendarScreen({ user, household, onSelectPlant }) {
  const [plants, setPlants] = useState([]);
  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState(() => startOfLocalDay(new Date()));
  const [roomFilter, setRoomFilter] = useState(() => readRooms(household.id));
  const [logs, setLogs] = useState(EMPTY_LOGS);
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState(null);
  const toastSeq = useRef(0);

  useEffect(() => {
    const q = query(collection(db, 'plants'), where('householdId', '==', household.id));
    return onSnapshot(q, snap => setPlants(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [household.id]);

  // Logs for the visible month only; re-subscribes (and unsubscribes) on month change.
  const monthKey = `${month.getFullYear()}-${month.getMonth()}`;
  useEffect(() => {
    const { start, end } = monthBounds(new Date(Number(monthKey.split('-')[0]), Number(monthKey.split('-')[1]), 1));
    const unsubs = Object.entries(CARE_KINDS).map(([kind, k]) => {
      const q = query(
        collection(db, k.coll),
        where('householdId', '==', household.id),
        where(k.at, '>=', start),
        where(k.at, '<', end),
      );
      return onSnapshot(q, snap => {
        setLogs(prev => ({ ...prev, [kind]: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
      }, err => console.error(`Calendar ${k.coll} listener failed`, err));
    });
    return () => { unsubs.forEach(u => u()); setLogs(EMPTY_LOGS); };
  }, [monthKey, household.id]);

  const active = useMemo(() => plants.filter(p => !p.archived), [plants]);
  const locations = useMemo(() => [...new Set(active.map(p => p.location).filter(Boolean))].sort(), [active]);
  const activeRooms = locations.length > 1 ? locations.filter(l => roomFilter.has(l)) : [];
  const roomKey = activeRooms.join('|');

  const plantById = useMemo(() => Object.fromEntries(plants.map(p => [p.id, p])), [plants]);
  const inRooms = useCallback(
    plant => !activeRooms.length || (plant && activeRooms.includes(plant.location)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roomKey],
  );

  function updateRooms(next) {
    setRoomFilter(next);
    writeRooms(household.id, next);
  }
  function toggleRoom(loc) {
    const next = new Set(roomFilter);
    next.has(loc) ? next.delete(loc) : next.add(loc);
    updateRooms(next);
  }

  const cells = useMemo(() => buildMonthCells(month), [month]);

  // iso -> { water: [{plant, late}], feed: [{plant, late}] }
  const due = useMemo(() => {
    const out = {};
    const first = cells.find(Boolean)?.date;
    const last = cells[cells.length - 1]?.date;
    if (!first) return out;
    const today = startOfLocalDay(new Date());
    const add = (iso, kind, plant, lateDays) => {
      ((out[iso] ||= { water: [], feed: [] })[kind]).push({ plant, lateDays });
    };
    for (const plant of active.filter(inRooms)) {
      const waterDue = nextDueDate(plant, plant.lastWateredAt, plant.lastCheckedAt);
      for (const d of projectDueDates(plant, plant.lastWateredAt, plant.lastCheckedAt, first, last)) {
        const late = d.getTime() === today.getTime() && waterDue && waterDue < today
          ? calendarDaysBetween(waterDue, today) : 0;
        add(todayISO(d), 'water', plant, late);
      }
      const lastFed = toDate(plant.lastFertilizedAt);
      const feedDue = lastFed && plant.fertilizerIntervalDays
        ? new Date(lastFed.getFullYear(), lastFed.getMonth(), lastFed.getDate() + plant.fertilizerIntervalDays) : null;
      for (const d of projectFertilizerDates(plant, plant.lastFertilizedAt, first, last)) {
        const late = d.getTime() === today.getTime() && feedDue && feedDue < today
          ? calendarDaysBetween(feedDue, today) : 0;
        add(todayISO(d), 'feed', plant, late);
      }
    }
    return out;
  }, [active, cells, inRooms]);

  const logsByDay = useMemo(() => {
    const filtered = Object.fromEntries(Object.entries(logs).map(([k, list]) => [
      k, list.filter(l => inRooms(plantById[l.plantId]) || (!activeRooms.length && !plantById[l.plantId])),
    ]));
    return groupLogsByDay(filtered, AT_FIELDS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, plantById, roomKey]);

  const todayStart = startOfLocalDay(new Date());
  const selIso = todayISO(selected);
  const selIsPast = selected < todayStart;
  const selIsToday = isSameDay(selected, todayStart);
  const selDue = due[selIso] || { water: [], feed: [] };
  const selLogs = logsByDay[selIso] || [];

  function dotsFor(iso, date) {
    const dots = [];
    const d = due[iso];
    if (date >= todayStart && d) {
      const lateRows = [...d.water, ...d.feed].filter(x => x.lateDays > 0).length;
      if (lateRows) dots.push({ color: CARE_COLORS.late });
      if (d.water.length > d.water.filter(x => x.lateDays > 0).length) dots.push({ color: CARE_COLORS.water });
      if (d.feed.length) dots.push({ color: CARE_COLORS.fertilizer });
    }
    const dayLogs = logsByDay[iso];
    if (dayLogs) {
      for (const kind of ['water', 'feed', 'check']) {
        if (dayLogs.some(l => l.kind === kind)) dots.push({ color: KIND_COLOR[kind], hollow: true });
      }
    }
    return dots.slice(0, 3);
  }

  const dismissToast = useCallback(() => setToast(null), []);

  async function logNow(plant, kind) {
    const id = ++toastSeq.current;
    try {
      const token = await logCare({ plants: [plant], kind, household, user });
      if (kind === 'water') vibrate(30);
      setToast({ id, message: `${CARE_KINDS[kind].label} ${plant.name}`, token });
    } catch (err) {
      console.error('Care log failed', err);
      setToast({ id, message: `Couldn't log ${plant.name}` });
    }
  }

  async function onUndo(t) {
    setToast(null);
    try { await (t.undo ? t.undo() : undoCare(t.token)); } catch (err) { console.error('Undo failed', err); }
  }

  const dueRows = [
    ...selDue.water.map(x => ({ ...x, kind: 'water' })),
    ...selDue.feed.map(x => ({ ...x, kind: 'feed' })),
  ].sort((a, b) => b.lateDays - a.lateDays || a.plant.name.localeCompare(b.plant.name));

  return (
    <div style={{
      minHeight: '100dvh', background: '#0f1f0f', color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: `20px 16px ${NAV_HEIGHT + 24}px`, boxSizing: 'border-box',
    }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', margin: '0 0 12px' }}>📅 Calendar</h1>

      {locations.length > 1 && (
        <div className="no-scrollbar" style={{ display: 'flex', gap: '6px', overflowX: 'auto', marginBottom: '10px', alignItems: 'center' }}>
          <span style={{ color: '#6a8f6a', fontSize: '12px', flexShrink: 0 }}>📍</span>
          <Chip active={!activeRooms.length} onClick={() => updateRooms(new Set())}>All</Chip>
          {locations.map(loc => (
            <Chip key={loc} active={roomFilter.has(loc)} onClick={() => toggleRoom(loc)}>{loc}</Chip>
          ))}
        </div>
      )}
      {activeRooms.length > 0 && (
        <div style={{ color: '#6a8f6a', fontSize: '12px', marginBottom: '10px' }}>Showing: {activeRooms.join(', ')}</div>
      )}

      <div style={{ background: '#1a2e1a', border: '1px solid #2d4a2d', borderRadius: '14px', padding: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <button aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} style={navBtn}>‹</button>
          <span style={{ fontWeight: '600', fontSize: '16px' }}>{format(month, 'MMMM yyyy')}</span>
          <button aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} style={navBtn}>›</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center' }}>
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={i} style={{ color: '#a8c5a0', fontSize: '12px', paddingBottom: '4px' }}>{d}</div>
          ))}
          {cells.map((cell, i) => {
            if (!cell) return <div key={`pad-${i}`} />;
            const isToday = isSameDay(cell.date, todayStart);
            const isSel = isSameDay(cell.date, selected);
            const dots = dotsFor(cell.iso, cell.date);
            return (
              <button
                key={cell.iso}
                aria-label={format(cell.date, 'EEEE, MMMM d')}
                aria-pressed={isSel}
                onClick={() => setSelected(cell.date)}
                style={{
                  minHeight: '46px', boxSizing: 'border-box', borderRadius: '12px', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px',
                  background: isSel ? '#4caf50' : 'transparent',
                  border: isToday && !isSel ? '2px solid #4caf50' : '2px solid transparent',
                  color: isSel ? '#fff' : cell.date < todayStart ? '#a8c5a0' : '#fff',
                  fontSize: '14px', fontWeight: isSel || isToday ? '700' : '400', padding: 0,
                }}
              >
                <span style={{ lineHeight: 1 }}>{cell.date.getDate()}</span>
                <span style={{ display: 'flex', gap: '3px', height: '6px', alignItems: 'center' }}>
                  {dots.map((dot, j) => (
                    <span key={j} style={{
                      width: '6px', height: '6px', borderRadius: '50%', boxSizing: 'border-box',
                      background: dot.hollow ? 'transparent' : dot.color,
                      border: dot.hollow ? `1.5px solid ${isSel ? '#fff' : dot.color}` : (isSel ? '1px solid #fff' : 'none'),
                    }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <h2 style={{ fontSize: '15px', color: '#a8c5a0', fontWeight: '600', margin: '18px 0 8px' }}>
        {format(selected, 'EEEE, MMM d')}{selIsToday ? ' · Today' : ''}
      </h2>

      {!selIsPast && (
        dueRows.length === 0 ? (
          <Empty>Nothing due.</Empty>
        ) : dueRows.map(row => (
          <Row key={`${row.kind}-${row.plant.id}`} onOpen={() => onSelectPlant(row.plant)} name={row.plant.name}
            sub={row.lateDays > 0 ? `${row.lateDays} day${row.lateDays !== 1 ? 's' : ''} late` : row.kind === 'water' ? 'Water' : 'Feed'}
            subColor={row.lateDays > 0 ? CARE_COLORS.late : KIND_COLOR[row.kind]}
          >
            {selIsToday && (
              <button
                aria-label={`${row.kind === 'water' ? 'Water' : 'Feed'} ${row.plant.name}`}
                onClick={() => logNow(row.plant, row.kind)}
                style={{
                  width: BTN, height: BTN, flexShrink: 0, borderRadius: '12px', cursor: 'pointer', fontSize: '20px',
                  background: KIND_COLOR[row.kind], border: 'none',
                }}
              >
                {row.kind === 'water' ? '💧' : '🌿'}
              </button>
            )}
          </Row>
        ))
      )}

      {selLogs.length > 0 && (
        <>
          {!selIsPast && <h3 style={{ fontSize: '13px', color: '#6a8f6a', fontWeight: '600', margin: '14px 0 8px' }}>Logged</h3>}
          {selLogs.map(l => {
            const plant = plantById[l.plantId];
            const name = plant?.name || 'Deleted plant';
            return (
              <Row key={`${l.kind}-${l.id}`} onOpen={() => setEditing({ ...l, plantName: name })} name={name}
                sub={`${CARE_KINDS[l.kind].label} · ${l.loggedBy?.displayName || 'Someone'} · ${format(l.at, 'h:mm a')}`}
                subColor={KIND_COLOR[l.kind]}
                dot={KIND_COLOR[l.kind]}
              />
            );
          })}
        </>
      )}
      {selIsPast && selLogs.length === 0 && <Empty>No care logged this day.</Empty>}

      {editing && (
        <EditLogSheet
          log={editing}
          user={user}
          household={household}
          onClose={() => setEditing(null)}
          onDeleted={t => setToast({ ...t, id: ++toastSeq.current })}
        />
      )}
      <UndoToast toast={toast} onUndo={onUndo} onDismiss={dismissToast} />
    </div>
  );
}

function Row({ name, sub, subColor, dot, onOpen, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px', minHeight: '56px', boxSizing: 'border-box',
      background: '#1a2e1a', border: '1px solid #2d4a2d', borderRadius: '12px', padding: '6px 8px 6px 12px', marginBottom: '8px',
    }}>
      <button
        type="button"
        onClick={onOpen}
        style={{
          flex: 1, minWidth: 0, minHeight: BTN, background: 'none', border: 'none', color: '#fff', cursor: 'pointer',
          textAlign: 'left', padding: 0, display: 'flex', alignItems: 'center', gap: '10px',
        }}
      >
        {dot && <span style={{ width: 8, height: 8, borderRadius: '50%', border: `2px solid ${dot}`, flexShrink: 0, boxSizing: 'border-box' }} />}
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: '15px', fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
          <span style={{ display: 'block', fontSize: '12px', color: subColor }}>{sub}</span>
        </span>
      </button>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return <p style={{ color: '#6a8f6a', fontSize: '14px', margin: '4px 0' }}>{children}</p>;
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        flexShrink: 0, padding: '5px 10px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap',
        fontWeight: active ? '700' : '400',
        background: active ? '#2d4a1e' : '#1e331e',
        color: active ? '#a8e080' : '#a8c5a0',
        border: `1px solid ${active ? '#4caf50' : '#2d4a2d'}`,
      }}
    >
      {children}
    </button>
  );
}

const navBtn = { background: 'none', border: 'none', color: '#a8c5a0', fontSize: '24px', cursor: 'pointer', width: BTN, height: BTN };
