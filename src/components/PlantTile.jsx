import { wateringStatus, CARE_COLORS } from '../lib/dates';
import { archiveReasonLabel } from '../lib/archive';
import { useLongPress } from '../hooks/useLongPress';

export default function PlantTile({ plant, multiSelect, isSelected, onLongPress, onClick }) {
  const { handlers, consumeClick } = useLongPress(onLongPress);

  const status = wateringStatus(plant, plant.lastWateredAt, plant.lastCheckedAt);
  const needsAttention = !plant.archived && (status.state === 'late' || status.state === 'never');

  const borderColor = plant.archived
    ? '#4a4020'
    : isSelected
      ? '#4caf50'
      : needsAttention
        ? CARE_COLORS.late
        : '#2d4a2d';

  return (
    <div
      onClick={() => { if (!consumeClick()) onClick(); }}
      {...handlers}
      style={{
        background: '#1a2e1a', borderRadius: '16px', overflow: 'hidden', cursor: 'pointer',
        border: `1px solid ${borderColor}`,
        boxShadow: isSelected ? '0 0 0 2px #4caf50' : needsAttention ? `0 0 0 1px ${CARE_COLORS.late}44` : 'none',
        transition: 'box-shadow 0.15s',
        userSelect: 'none', WebkitTouchCallout: 'none',
      }}
    >
      <div style={{ aspectRatio: '1', overflow: 'hidden', background: '#2d4a2d', position: 'relative' }}>
        {plant.photoUrl ? (
          <img
            src={plant.photoUrl}
            alt={plant.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', filter: plant.archived ? 'grayscale(0.7)' : 'none', opacity: plant.archived ? 0.7 : 1 }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '40px', opacity: plant.archived ? 0.5 : 1 }}>🌿</div>
        )}
        {multiSelect && (
          <div style={{
            position: 'absolute', top: '8px', right: '8px',
            width: '22px', height: '22px', borderRadius: '50%',
            background: isSelected ? '#4caf50' : 'rgba(0,0,0,0.5)',
            border: '2px solid #fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '13px', color: '#fff',
          }}>
            {isSelected ? '✓' : ''}
          </div>
        )}
      </div>
      <div style={{ padding: '10px' }}>
        <div style={{ color: plant.archived ? '#a8c5a0' : '#fff', fontWeight: '600', fontSize: '14px', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {plant.name}
        </div>
        {plant.location && (
          <div style={{ color: '#a8c5a0', fontSize: '12px', marginBottom: '6px' }}>📍 {plant.location}</div>
        )}
        {plant.archived ? (
          <div style={{
            display: 'inline-block', background: '#3a301844', color: '#e0c070',
            borderRadius: '6px', padding: '2px 6px', fontSize: '11px', fontWeight: '600',
            maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {archiveReasonLabel(plant)}
          </div>
        ) : (
          <div style={{
            display: 'inline-block', background: status.color + '22', color: status.color,
            borderRadius: '6px', padding: '2px 6px', fontSize: '11px', fontWeight: '600',
          }}>
            {status.icon} {status.label}
          </div>
        )}
      </div>
    </div>
  );
}
