import { useEffect, useState } from 'react';
import { fmtTimer } from '../format.js';

/** Индикатор игры в статусбаре: полумесяц + имя + таймер от начала сессии. */
export default function StatusPlay({ game, extra = 0 }) {
  // playing_since — unix-секунды старта; если ядро их не прислало
  // (демо-режим), просто считаем с нуля от монтирования.
  const start = Number.isFinite(game.playing_since) ? game.playing_since : null;
  const elapsed = () => (start == null
    ? 0
    : Math.max(0, Math.floor(Date.now() / 1000) - start));
  const [sec, setSec] = useState(elapsed);

  useEffect(() => {
    setSec(elapsed());
    const t = setInterval(() => setSec(elapsed()), 1000);
    return () => clearInterval(t);
  }, [game.id, start]);

  return (
    <span className="status-play" role="status" aria-label={`Игра идёт: ${game.name}`}>
      <svg className="icon sm status-crescent" aria-hidden="true"><use href="#i-moon" /></svg>
      <span className="status-play-name">{game.name}</span>
      {extra > 0 && <span className="status-play-name">+{extra}</span>}
      <span className="mono status-timer">{fmtTimer(sec)}</span>
    </span>
  );
}
