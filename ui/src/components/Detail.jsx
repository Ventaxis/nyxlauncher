import { useEffect, useState } from 'react';
import WeekChart from './WeekChart.jsx';
import Achievements from './Achievements.jsx';
import SessionHistory from './SessionHistory.jsx';
import { fmtHours, fmtHoursBig, fmtLastPlayed, hueFromName, monogram } from '../format.js';
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

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* буфер обмена может быть недоступен — молча игнорируем */
    }
  };
  return (
    <button type="button" className="icon-btn" onClick={copy} title="Скопировать путь">
      <svg className="icon sm" aria-hidden="true"><use href={done ? '#i-check' : '#i-external'} /></svg>
    </button>
  );
}

export default function Detail({
  game,
  stats,
  achievements,
  sessions,
  icon,
  settings,
  busy,
  onBack,
  onLaunch,
  onRemove,
  onSaveLaunch,
  onRefreshExe,
  onAddSession,
  onDeleteSession,
  onResetStats,
}) {
  const hours = useCountUp(game.seconds_played);
  const weekSum = stats ? stats.week.reduce((s, d) => s + d.seconds, 0) : null;
  const unlockedCount = achievements ? achievements.filter((a) => a.unlocked).length : 0;
  const strict = settings && settings.strict_anticheat;

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(game.name);
  const [args, setArgs] = useState(game.args || '');
  const [workDir, setWorkDir] = useState(game.work_dir || '');

  useEffect(() => {
    setName(game.name);
    setArgs(game.args || '');
    setWorkDir(game.work_dir || '');
    setEditing(false);
  }, [game.id]);

  const save = async (e) => {
    e.preventDefault();
    try {
      await onSaveLaunch({ name, args, workDir });
      setEditing(false);
    } catch {
      // причина уже показана в статусбаре — форму оставляем открытой
    }
  };

  return (
    <div className="detail">
      <button type="button" className="btn btn-quiet detail-back" onClick={onBack}>
        <svg className="icon" aria-hidden="true"><use href="#i-back" /></svg>
        Библиотека
      </button>

      <header
        className={`hero${game.playing ? ' is-playing' : ''}`}
        style={{ '--hue': hueFromName(game.name) }}
      >
        {icon && (
          <span
            className="hero-glow"
            aria-hidden="true"
            style={{ backgroundImage: `url(${icon})` }}
          />
        )}
        <div className="hero-inner">
          <div className="hero-art">
            {icon ? (
              <img src={icon} alt="" draggable="false" />
            ) : (
              <span className="hero-mono" aria-hidden="true">{monogram(game.name)}</span>
            )}
          </div>
          <div className="hero-info">
            <div className="hero-eyebrow">
              {game.playing ? (
                <>
                  <span className="live-dot" aria-hidden="true" />
                  сейчас в игре
                </>
              ) : (
                'в библиотеке'
              )}
            </div>
            <h1 className="hero-title">{game.name}</h1>
            <div className="hero-meta">
              <span>
                <svg className="icon sm" aria-hidden="true"><use href="#i-clock" /></svg>
                последний запуск: {fmtLastPlayed(game.last_played)}
              </span>
              <span className="hero-dot" aria-hidden="true">·</span>
              <span>{stats ? stats.sessions_count : 0} сессий</span>
              {strict && (
                <>
                  <span className="hero-dot" aria-hidden="true">·</span>
                  <span className="hero-shield">
                    <svg className="icon sm" aria-hidden="true"><use href="#i-shield" /></svg>
                    строгий режим
                  </span>
                </>
              )}
            </div>
            <div className="hero-actions">
              <button
                type="button"
                className="btn btn-primary btn-play"
                onClick={onLaunch}
                disabled={game.playing || busy}
              >
                <svg className="icon" aria-hidden="true"><use href={game.playing ? '#i-pause' : '#i-play'} /></svg>
                {game.playing ? 'Играет' : 'Играть'}
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setEditing((v) => !v)}>
                <svg className="icon" aria-hidden="true"><use href="#i-settings" /></svg>
                Настройки запуска
              </button>
              <button
                type="button"
                className="btn btn-quiet"
                onClick={onRefreshExe}
                disabled={busy}
                title="Пересчитать хеш exe после обновления игры"
              >
                <svg className="icon" aria-hidden="true"><use href="#i-refresh" /></svg>
                Обновить exe
              </button>
              <button type="button" className="btn btn-quiet btn-danger" onClick={onRemove} disabled={busy}>
                <svg className="icon" aria-hidden="true"><use href="#i-trash" /></svg>
                Убрать
              </button>
            </div>
          </div>
          <div className="hero-hours">
            <span className="hero-hours-num mono">{fmtHoursBig(hours)}</span>
            <span className="hero-hours-label">всего</span>
          </div>
        </div>
      </header>

      <div className="stats-row">
        <Stat label="сегодня" seconds={stats ? stats.today_seconds : null} />
        <Stat label="за неделю" seconds={weekSum} />
        <Stat label="рекорд сессии" seconds={stats ? stats.longest_session_seconds : null} />
      </div>

      <section className="sec">
        <div className="sec-head">
          <h2 className="sec-title">Запуск</h2>
          <span className="sec-count">аргументы и рабочая папка</span>
          <span className="sec-flex" />
          <button type="button" className="btn btn-quiet" onClick={() => setEditing((v) => !v)}>
            <svg className="icon" aria-hidden="true"><use href="#i-edit" /></svg>
            {editing ? 'Отмена' : 'Изменить'}
          </button>
        </div>

        {editing ? (
          <form className="launch-form" onSubmit={save}>
            <label className="field">
              <span>Название</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                required
              />
            </label>
            <label className="field">
              <span>Аргументы командной строки</span>
              <input
                type="text"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="-windowed -novid"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>Рабочая папка</span>
              <input
                type="text"
                value={workDir}
                onChange={(e) => setWorkDir(e.target.value)}
                placeholder="пусто — папка exe"
                spellCheck={false}
              />
            </label>
            <div className="launch-form-foot">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                <svg className="icon" aria-hidden="true"><use href="#i-check" /></svg>
                Сохранить
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)}>
                Отмена
              </button>
            </div>
          </form>
        ) : (
          <div className="kv-list">
            <div className="kv">
              <span className="kv-key">exe</span>
              <code className="kv-val" title={game.exe_path}>{game.exe_path}</code>
              <CopyButton text={game.exe_path} />
            </div>
            <div className="kv">
              <span className="kv-key">аргументы</span>
              <code className="kv-val">{game.args || '—'}</code>
            </div>
            <div className="kv">
              <span className="kv-key">рабочая папка</span>
              <code className="kv-val">{game.work_dir || 'папка exe'}</code>
            </div>
            <div className="kv">
              <span className="kv-key">контрольная сумма</span>
              <code className="kv-val mono">
                {game.exe_hash ? `${game.exe_hash.slice(0, 16)}…` : 'не рассчитана'}
              </code>
            </div>
          </div>
        )}
      </section>

      {stats && (
        <section className="sec">
          <div className="sec-head">
            <h2 className="sec-title">Неделя</h2>
            <span className="sec-count mono">{fmtHours(weekSum)}</span>
          </div>
          <WeekChart week={stats.week} />
        </section>
      )}

      <SessionHistory
        sessions={sessions}
        onAdd={onAddSession}
        onDelete={onDeleteSession}
        onReset={onResetStats}
        busy={busy}
      />

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
