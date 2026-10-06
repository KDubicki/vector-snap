import { useState } from 'react';

export function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path
        d={locked ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 5.8-1'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface LockedColorsProps {
  locked: string[];
  canLock: boolean;
  onLock: (hex: string) => void;
  onUnlock: (hex: string) => void;
}

/**
 * Colors that must appear exactly in the palette (FR-16): locked palette rows and brand
 * colors added by hex. Changing them re-runs the color reduction.
 */
export function LockedColors({ locked, canLock, onLock, onUnlock }: LockedColorsProps) {
  const [candidate, setCandidate] = useState('#000000');
  const alreadyLocked = locked.includes(candidate.toLowerCase());

  return (
    <div className="field">
      <span>Locked colors</span>
      {locked.length > 0 ? (
        <ul className="locked-colors">
          {locked.map((hex) => (
            <li key={hex}>
              <span className="locked-colors__swatch" style={{ background: hex }} />
              <code>{hex}</code>
              <button
                type="button"
                className="link"
                aria-label={`Unlock ${hex}`}
                onClick={() => onUnlock(hex)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">
          Lock palette colors or add brand colors to keep them exactly when colors are reduced.
        </p>
      )}
      <div className="locked-colors__add">
        <input
          type="color"
          value={candidate}
          aria-label="Brand color to lock"
          onChange={(event) => setCandidate(event.target.value)}
        />
        <button
          type="button"
          className="secondary"
          disabled={!canLock || alreadyLocked}
          title={canLock ? undefined : 'Every palette slot is locked; add more colors first'}
          onClick={() => onLock(candidate)}
        >
          Lock color
        </button>
      </div>
    </div>
  );
}
