// Обёртки над ядром NyxLauncher (Tauri 2, withGlobalTauri).
// Вне Tauri (обычный браузер) те же функции работают с демо-данными,
// чтобы интерфейс можно было смотреть без ядра.

const TAU = typeof window !== 'undefined' ? window.__TAURI__ : undefined;

/** Есть ли живое ядро под рукой. */
export const hasTauri = Boolean(TAU && TAU.core && typeof TAU.core.invoke === 'function');

/**
 * @typedef {Object} Game
 * @property {string} id
 * @property {string} name
 * @property {string} exe_path
 * @property {number} seconds_played
 * @property {string|null} last_played RFC3339
 * @property {boolean} playing
 * @property {number|null} playing_since Unix-секунды начала текущей сессии
 */

/**
 * @typedef {Object} WeekDay
 * @property {string} date 'YYYY-MM-DD'
 * @property {number} seconds
 */

/**
 * @typedef {Object} Totals
 * @property {number} seconds
 * @property {WeekDay[]} week 7 дней, старые → сегодня
 * @property {number} streak_days
 * @property {number} longest_session_seconds
 * @property {number} sessions_count
 */

/**
 * @typedef {Object} Achievement
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} icon
 * @property {boolean} unlocked
 * @property {string|null} unlocked_at RFC3339
 * @property {number} progress 0..1
 */

/**
 * @typedef {Object} Summary
 * @property {Game[]} games
 * @property {Totals} totals
 * @property {Achievement[]} achievements
 */

/**
 * @typedef {Object} GameStats
 * @property {number} total_seconds
 * @property {number} today_seconds
 * @property {number} longest_session_seconds
 * @property {string|null} last_played
 * @property {number} sessions_count
 * @property {WeekDay[]} week 7 дней, старые → сегодня
 */

function core() {
  return window.__TAURI__.core;
}

/** @returns {Promise<Summary>} */
export async function getSummary() {
  if (hasTauri) return core().invoke('get_summary');
  return demoSummary();
}

/** @returns {Promise<GameStats>} */
export async function getGameStats(id) {
  if (hasTauri) return core().invoke('get_game_stats', { id });
  return demoStats(id);
}

/** @param {string} exePath @returns {Promise<Game>} */
export async function addGame(exePath) {
  if (hasTauri) return core().invoke('add_game', { exePath });
  return demoAdd();
}

/** @returns {Promise<void>} */
export async function removeGame(id) {
  if (hasTauri) return core().invoke('remove_game', { id });
  return demoRemove(id);
}

/** @returns {Promise<void>} */
export async function launchGame(id) {
  if (hasTauri) return core().invoke('launch_game', { id });
  return demoLaunch(id);
}

/** Диалог выбора exe. Без ядра возвращает null. @returns {Promise<string|null>} */
export async function openExeDialog() {
  if (!hasTauri) return null;
  if (!TAU.dialog || typeof TAU.dialog.open !== 'function') {
    throw new Error('Диалог выбора файла недоступен: плагин dialog не загружен');
  }
  return TAU.dialog.open({
    multiple: false,
    filters: [{ name: 'Игры', extensions: ['exe'] }],
  });
}

/**
 * Подписка на library-changed. Возвращает функцию отписки.
 * @param {() => void} cb
 * @returns {() => void}
 */
export function onLibraryChanged(cb) {
  if (hasTauri && TAU.event && TAU.event.listen) {
    let disposed = false;
    let unlisten = null;
    TAU.event.listen('library-changed', cb).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    }).catch((e) => {
      console.error('nyx: не удалось подписаться на library-changed', e);
    });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }
  demoListeners.add(cb);
  return () => demoListeners.delete(cb);
}

// ---------------------------------------------------------------------------
// Демо-режим: предпросмотр в браузере, без ядра.
// ---------------------------------------------------------------------------

const demoListeners = new Set();
function emitDemo() {
  for (const fn of demoListeners) fn();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dateStr(offset) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isoAt(daysAgo, h, m) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 12, 0);
  return d.toISOString();
}

function week7(vals) {
  return vals.map((seconds, i) => ({ date: dateStr(6 - i), seconds }));
}

function demoGame(id, name, seconds, last, playing, week, longest, sessions) {
  return {
    id,
    name,
    exe_path: `C:\\Games\\${name}\\game.exe`,
    seconds_played: seconds,
    last_played: last,
    playing,
    playing_since: playing ? Math.floor(Date.now() / 1000) - 754 : null,
    _week: week,
    _longest: longest,
    _sessions: sessions,
  };
}

const demo = {
  streak: 2,
  longest: 9000,
  sessions: 57,
  games: [
    demoGame('g1', 'Hollow Circuit', 457200, isoAt(0, 22, 41), true, [1200, 4800, 0, 6600, 900, 8400, 5400], 9000, 84),
    demoGame('g2', 'Тихая станция', 266400, isoAt(1, 23, 5), false, [0, 0, 2700, 0, 3600, 1800, 1200], 8400, 61),
    demoGame('g3', 'Midnight Gardener', 147600, isoAt(2, 21, 12), false, [5400, 0, 0, 1800, 0, 0, 600], 7200, 44),
    demoGame('g4', 'Paper Kingdoms', 79200, isoAt(5, 20, 40), false, [600, 900, 0, 1200, 300, 0, 0], 5400, 35),
    demoGame('g5', 'Static Bloom', 43200, isoAt(0, 19, 3), false, [0, 0, 1800, 0, 0, 900, 0], 3600, 19),
    demoGame('g6', 'Long Way North', 28800, isoAt(4, 20, 15), false, [300, 0, 0, 0, 600, 0, 300], 3000, 14),
    demoGame('g7', 'Night Bus 84', 10800, isoAt(9, 23, 47), false, [0, 600, 0, 0, 0, 0, 0], 1800, 7),
    demoGame('g8', 'Drift Kites', 2700, isoAt(16, 21, 26), false, [0, 0, 300, 0, 0, 0, 0], 1500, 3),
  ],
  achievements: [
    { id: 'first_launch', title: 'Первый запуск', description: 'Запустить любую игру из библиотеки', icon: 'play', unlocked: true, unlocked_at: isoAt(21, 22, 5), progress: 1 },
    { id: 'hour_of_moon', title: 'Час луны', description: 'Наиграть один час суммарно', icon: 'clock', unlocked: true, unlocked_at: isoAt(19, 23, 41), progress: 1 },
    { id: 'ten_hours', title: 'Десяточка', description: 'Наиграть десять часов суммарно', icon: 'clock', unlocked: true, unlocked_at: isoAt(12, 1, 15), progress: 1 },
    { id: 'hundred_hours', title: 'Сотня', description: 'Наиграть сто часов суммарно', icon: 'trophy', unlocked: true, unlocked_at: isoAt(3, 20, 2), progress: 1 },
    { id: 'night_shift', title: 'Ночная смена', description: 'Начать сессию между полночью и пятью утра', icon: 'moon', unlocked: true, unlocked_at: isoAt(6, 2, 47), progress: 1 },
    { id: 'marathon', title: 'Марафонец', description: 'Провести одну сессию дольше трёх часов', icon: 'flame', unlocked: false, unlocked_at: null, progress: 0.83 },
    { id: 'collector', title: 'Коллекционер', description: 'Собрать пять игр в библиотеке', icon: 'archive', unlocked: true, unlocked_at: isoAt(1, 21, 3), progress: 1 },
    { id: 'explorer', title: 'Исследователь', description: 'Поиграть в три разные игры', icon: 'compass', unlocked: true, unlocked_at: isoAt(9, 23, 58), progress: 1 },
    { id: 'persistence', title: 'Постоянство', description: 'Играть три дня подряд', icon: 'calendar', unlocked: false, unlocked_at: null, progress: 0.67 },
    { id: 'week_streak', title: 'Неделя в игре', description: 'Играть семь дней подряд', icon: 'calendar', unlocked: false, unlocked_at: null, progress: 0.29 },
  ],
};

function demoSummary() {
  const games = demo.games.map(({ _week, _longest, _sessions, ...g }) => g);
  const week = Array.from({ length: 7 }, (_, i) => ({
    date: dateStr(6 - i),
    seconds: demo.games.reduce((s, g) => s + ((g._week && g._week[i]) || 0), 0),
  }));
  const seconds = games.reduce((s, g) => s + g.seconds_played, 0);
  return {
    games,
    totals: {
      seconds,
      week,
      streak_days: demo.streak,
      longest_session_seconds: demo.longest,
      sessions_count: demo.sessions,
    },
    achievements: demo.achievements.map((a) => ({ ...a })),
  };
}

function demoStats(id) {
  const g = demo.games.find((x) => x.id === id);
  if (!g) throw new Error('Игра не найдена');
  return {
    total_seconds: g.seconds_played,
    today_seconds: g._week ? g._week[6] : 0,
    longest_session_seconds: g._longest || 0,
    last_played: g.last_played,
    sessions_count: g._sessions || 0,
    week: week7(g._week || [0, 0, 0, 0, 0, 0, 0]),
  };
}

const DEMO_POOL = ['Neon Harvest', 'Winterfold', 'Кассета 404', 'Salt & Signal', 'Оранжевый горизонт'];
let demoAdds = 0;

function demoAdd() {
  const name = DEMO_POOL[demoAdds % DEMO_POOL.length];
  demoAdds += 1;
  const game = demoGame(
    `demo-${Date.now()}`,
    name,
    0,
    null,
    false,
    [0, 0, 0, 0, 0, 0, 0],
    0,
    0,
  );
  game.exe_path = `C:\\Games\\${name}\\launch.exe`;
  demo.games.push(game);
  emitDemo();
  const { _week, _longest, _sessions, ...view } = game;
  return { ...view };
}

function demoRemove(id) {
  const before = demo.games.length;
  demo.games = demo.games.filter((g) => g.id !== id);
  if (demo.games.length === before) throw new Error('Игра не найдена');
  emitDemo();
}

function demoLaunch(id) {
  const g = demo.games.find((x) => x.id === id);
  if (!g) throw new Error('Игра не найдена');
  const next = !g.playing;
  for (const x of demo.games) {
    x.playing = false;
    x.playing_since = null;
  }
  g.playing = next;
  if (next) {
    g.last_played = new Date().toISOString();
    g.playing_since = Math.floor(Date.now() / 1000);
  }
  emitDemo();
}

// Живой предпросмотр: пока в демо кто-то «играет», часы растут каждые 5 секунд.
if (!hasTauri) {
  setInterval(() => {
    const g = demo.games.find((x) => x.playing);
    if (!g) return;
    g.seconds_played += 5;
    if (g._week) g._week[6] += 5;
    emitDemo();
  }, 5000);
}
