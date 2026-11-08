/** Пустая библиотека: ночная сцена — две полки, наклонённый том, золото полумесяца. */
export default function EmptyScene({ onAdd }) {
  return (
    <section className="empty">
      <svg className="empty-scene" viewBox="0 0 480 320" role="img" aria-label="Пустые полки и полумесяц">
        {/* верхняя полка */}
        <rect x="36" y="150" width="408" height="7" rx="1.5" fill="#232327" />
        <line x1="38" y1="150.5" x2="442" y2="150.5" stroke="rgba(255,255,255,.08)" strokeWidth="1" />
        <path d="M52 157v10M428 157v10" stroke="#2c2c31" strokeWidth="3" />

        {/* корешки, верхняя полка */}
        <rect x="58" y="76" width="20" height="74" rx="1.5" fill="hsl(214 18% 24%)" stroke="rgba(255,255,255,.06)" strokeWidth="0.5" />
        <path d="M61 88h14M61 92h14" stroke="hsl(214 25% 42%)" strokeWidth="1" />
        <rect x="82" y="90" width="16" height="60" rx="1.5" fill="hsl(28 22% 27%)" stroke="rgba(255,255,255,.06)" strokeWidth="0.5" />
        <rect x="102" y="82" width="22" height="68" rx="1.5" fill="hsl(150 12% 25%)" stroke="rgba(255,255,255,.06)" strokeWidth="0.5" />
        <path d="M105 94h16" stroke="hsl(150 16% 40%)" strokeWidth="1" />
        <rect x="128" y="96" width="14" height="54" rx="1.5" fill="hsl(46 20% 28%)" stroke="rgba(255,255,255,.06)" strokeWidth="0.5" />
        <rect x="146" y="86" width="18" height="64" rx="1.5" fill="hsl(96 10% 27%)" stroke="rgba(255,255,255,.06)" strokeWidth="0.5" transform="rotate(9 164 150)" />
        <rect x="172" y="88" width="18" height="62" rx="1.5" fill="hsl(190 14% 26%)" stroke="rgba(255,255,255,.06)" strokeWidth="0.5" />

        {/* стопка плашмя, справа */}
        <rect x="330" y="139" width="88" height="11" rx="2" fill="hsl(0 0% 30%)" stroke="rgba(255,255,255,.06)" strokeWidth="0.5" />
        <rect x="338" y="128" width="70" height="11" rx="2" fill="hsl(214 16% 24%)" stroke="rgba(255,255,255,.06)" strokeWidth="0.5" />
        <rect x="346" y="119" width="52" height="9" rx="2" fill="hsl(46 18% 27%)" stroke="rgba(255,255,255,.06)" strokeWidth="0.5" />

        {/* полумесяц и звёзды */}
        <path
          d="M14.25 2.55A9.75 9.75 0 1 0 21.45 9.75 7.5 7.5 0 0 1 14.25 2.55Z"
          fill="#d9a441"
          opacity="0.92"
          transform="translate(268 30) scale(2.4) rotate(-24 12 12)"
        />
        <circle cx="376" cy="40" r="1.6" fill="#6d6b76" />
        <circle cx="398" cy="72" r="1.2" fill="#6d6b76" />
        <circle cx="330" cy="100" r="1.1" fill="#6d6b76" />
        <circle cx="404" cy="30" r="1.2" fill="#6d6b76" />
        <circle cx="366" cy="92" r="1.3" fill="#d9a441" opacity="0.8" />
        <circle cx="210" cy="205" r="1" fill="#6d6b76" opacity="0.7" />
        <circle cx="238" cy="190" r="1.4" fill="#6d6b76" opacity="0.55" />
        <circle cx="266" cy="176" r="1" fill="#6d6b76" opacity="0.4" />

        {/* нижняя полка */}
        <rect x="36" y="262" width="408" height="7" rx="1.5" fill="#232327" />
        <line x1="38" y1="262.5" x2="442" y2="262.5" stroke="rgba(255,255,255,.08)" strokeWidth="1" />
        <path d="M52 269v10M428 269v10" stroke="#2c2c31" strokeWidth="3" />

        {/* корешки, нижняя полка */}
        <rect x="70" y="204" width="16" height="58" rx="1.5" fill="hsl(0 16% 26%)" stroke="rgba(255,255,255,.06)" strokeWidth="0.5" />
        <rect x="90" y="196" width="22" height="66" rx="1.5" fill="hsl(214 16% 24%)" stroke="rgba(255,255,255,.06)" strokeWidth="0.5" />
        <path d="M93 208h16" stroke="hsl(214 22% 40%)" strokeWidth="1" />
        <rect x="116" y="210" width="14" height="52" rx="1.5" fill="hsl(28 20% 27%)" stroke="rgba(255,255,255,.06)" strokeWidth="0.5" />
        <rect x="134" y="200" width="18" height="62" rx="1.5" fill="hsl(150 12% 25%)" stroke="rgba(255,255,255,.06)" strokeWidth="0.5" transform="rotate(-9 134 262)" />

        {/* стопка посередине */}
        <rect x="240" y="251" width="70" height="11" rx="2" fill="hsl(46 18% 27%)" stroke="rgba(255,255,255,.06)" strokeWidth="0.5" />
        <rect x="248" y="241" width="54" height="10" rx="2" fill="hsl(0 0% 30%)" stroke="rgba(255,255,255,.06)" strokeWidth="0.5" />

        {/* правая пара на нижней полке */}
        <rect x="350" y="206" width="18" height="56" rx="1.5" fill="hsl(190 14% 26%)" stroke="rgba(255,255,255,.06)" strokeWidth="0.5" />
        <rect x="372" y="212" width="14" height="50" rx="1.5" fill="hsl(96 10% 27%)" stroke="rgba(255,255,255,.06)" strokeWidth="0.5" />
      </svg>

      <h2>Библиотека пуста</h2>
      <p>
        Добавьте первый exe — Nyx начнёт считать часы, строить график недели
        и выдаст первые ачивки.
      </p>
      <button type="button" className="btn btn-primary" onClick={onAdd}>
        <svg className="icon" aria-hidden="true"><use href="#i-plus" /></svg>
        Добавить игру
      </button>
    </section>
  );
}
