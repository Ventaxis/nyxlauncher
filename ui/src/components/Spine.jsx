import { fmtHours, hueFromName, monogram } from '../format.js';

/**
 * Карточка игры: обложка-капсула с иконкой exe, названием и часами.
 * interactive — карточка полки, large — статичная обложка в детализации.
 */
export default function Spine({
  game,
  icon,
  interactive = false,
  large = false,
  enterIndex = null,
  onClick,
}) {
  const cls = [
    'spine-skin',
    large ? 'spine-lg' : 'spine-card',
    interactive ? 'spine-interactive' : '',
    game.playing ? 'is-playing' : '',
    enterIndex !== null ? 'enter' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const Tag = interactive ? 'button' : 'div';

  return (
    <Tag
      type={interactive ? 'button' : undefined}
      className={cls}
      style={{ '--hue': hueFromName(game.name), '--i': enterIndex ?? 0 }}
      onClick={interactive ? onClick : undefined}
      title={interactive ? game.name : undefined}
    >
      {icon && (
        <span className="spine-wash" aria-hidden="true" style={{ backgroundImage: `url(${icon})` }} />
      )}
      {game.playing && (
        <span className="spine-live">
          <svg className="icon" aria-hidden="true"><use href="#i-moon" /></svg>
          <span>идёт</span>
        </span>
      )}
      <span className="spine-art" aria-hidden="true">
        {icon ? (
          <img className="spine-icon" src={icon} alt="" draggable="false" />
        ) : (
          <span className="spine-mono">{monogram(game.name)}</span>
        )}
      </span>
      <span className="spine-rule" aria-hidden="true" />
      <span className="spine-name">{game.name}</span>
      <span className="spine-hours mono">{fmtHours(game.seconds_played)}</span>
    </Tag>
  );
}
