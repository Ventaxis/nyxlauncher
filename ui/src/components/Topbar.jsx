export default function Topbar({ query, onQuery, onAdd, addPrimary }) {
  return (
    <header className="topbar">
      <div className="brand">
        <svg className="icon brand-icon" aria-hidden="true"><use href="#i-moon" /></svg>
        <span>NyxLauncher</span>
      </div>
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
      <div className="tb-right">
        <button
          type="button"
          className={`btn ${addPrimary ? 'btn-primary' : 'btn-quiet'}`}
          onClick={onAdd}
        >
          <svg className="icon" aria-hidden="true"><use href="#i-plus" /></svg>
          Добавить игру
        </button>
      </div>
    </header>
  );
}
