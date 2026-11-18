import { useEffect, useState } from 'react';

/**
 * Живые секунды: раз в секунду обновляем текущее время.
 *
 * @param {boolean} active — тикать только когда есть что показывать
 *   (в покое экран не должен перерисовываться каждую секунду).
 * @returns {number} Date.now() в миллисекундах
 */
export function useNow(active = true) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return undefined;
    // Подтягиваем время сразу: между ответом ядра и первым тиком
    // не должно быть секунды с заниженным счётчиком.
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  return now;
}

/**
 * Секунды, которые добавились с момента снимка сводки.
 *
 * Сводка приходит с уже включённой текущей сессией, поэтому к ней
 * прибавляется только время, прошедшее после получения снимка.
 *
 * @param {{playing?: boolean, playing_since?: number|null}} game
 * @param {number} receivedAt — Date.now() в момент получения сводки
 * @param {number} now — Date.now() сейчас
 * @returns {number}
 */
export function liveDelta(game, receivedAt, now) {
  if (!game || !game.playing) return 0;
  if (!Number.isFinite(receivedAt)) return 0;
  return Math.max(0, Math.floor((now - receivedAt) / 1000));
}
