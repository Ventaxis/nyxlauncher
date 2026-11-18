import { fmtClock, fmtHours, hueFromName, monogram } from '../format.js';
import { liveDelta, useNow } from '../useLive.js';

/**
 * Карточка игры: обложка на всю ширину, живой счётчик с секундами,
 * быстрый запуск и подпись «почему время не идёт», если оно не идёт.
 *
 * @param {Object} props
 * @param {import('../api.js').Game} props.game
 * @param {string|null} props.icon
 * @param {number} props.receivedAt момент получения сводки (Date.now())
 * @param {number|null} props.enterIndex
 * @param {boolean} props.busy
 * @param {() => void} props.onOpen
 * @param {() => void} props.onLaunch
 */
export default function GameCard({
  game,
  icon,
  receivedAt,
  enterIndex = null,
  busy = false,
  onOpen,
  onLaunch,
}) {
  const now = useNow(Boolean(game.playing));
  const extra = liveDelta(game, receivedAt, now);
  const total = (game.seconds_played || 0) + extra;
  const today = (game.today_seconds || 0) + extra;
  // Подпись «время идёт» в карточке не нужна: это видно по счётчику.
  const problem = game.note && game.note !== 'время идёт' ? game.note : null;

  const open = () => onOpen(game.id);

  return (
    <div
      className={`card${game.playing ? ' is-playing' : ''}${enterIndex !== null ? ' enter' : ''}`}
      style={{ '--hue': hueFromName(game.name), '--i': enterIndex ?? 0 }}
      role="button"
      tabIndex={0}
      aria-label={`${game.name}, сыграно ${fmtClock(total)}`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className="card-cover">
        {icon ? (
          <>
            <img className="card-cover-blur" src={icon} alt="" aria-hidden="true" draggable="false" />
            <img className="card-cover-icon" src={icon} alt="" draggable="false" />
          </>
        ) : (
          <span className="card-cover-mono" aria-hidden="true">{monogram(game.name)}</span>
        )}
        {game.playing && (
          <span className="card-live">
            <span className="live-dot" aria-hidden="true" />
            идёт
          </span>
        )}
      </div>

      <div className="card-body">
        <div className="card-head">
          <h3 className="card-name">{game.name}</h3>
          <button
            type="button"
            className="card-play"
            onClick={(e) => {
              e.stopPropagation();
              onLaunch(game.id);
            }}
            disabled={game.playing || busy}
            title={game.playing ? 'Игра уже запущена' : `Запустить ${game.name}`}
            aria-label={game.playing ? 'Игра уже запущена' : `Запустить ${game.name}`}
          >
            <svg className="icon" aria-hidden="true"><use href={game.playing ? '#i-moon' : '#i-play'} /></svg>
          </button>
        </div>

        <div className="card-figures">
          <span className="card-clock mono">{fmtClock(total)}</span>
          <span className="card-meta mono">
            сегодня {fmtHours(today)}
            <span className="card-dot" aria-hidden="true">·</span>
            {game.sessions_count || 0} сесс.
          </span>
        </div>

        {problem && <p className="card-note">{problem}</p>}
      </div>
    </div>
  );
}
