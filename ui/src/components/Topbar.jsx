export default function Topbar({
  query,
  onQuery,
  onAdd,
  addPrimary,
  view,
  onSettings,
  paused,
  warnings,
}) {
  const inSettings = view === 'settings';

  return (
    <header className="topbar">
      <button
        type="button"
        className="brand"
        onClick={onSettings}
        title={inSettings ? 'Назад в библиотеку' : 'NyxLauncher'}
      >
        <svg className="icon brand-icon" aria-hidden="true"><use href="#i-moon" /></svg>
        <span className="brand-name">NyxLauncher</span>
        <span className="brand-tag">Ventaxis</span>
      </button>

      {!inSettings && (
        <div className="search">
          <svg className="icon sm search-icon" aria-hidden="true"><use href="#i-search" /></svg>
          <input
            type="text"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Поиск по библиотеке"
            aria-label="Поиск по библиотеке"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      )}

      <div className="tb-right">
        {warnings && warnings.length > 0 && (
          <span className="chip chip-warn" title={warnings.join('\n')}>
            <svg className="icon sm" aria-hidden="true"><use href="#i-warning" /></svg>
            {warnings.length}
          </span>
        )}
        {paused && (
          <span className="chip chip-paused" title="Учёт времени на паузе">
            <svg className="icon sm" aria-hidden="true"><use href="#i-pause" /></svg>
            пауза
          </span>
        )}
        {!inSettings && (
          <button
            type="button"
            className={`btn ${addPrimary ? 'btn-primary' : 'btn-quiet'}`}
            onClick={onAdd}
          >
            <svg className="icon" aria-hidden="true"><use href="#i-plus" /></svg>
            Добавить игру
          </button>
        )}
        <button
          type="button"
          className={`icon-btn tb-settings${inSettings ? ' is-active' : ''}`}
          onClick={onSettings}
          title={inSettings ? 'Назад в библиотеку' : 'Настройки'}
          aria-label={inSettings ? 'Назад в библиотеку' : 'Настройки'}
        >
          <svg className="icon" aria-hidden="true"><use href={inSettings ? '#i-back' : '#i-settings'} /></svg>
        </button>
      </div>
    </header>
  );
}
