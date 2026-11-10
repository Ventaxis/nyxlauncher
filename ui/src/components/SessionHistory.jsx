import { useEffect, useState } from 'react';
import { fmtDateTime, fmtDuration, toLocalInputValue } from '../format.js';

/**
 * История сессий игры: список, ручное добавление, удаление, сброс.
 * Ручные правки подписаны так же, как обычные сессии, и помечены бейджем.
 */
export default function SessionHistory({ sessions, onAdd, onDelete, onReset, busy }) {
  const [adding, setAdding] = useState(false);
  const [start, setStart] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [error, setError] = useState(null);

  useEffect(() => {
    // По умолчанию — час назад, чтобы форма сразу была валидной.
    setStart(toLocalInputValue(Math.floor(Date.now() / 1000) - 3600));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const m = Number(minutes);
    if (!Number.isFinite(m) || m < 1 || m > 1440) {
      setError('Длительность: от 1 до 1440 минут');
      return;
    }
    try {
      await onAdd(start, Math.round(m));
      setAdding(false);
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
    }
  };

  const list = sessions || [];

  return (
    <section className="sec">
      <div className="sec-head">
        <h2 className="sec-title">История сессий</h2>
        <span className="sec-count mono">{list.length}</span>
        <span className="sec-flex" />
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => setAdding((v) => !v)}
        >
          <svg className="icon" aria-hidden="true"><use href={adding ? '#i-x' : '#i-plus'} /></svg>
          {adding ? 'Отмена' : 'Добавить'}
        </button>
      </div>

      {adding && (
        <form className="session-add" onSubmit={submit}>
          <label className="field">
            <span>Начало</span>
            <input
              type="datetime-local"
              value={start}
              max={toLocalInputValue(Math.floor(Date.now() / 1000))}
              onChange={(e) => setStart(e.target.value)}
              required
            />
          </label>
          <label className="field field-min">
            <span>Минут</span>
            <input
              type="number"
              min="1"
              max="1440"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              required
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <svg className="icon" aria-hidden="true"><use href="#i-check" /></svg>
            Записать
          </button>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>
      )}

      {list.length === 0 ? (
        <p className="muted">Сессий пока нет — запустите игру или добавьте запись вручную.</p>
      ) : (
        <ul className="sessions">
          {list.map((s) => (
            <li key={s.id} className={`session${s.manual ? ' is-manual' : ''}${s.active ? ' is-live' : ''}`}>
              <span className="session-dot" aria-hidden="true" />
              <span className="session-date">{fmtDateTime(s.start)}</span>
              <span className="session-dur mono">{fmtDuration(s.seconds)}</span>
              {s.manual && <span className="badge">вручную</span>}
              {s.active && <span className="badge is-live">идёт</span>}
              <span className="session-flex" />
              {!s.active && (
                <button
                  type="button"
                  className="icon-btn"
                  title="Удалить сессию"
                  aria-label="Удалить сессию"
                  onClick={() => onDelete(s.id)}
                  disabled={busy}
                >
                  <svg className="icon sm" aria-hidden="true"><use href="#i-trash" /></svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="danger-zone">
        <div>
          <div className="danger-title">Сброс статистики игры</div>
          <div className="danger-desc">Удалит все сессии и часы этой игры. Достижения останутся.</div>
        </div>
        <button type="button" className="btn btn-quiet btn-danger" onClick={onReset} disabled={busy}>
          <svg className="icon" aria-hidden="true"><use href="#i-trash" /></svg>
          Сбросить
        </button>
      </div>
    </section>
  );
}
