import Spine from './Spine.jsx';
import WeekChart from './WeekChart.jsx';
import Achievements from './Achievements.jsx';
import { fmtHours, fmtHoursBig, fmtLastPlayed } from '../format.js';
import { useCountUp } from '../useCountUp.js';

function Stat({ label, seconds }) {
  const v = useCountUp(seconds ?? 0);
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-num mono">{seconds == null ? '—' : fmtHoursBig(v)}</div>
    </div>
  );
}

export default function Detail({ game, stats, achievements, onBack, onLaunch, onRemove }) {
  const hours = useCountUp(game.seconds_played);
  const weekSum = stats ? stats.week.reduce((s, d) => s + d.seconds, 0) : null;
  const unlockedCount = achievements ? achievements.filter((a) => a.unlocked).length : 0;

  return (
    <div className="detail">
      <button type="button" className="btn btn-quiet detail-back" onClick={onBack}>
        <svg className="icon" aria-hidden="true"><use href="#i-back" /></svg>
        Библиотека
      </button>

      <div className="detail-head">
        <Spine game={game} large />
        <div className="detail-info">
          <h1 className="detail-title">{game.name}</h1>
          <div className="detail-last">
            <svg className="icon sm" aria-hidden="true"><use href="#i-clock" /></svg>
            <span>последний запуск: {fmtLastPlayed(game.last_played)}</span>
          </div>
          <div className="detail-actions">
            <button type="button" className="btn btn-primary" onClick={onLaunch}>
              <svg className="icon" aria-hidden="true"><use href="#i-play" /></svg>
              Играть
            </button>
            <button type="button" className="btn btn-quiet" onClick={onRemove}>
              <svg className="icon" aria-hidden="true"><use href="#i-trash" /></svg>
              Убрать
            </button>
          </div>
        </div>
        <div className="detail-hours">
          <span className="detail-hours-num mono">{fmtHoursBig(hours)}</span>
          <span className="detail-hours-label">всего</span>
        </div>
      </div>

      <div className="stats-row">
        <Stat label="сегодня" seconds={stats ? stats.today_seconds : null} />
        <Stat label="за неделю" seconds={weekSum} />
        <Stat label="рекорд сессии" seconds={stats ? stats.longest_session_seconds : null} />
      </div>

      {stats && (
        <section className="sec">
          <div className="sec-head">
            <h2 className="sec-title">Неделя</h2>
            <span className="sec-count mono">{fmtHours(weekSum)}</span>
          </div>
          <WeekChart week={stats.week} />
        </section>
      )}

      {achievements && (
        <section className="sec">
          <div className="sec-head">
            <h2 className="sec-title">Достижения</h2>
            <span className="sec-count mono">{unlockedCount} из {achievements.length}</span>
          </div>
          <Achievements achievements={achievements} />
        </section>
      )}
    </div>
  );
}
