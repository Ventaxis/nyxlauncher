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

const SORT_LABELS = {
  recent: 'Недавние',
  name: 'По названию',
  hours: 'По часам',
  added: 'По добавлению',
};

function timeOf(iso) {
  const t = iso ? Date.parse(iso) : 0;
  return Number.isFinite(t) ? t : 0;
}

/** @param {import('../api.js').Game[]} games */
function sortGames(games, mode) {
  const copy = [...games];
  switch (mode) {
    case 'name':
      return copy.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    case 'hours':
      return copy.sort((a, b) => b.seconds_played - a.seconds_played);
    case 'added':
      return copy.sort((a, b) => (b.added_at || 0) - (a.added_at || 0));
    default:
      return copy.sort((a, b) => {
        const at = timeOf(a.last_played);
        const bt = timeOf(b.last_played);
        if (bt !== at) return bt - at;
        return a.name.localeCompare(b.name, 'ru');
      });
  }
}

export default function Shelf({
  summary,
  query,
  entered,
  onOpen,
  onAdd,
  error,
  onRetry,
  settings,
  onSort,
  icons,
}) {
  if (!summary) {
    if (error) {
      return (
        <div className="boot boot-error" role="alert">
          <p className="boot-title">Архив не открылся</p>
          <p className="boot-text mono">{error}</p>
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            <svg className="icon" aria-hidden="true"><use href="#i-play" /></svg>
            Повторить
          </button>
        </div>
      );
    }
    return <p className="boot mono">открываю архив…</p>;
  }

  const games = summary.games;
  if (games.length === 0) {
    return <EmptyScene onAdd={onAdd} />;
  }

  const q = query.trim().toLowerCase();
  const filtered = q ? games.filter((g) => g.name.toLowerCase().includes(q)) : games;
  const sortMode = (settings && settings.sort_mode) || 'recent';
  const visible = sortGames(filtered, sortMode);
  const showIcons = !settings || settings.show_icons !== false;

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

      <div className="shelf-toolbar">
        <label className="sort">
          <svg className="icon sm" aria-hidden="true"><use href="#i-sort" /></svg>
          <span>Сортировка</span>
          <select
            value={sortMode}
            onChange={(e) => onSort(e.target.value)}
            aria-label="Сортировка библиотеки"
          >
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        {summary.tracker_paused && (
          <span className="chip chip-paused">
            <svg className="icon sm" aria-hidden="true"><use href="#i-pause" /></svg>
            учёт на паузе
          </span>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="shelf-none">По запросу «{query.trim()}» ничего нет.</p>
      ) : (
        <div className="shelf-grid">
          {visible.map((g, i) => (
            <Spine
              key={g.id}
              game={g}
              icon={showIcons && icons ? icons[g.id] : null}
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
