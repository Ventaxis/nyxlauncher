import { useMemo, useState } from 'react';
import GameCard from './GameCard.jsx';
import EmptyScene from './EmptyScene.jsx';
import WeekChart from './WeekChart.jsx';
import { fmtClock, fmtHours } from '../format.js';
import { liveDelta, useNow } from '../useLive.js';

const SORT_LABELS = {
  recent: 'Недавние',
  name: 'По названию',
  hours: 'По часам',
  added: 'По добавлению',
};

const FILTERS = {
  all: 'Все',
  playing: 'В игре',
  today: 'Сегодня',
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
      return copy.sort((a, b) => b.added_at - a.added_at);
    default:
      return copy.sort((a, b) => {
        const at = timeOf(a.last_played);
        const bt = timeOf(b.last_played);
        if (bt !== at) return bt - at;
        return a.name.localeCompare(b.name, 'ru');
      });
  }
}

function RailToday({ totals, extra }) {
  const now = useNow(true);
  return (
    <section className="rail-card rail-today">
      <div className="rail-label">Сегодня</div>
      <div className="rail-clock mono">{fmtClock((totals.today_seconds || 0) + extra)}</div>
      <div className="rail-sub mono">
        всего {fmtClock(totals.seconds)}
        {totals.streak_days > 0 && (
          <>
            <span className="card-dot" aria-hidden="true">·</span>
            {totals.streak_days} дн подряд
          </>
        )}
      </div>
      <div className="rail-now mono" aria-hidden="true">
        {String(new Date(now).getHours()).padStart(2, '0')}:
        {String(new Date(now).getMinutes()).padStart(2, '0')}:
        {String(new Date(now).getSeconds()).padStart(2, '0')}
      </div>
    </section>
  );
}

function RailWeek({ week }) {
  const sum = week.reduce((s, d) => s + d.seconds, 0);
  const active = week.filter((d) => d.seconds > 0).length;
  return (
    <section className="rail-card">
      <div className="rail-head">
        <span className="rail-label">Неделя</span>
        <span className="rail-figure mono">{fmtHours(sum)}</span>
      </div>
      <WeekChart week={week} height={132} />
      <div className="rail-sub mono">
        {active} из 7 дней · в среднем {fmtHours(Math.round(sum / 7))}
      </div>
    </section>
  );
}

function RailAchievements({ achievements }) {
  const unlocked = achievements.filter((a) => a.unlocked);
  // Ближайшая закрытая: чем больше прогресс, тем она важнее.
  const next = achievements
    .filter((a) => !a.unlocked)
    .sort((a, b) => b.progress - a.progress)[0];
  const pct = Math.round((unlocked.length / Math.max(1, achievements.length)) * 100);
  return (
    <section className="rail-card">
      <div className="rail-head">
        <span className="rail-label">Достижения</span>
        <span className="rail-figure mono">
          {unlocked.length} / {achievements.length}
        </span>
      </div>
      <div className="rail-bar" role="img" aria-label={`Открыто ${pct}%`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      {next ? (
        <div className="rail-next">
          <div className="rail-next-title">{next.title}</div>
          <div className="rail-next-desc">{next.description}</div>
          <div className="rail-bar rail-bar-sm">
            <span style={{ width: `${Math.round(next.progress * 100)}%` }} />
          </div>
        </div>
      ) : (
        <div className="rail-sub">Все достижения открыты</div>
      )}
    </section>
  );
}

function RailFocus({ games }) {
  const top = games
    .filter((g) => g.week_seconds > 0)
    .sort((a, b) => b.week_seconds - a.week_seconds)
    .slice(0, 3);
  if (top.length === 0) return null;
  const max = Math.max(...top.map((g) => g.week_seconds), 1);
  return (
    <section className="rail-card">
      <div className="rail-label">Где ушло время</div>
      <ul className="rail-rank">
        {top.map((g) => (
          <li key={g.id} className="rail-rank-row">
            <span className="rail-rank-name" title={g.name}>{g.name}</span>
            <span className="rail-rank-val mono">{fmtHours(g.week_seconds)}</span>
            <span className="rail-rank-bar" aria-hidden="true">
              <span style={{ width: `${Math.round((g.week_seconds / max) * 100)}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Shelf({
  summary,
  query,
  entered,
  onOpen,
  onAdd,
  onLaunch,
  error,
  onRetry,
  settings,
  onSort,
  icons,
  receivedAt,
  busy,
}) {
  const [filter, setFilter] = useState('all');

  const allGames = summary ? summary.games : [];
  const anyPlaying = allGames.some((g) => g.playing);
  const now = useNow(anyPlaying);
  // Секунды, набежавшие после снимка сводки: и в шапке, и в карточках.
  const live = anyPlaying
    ? allGames.reduce((s, g) => s + liveDelta(g, receivedAt, now), 0)
    : 0;
  const counts = useMemo(
    () => ({
      all: allGames.length,
      playing: allGames.filter((g) => g.playing).length,
      today: allGames.filter((g) => (g.today_seconds || 0) > 0).length,
    }),
    [allGames],
  );

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

  if (allGames.length === 0) {
    return <EmptyScene onAdd={onAdd} />;
  }

  const q = query.trim().toLowerCase();
  let filtered = q ? allGames.filter((g) => g.name.toLowerCase().includes(q)) : allGames;
  if (filter === 'playing') filtered = filtered.filter((g) => g.playing);
  if (filter === 'today') filtered = filtered.filter((g) => (g.today_seconds || 0) > 0);

  const sortMode = (settings && settings.sort_mode) || 'recent';
  const visible = sortGames(filtered, sortMode);
  const showIcons = !settings || settings.show_icons !== false;
  const totals = summary.totals;
  const week = totals.week || [];

  return (
    <div className="shelf">
      <header className={entered ? 'shelf-head' : 'shelf-head enter'}>
        <div className="shelf-title-wrap">
          <h1 className="shelf-title">Библиотека</h1>
          <span className="shelf-count mono">
            {q ? `${visible.length} из ${allGames.length}` : allGames.length}
          </span>
        </div>
        <div className="shelf-stats">
          <div className="head-stat head-stat-gold">
            <div className="head-num mono">{fmtClock(totals.seconds + live)}</div>
            <div className="head-label">всего, ч:мм:сс</div>
          </div>
          <div className="head-stat">
            <div className="head-num mono">{fmtHours((totals.today_seconds || 0) + live)}</div>
            <div className="head-label">сегодня</div>
          </div>
          <div className="head-stat">
            <div className="head-num mono">
              {totals.streak_days > 0 ? (
                <svg className="icon sm" aria-hidden="true"><use href="#i-flame" /></svg>
              ) : null}
              {totals.streak_days} дн
            </div>
            <div className="head-label">серия</div>
          </div>
          <div className="head-stat">
            <div className="head-num mono">{totals.sessions_count}</div>
            <div className="head-label">сессии</div>
          </div>
        </div>
      </header>

      <div className="shelf-cols">
        <section className="shelf-main">
          <div className="shelf-toolbar">
            <div className="chips" role="group" aria-label="Фильтр игр">
              {Object.entries(FILTERS).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`chip-btn${filter === value ? ' is-on' : ''}`}
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                >
                  {label}
                  <span className="chip-count mono">{counts[value]}</span>
                </button>
              ))}
            </div>
            <div className="chips chips-right" role="group" aria-label="Сортировка">
              {Object.entries(SORT_LABELS).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`chip-btn${sortMode === value ? ' is-on' : ''}`}
                  onClick={() => onSort(value)}
                  aria-pressed={sortMode === value}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {summary.tracker_paused && (
            <p className="shelf-paused">
              <svg className="icon sm" aria-hidden="true"><use href="#i-pause" /></svg>
              Учёт на паузе: время не записывается, пока пауза не снята
            </p>
          )}

          {visible.length === 0 ? (
            <p className="shelf-none">
              {q
                ? `По запросу «${query.trim()}» ничего нет.`
                : filter === 'playing'
                  ? 'Сейчас ничего не запущено.'
                  : 'Сегодня ещё не играли.'}
            </p>
          ) : (
            <div className="shelf-grid">
              {visible.map((g, i) => (
                <GameCard
                  key={g.id}
                  game={g}
                  icon={showIcons ? icons && icons[g.id] : null}
                  receivedAt={receivedAt}
                  enterIndex={entered ? null : i}
                  busy={busy}
                  onOpen={onOpen}
                  onLaunch={onLaunch}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="rail" aria-label="Сводка">
          <RailToday totals={totals} extra={live} />
          <RailWeek week={week} />
          <RailFocus games={allGames} />
          <RailAchievements achievements={summary.achievements || []} />
          <p className="rail-hint">
            <span className="kbd">/</span> поиск · <span className="kbd">Esc</span> назад
          </p>
        </aside>
      </div>
    </div>
  );
}
