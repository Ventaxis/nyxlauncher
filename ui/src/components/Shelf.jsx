import Spine from './Spine.jsx';
import EmptyScene from './EmptyScene.jsx';
import { fmtHoursBig } from '../format.js';
import { useCountUp } from '../useCountUp.js';

function ShelfTotal({ seconds }) {
  const v = useCountUp(seconds);
  return (
    <div className="head-stat head-stat-gold">
      <div className="head-num mono">{fmtHoursBig(v)}</div>
      <div className="head-label">всего часов</div>
    </div>
  );
}

export default function Shelf({ summary, query, entered, onOpen, onAdd }) {
  if (!summary) {
    return <p className="boot mono">открываю архив…</p>;
  }

  const games = summary.games;
  if (games.length === 0) {
    return <EmptyScene onAdd={onAdd} />;
  }

  const q = query.trim().toLowerCase();
  const visible = q ? games.filter((g) => g.name.toLowerCase().includes(q)) : games;

  return (
    <div className="shelf">
      <header className={entered ? 'shelf-head' : 'shelf-head enter'}>
        <div className="shelf-title-wrap">
          <h1 className="shelf-title">Библиотека</h1>
          <span className="shelf-count mono">
            {q ? `${visible.length} из ${games.length}` : games.length}
          </span>
        </div>
        <div className="shelf-stats">
          <ShelfTotal seconds={summary.totals.seconds} />
          {summary.totals.streak_days > 0 && (
            <div className="head-stat">
              <div className="head-num mono">
                <svg className="icon sm" aria-hidden="true"><use href="#i-flame" /></svg>
                {summary.totals.streak_days} дн
              </div>
              <div className="head-label">серия</div>
            </div>
          )}
          <div className="head-stat">
            <div className="head-num mono">{summary.totals.sessions_count}</div>
            <div className="head-label">сессии</div>
          </div>
        </div>
      </header>

      {visible.length === 0 ? (
        <p className="shelf-none">По запросу «{query.trim()}» ничего нет.</p>
      ) : (
        <div className="shelf-grid">
          {visible.map((g, i) => (
            <Spine
              key={g.id}
              game={g}
              interactive
              enterIndex={entered ? null : i}
              onClick={() => onOpen(g.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
