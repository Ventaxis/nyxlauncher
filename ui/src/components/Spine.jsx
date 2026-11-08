import { fmtHours, hueFromName, monogram } from '../format.js';

/**
 * Корешок-обложка. Карточка полки (interactive) или статичный корешок на детализации (large).
 */
export default function Spine({ game, interactive = false, large = false, enterIndex = null, onClick }) {
  const cls = [
    'spine-skin',
    large ? 'spine-lg' : 'spine-card',
    interactive ? 'spine-interactive' : '',
    game.playing ? 'is-playing' : '',
    enterIndex !== null ? 'enter' : '',
  ].filter(Boolean).join(' ');

  const Tag = interactive ? 'button' : 'div';

  return (
    <Tag
      type={interactive ? 'button' : undefined}
      className={cls}
      style={{ '--hue': hueFromName(game.name), '--i': enterIndex ?? 0 }}
      onClick={interactive ? onClick : undefined}
    >
      {game.playing && (
        <svg className="icon spine-live" aria-hidden="true"><use href="#i-moon" /></svg>
      )}
      <span className="spine-mono" aria-hidden="true">{monogram(game.name)}</span>
      <span className="spine-rule" aria-hidden="true" />
      <span className="spine-name">{game.name}</span>
      <span className="spine-hours mono">{fmtHours(game.seconds_played)}</span>
    </Tag>
  );
}
