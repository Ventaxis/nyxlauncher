import { useEffect, useRef, useState } from 'react';
import { fmtShortDate } from '../format.js';

const FLASH_MS = 900;

// Пороги из src-tauri/achievements.json — для текста «2,1 / 3 ч».
const THRESHOLDS = {
  first_launch: { value: 1, unit: 'шт', dec: 0 },
  hour_of_moon: { value: 1, unit: 'ч', dec: 1 },
  ten_hours: { value: 10, unit: 'ч', dec: 1 },
  hundred_hours: { value: 100, unit: 'ч', dec: 1 },
  night_shift: { value: 1, unit: 'шт', dec: 0 },
  marathon: { value: 3, unit: 'ч', dec: 1 },
  collector: { value: 5, unit: 'шт', dec: 0 },
  explorer: { value: 3, unit: 'шт', dec: 0 },
  persistence: { value: 3, unit: 'дн', dec: 0 },
  week_streak: { value: 7, unit: 'дн', dec: 0 },
};

const nf = new Intl.NumberFormat('ru-RU');

function fmtProgress(a) {
  const t = THRESHOLDS[a.id];
  if (!t) return null;
  const cur = t.value * Math.max(0, Math.min(1, a.progress || 0));
  const curStr = t.dec ? nf.format(Math.round(cur * 10) / 10) : nf.format(Math.round(cur));
  return `${curStr} / ${nf.format(t.value)} ${t.unit}`;
}

function clampPct(a) {
  return Math.round(Math.max(0, Math.min(1, a.progress || 0)) * 100);
}

export default function Achievements({ achievements }) {
  const [flashing, setFlashing] = useState(() => new Set());
  const prev = useRef(null);
  const timers = useRef({});

  useEffect(() => () => {
    Object.values(timers.current).forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (!achievements) return;
    const fresh = [];
    if (prev.current) {
      for (const a of achievements) {
        if (a.unlocked && prev.current[a.id] === false) fresh.push(a.id);
      }
    }
    prev.current = Object.fromEntries(achievements.map((a) => [a.id, a.unlocked]));
    for (const id of fresh) {
      setFlashing((s) => {
        const n = new Set(s);
        n.add(id);
        return n;
      });
      timers.current[id] = setTimeout(() => {
        delete timers.current[id];
        setFlashing((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
      }, FLASH_MS);
    }
  }, [achievements]);

  if (!achievements) return null;

  return (
    <div className="ach-grid">
      {achievements.map((a) => {
        const unlocked = !!a.unlocked;
        const iconId = unlocked ? a.icon : 'lock';
        const progressText = fmtProgress(a);
        return (
          <article
            key={a.id}
            className={`ach ${unlocked ? 'is-unlocked' : 'is-locked'}${flashing.has(a.id) ? ' is-flash' : ''}`}
          >
            <div className="ach-top">
              <span className="ach-icon" aria-hidden="true">
                <svg className="icon"><use href={`#i-${iconId}`} /></svg>
              </span>
              <div className="ach-text">
                <div className="ach-title">{a.title}</div>
                <div className="ach-desc">{a.description}</div>
              </div>
            </div>
            <div className="ach-foot">
              {unlocked ? (
                <span className="ach-date mono">открыто {fmtShortDate(a.unlocked_at)}</span>
              ) : (
                <>
                  <span
                    className="ach-bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={clampPct(a)}
                    aria-label={progressText || a.title}
                  >
                    <span className="ach-bar-fill" style={{ width: `${clampPct(a)}%` }} />
                  </span>
                  <span className="ach-progress mono">{progressText || '—'}</span>
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
