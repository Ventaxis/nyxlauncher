import { useEffect, useState } from 'react';
import { fmtTimer } from '../format.js';

/** Индикатор игры в статусбаре: полумесяц + имя + локальный таймер сессии. */
export default function StatusPlay({ game }) {
  const [sec, setSec] = useState(0);

  useEffect(() => {
    setSec(0);
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [game.id]);

  return (
    <span className="status-play" role="status" aria-label={`Игра идёт: ${game.name}`}>
      <svg className="icon sm status-crescent" aria-hidden="true"><use href="#i-moon" /></svg>
      <span className="status-play-name">{game.name}</span>
      <span className="mono status-timer">{fmtTimer(sec)}</span>
    </span>
  );
}
