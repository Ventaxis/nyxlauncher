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
 * @property {string} args
 * @property {string|null} work_dir
 * @property {string|null} exe_hash
 * @property {number} added_at Unix-секунды
 * @property {boolean} playing
 * @property {number|null} playing_since Unix-секунды начала текущей сессии
 * @property {string|null} note почему время идёт или не идёт
 * @property {number} today_seconds
 * @property {number} week_seconds
 * @property {number} sessions_count
 */

/**
 * @typedef {Object} WeekDay
 * @property {string} date 'YYYY-MM-DD'
 * @property {number} seconds
 */

/**
 * @typedef {Object} Totals
 * @property {number} seconds
 * @property {number} today_seconds
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
 * @property {boolean} tracker_paused
 * @property {string[]} warnings
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

/**
 * @typedef {Object} Settings
 * @property {boolean} autostart
 * @property {boolean} start_minimized
 * @property {boolean} close_to_tray
 * @property {boolean} minimize_to_tray
 * @property {boolean} minimize_on_launch
 * @property {boolean} show_icons
 * @property {string} theme graphite | midnight | oled
 * @property {boolean} reduce_motion
 * @property {string} sort_mode recent | name | hours | added
 * @property {boolean} tracker_paused
 * @property {number} min_session_secs
 * @property {boolean} require_window
 * @property {boolean} strict_anticheat
 * @property {boolean} count_direct_launch
 * @property {number} poll_secs
 * @property {number} schema
 */

/**
 * @typedef {Object} SettingsView
 * @property {Settings} settings
 * @property {boolean} autostart_enabled
 * @property {string} data_dir
 * @property {string} version
 * @property {string} install_id
 * @property {string[]} tampered
 * @property {boolean} clock_rollback
 */

/**
 * @typedef {Object} Session
 * @property {string} id
 * @property {string} game_id
 * @property {number} start Unix-секунды
 * @property {number} end Unix-секунды
 * @property {number} seconds
 * @property {boolean} manual
 * @property {boolean} active
 */

/**
 * Запись журнала учёта: почему время не шло.
 * @typedef {Object} JournalEntry
 * @property {number} at Unix-секунды
 * @property {string} game_id
 * @property {string} name
 * @property {string} note
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

/**
 * Название, аргументы и рабочая папка.
 * @param {{id: string, name: string, args: string, workDir: string}} p
 * @returns {Promise<Game>}
 */
export async function updateGame({ id, name, args, workDir }) {
  if (hasTauri) return core().invoke('update_game', { id, name, args, workDir });
  return demoUpdate({ id, name, args, workDir });
}

/** Перепроверить exe и хеш (после обновления игры). @returns {Promise<Game>} */
export async function refreshExe(id) {
  if (hasTauri) return core().invoke('refresh_exe', { id });
  return demoRefresh(id);
}

/** @returns {Promise<SettingsView>} */
export async function getSettings() {
  if (hasTauri) return core().invoke('get_settings');
  return demoSettingsView();
}

/** @param {Settings} next @returns {Promise<SettingsView>} */
export async function setSettings(next) {
  if (hasTauri) return core().invoke('set_settings', { next });
  return demoSaveSettings(next);
}

/** Иконки exe: id → data:URL. @returns {Promise<Record<string,string>>} */
/** @returns {Promise<Record<string, string>>} id игры → data-URI иконки */
export async function getIcons() {
  if (hasTauri) return core().invoke('get_icons');
  const out = {};
  for (const g of demo.games) out[g.id] = demoIcon(g.name);
  return out;
}

/** @returns {Promise<Session[]>} */
export async function getSessions(id) {
  if (hasTauri) return core().invoke('get_sessions', { id });
  return demoSessionsFor(id).map((s) => ({ ...s }));
}

/** Журнал отказов учёта: все записи или только по одной игре. Новые первыми.
 * @param {string|null} [id] @returns {Promise<JournalEntry[]>} */
export async function getJournal(id = null) {
  if (hasTauri) return core().invoke('get_journal', { id });
  return demoJournal.filter((e) => !id || e.game_id === id).map((e) => ({ ...e }));
}

/** @param {{id: string, start: string, minutes: number}} p @returns {Promise<Session>} */
export async function addManualSession({ id, start, minutes }) {
  if (hasTauri) return core().invoke('add_manual_session', { id, start, minutes });
  return demoAddSession({ id, start, minutes });
}

/** @returns {Promise<void>} */
export async function deleteSession(id) {
  if (hasTauri) return core().invoke('delete_session', { id });
  demoDeleteSession(id);
}

/** Сброс статистики одной игры (id) или всей библиотеки (null). @returns {Promise<void>} */
export async function resetStats(id = null) {
  if (hasTauri) return core().invoke('reset_stats', { id });
  demoResetStats(id);
}

/** @returns {Promise<string>} */
export async function exportData(path) {
  if (hasTauri) return core().invoke('export_data', { path });
  return path;
}

/** @returns {Promise<string>} */
export async function importData(path) {
  if (hasTauri) return core().invoke('import_data', { path });
  throw new Error('Импорт доступен только в приложении: подпись привязана к установке.');
}

/** @returns {Promise<void>} */
export async function openDataDir() {
  if (hasTauri) return core().invoke('open_data_dir');
  throw new Error('Папка данных доступна только в приложении.');
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

/** Куда сохранить резервную копию. @returns {Promise<string|null>} */
export async function saveBackupDialog() {
  if (!hasTauri) return 'C:\\Users\\demo\\nyx-backup.json';
  if (!TAU.dialog || typeof TAU.dialog.save !== 'function') {
    throw new Error('Диалог сохранения недоступен: плагин dialog не загружен');
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return TAU.dialog.save({
    defaultPath: `nyx-backup-${stamp}.json`,
    filters: [{ name: 'Резервная копия NyxLauncher', extensions: ['json'] }],
  });
}

/** Откуда восстановить копию. @returns {Promise<string|null>} */
export async function openBackupDialog() {
  if (!hasTauri) return null;
  if (!TAU.dialog || typeof TAU.dialog.open !== 'function') {
    throw new Error('Диалог выбора файла недоступен: плагин dialog не загружен');
  }
  return TAU.dialog.open({
    multiple: false,
    filters: [{ name: 'Резервная копия NyxLauncher', extensions: ['json'] }],
  });
}

function listen(event, cb) {
  if (hasTauri && TAU.event && TAU.event.listen) {
    let disposed = false;
    let unlisten = null;
    TAU.event
      .listen(event, cb)
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((e) => {
        console.error(`nyx: не удалось подписаться на ${event}`, e);
      });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }
  if (event === 'library-changed') {
    demoLibraryListeners.add(cb);
    return () => demoLibraryListeners.delete(cb);
  }
  demoSettingsListeners.add(cb);
  return () => demoSettingsListeners.delete(cb);
}

/**
 * Подписка на library-changed. Возвращает функцию отписки.
 * @param {() => void} cb
 * @returns {() => void}
 */
export function onLibraryChanged(cb) {
  return listen('library-changed', cb);
}

/**
 * Подписка на settings-changed. Возвращает функцию отписки.
 * @param {(s: Settings) => void} cb
 * @returns {() => void}
 */
export function onSettingsChanged(cb) {
  return listen('settings-changed', cb);
}

// ---------------------------------------------------------------------------
// Демо-режим: предпросмотр в браузере, без ядра.
// ---------------------------------------------------------------------------

const demoLibraryListeners = new Set();
const demoSettingsListeners = new Set();

function emitDemo() {
  for (const fn of demoLibraryListeners) fn();
}

function emitDemoSettings(next) {
  for (const fn of demoSettingsListeners) fn(next);
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

// Псевдохеш для демо-библиотеки: стабильный, 64 hex-символа, как SHA-256.
function demoHash(name) {
  let acc = 0x811c9dc5;
  for (let i = 0; i < name.length; i += 1) {
    acc = (acc ^ name.charCodeAt(i)) >>> 0;
    acc = Math.imul(acc, 0x01000193) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 64; i += 1) {
    acc = Math.imul(acc ^ i, 0x01000193) >>> 0;
    out += '0123456789abcdef'[(acc >>> 24) & 0xf];
  }
  return out;
}

/** Hue из имени — тот же принцип, что и в обложках интерфейса. */
function demoHue(name) {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  let hue = h % 360;
  if (hue > 240 && hue < 320) hue = 200 + (hue - 240) / 2;
  return Math.round(hue);
}

/**
 * Демо-иконка: серп и звезда в цвете имени.
 * Нужна, чтобы предпросмотр без ядра выглядел как настоящая библиотека.
 */
function demoIcon(name) {
  const hue = demoHue(name);
  const letters = String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<rect width="128" height="128" rx="26" fill="hsl(${hue} 24% 15%)"/>
<circle cx="64" cy="64" r="40" fill="none" stroke="hsl(${hue} 45% 64% / 0.28)" stroke-width="2"/>
<text x="64" y="78" font-family="Cascadia Mono, Consolas, monospace" font-size="40" font-weight="600" text-anchor="middle" fill="hsl(${hue} 46% 72%)">${letters}</text>
<circle cx="98" cy="30" r="3.4" fill="hsl(${hue} 60% 76%)"/>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function demoGame(id, name, seconds, last, playing, week, longest, sessions) {  const folder = name.replace(/[^\p{L}\p{N}]+/gu, '');
  return {
    id,
    name,
    exe_path: `D:\\Games\\${name}\\${folder}.exe`,
    seconds_played: seconds,
    last_played: last,
    args: '',
    work_dir: null,
    exe_hash: demoHash(name),
    added_at: Math.floor(new Date(isoAt(20, 12, 0)).getTime() / 1000),
    playing,
    playing_since: playing ? Math.floor(Date.now() / 1000) - 754 : null,
    note: playing ? 'время идёт' : null,
    today_seconds: week[6] || 0,
    week_seconds: week.reduce((s, v) => s + v, 0),
    sessions_count: sessions,
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
      today_seconds: week[6].seconds,
      week,
      streak_days: demo.streak,
      longest_session_seconds: demo.longest,
      sessions_count: demo.sessions,
    },
    achievements: demo.achievements.map((a) => ({ ...a })),
    tracker_paused: demoSettings.tracker_paused,
    warnings: [],
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
  game.added_at = Math.floor(Date.now() / 1000);
  demo.games.push(game);
  emitDemo();
  const { _week, _longest, _sessions, ...view } = game;
  return { ...view };
}

function demoRemove(id) {
  const before = demo.games.length;
  demo.games = demo.games.filter((g) => g.id !== id);
  if (demo.games.length === before) throw new Error('Игра не найдена');
  demoSessions.delete(id);
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

function demoUpdate({ id, name, args, workDir }) {
  const g = demo.games.find((x) => x.id === id);
  if (!g) throw new Error('Игра не найдена');
  if (!String(name || '').trim()) throw new Error('Название не может быть пустым');
  g.name = String(name).trim();
  g.args = String(args || '').trim();
  g.work_dir = String(workDir || '').trim() || null;
  emitDemo();
  const { _week, _longest, _sessions, ...view } = g;
  return { ...view };
}

function demoRefresh(id) {
  const g = demo.games.find((x) => x.id === id);
  if (!g) throw new Error('Игра не найдена');
  g.exe_hash = demoHash(`${g.name}:${Date.now()}`);
  emitDemo();
  const { _week, _longest, _sessions, ...view } = g;
  return { ...view };
}

// ── демо-настройки ─────────────────────────────────────────────────────────

let demoSettings = {
  autostart: false,
  start_minimized: false,
  close_to_tray: true,
  minimize_to_tray: false,
  minimize_on_launch: false,
  show_icons: true,
  theme: 'graphite',
  reduce_motion: false,
  sort_mode: 'recent',
  tracker_paused: false,
  min_session_secs: 5,
  require_window: true,
  strict_anticheat: false,
  count_direct_launch: true,
  poll_secs: 2,
  schema: 1,
};

function demoSettingsView() {
  return {
    settings: { ...demoSettings },
    autostart_enabled: demoSettings.autostart,
    data_dir: 'C:\\Users\\demo\\AppData\\Roaming\\corp.ventaxis.nyxlauncher',
    version: 'demo',
    install_id: 'demo-install',
    tampered: [],
    clock_rollback: false,
  };
}

function demoSaveSettings(next) {
  demoSettings = { ...demoSettings, ...next };
  emitDemoSettings({ ...demoSettings });
  emitDemo();
  return demoSettingsView();
}

// ── демо-журнал учёта ─────────────────────────────────────────────────────

const demoJournal = [
  {
    at: Math.floor(new Date(isoAt(1, 21, 4)).getTime() / 1000),
    game_id: 'g2',
    name: 'Тихая станция',
    note: 'файл игры изменился после добавления — нажмите «Обновить exe»',
  },
  {
    at: Math.floor(new Date(isoAt(2, 22, 47)).getTime() / 1000),
    game_id: 'g5',
    name: 'Static Bloom',
    note: 'у игры нет контрольной суммы — нажмите «Обновить exe»',
  },
  {
    at: Math.floor(new Date(isoAt(6, 20, 12)).getTime() / 1000),
    game_id: 'g4',
    name: 'Paper Kingdoms',
    note: 'у процесса нет видимого окна',
  },
];

// ── демо-история сессий ────────────────────────────────────────────────────

const demoSessions = new Map();

function demoSessionsFor(id) {
  if (!demoSessions.has(id)) {
    const g = demo.games.find((x) => x.id === id);
    const count = Math.min(12, Math.max(2, Math.round(((g && g._sessions) || 4) / 5)));
    const list = [];
    let day = 1;
    for (let i = 0; i < count; i += 1) {
      day += 1 + (i % 3);
      const mins = 28 + ((i * 37) % 190);
      const end = Math.floor(new Date(isoAt(day, 20 + (i % 3), 10)).getTime() / 1000);
      list.push({
        id: `dm_${id}_${i}`,
        game_id: id,
        start: end - mins * 60,
        end,
        seconds: mins * 60,
        manual: i === 3,
        active: false,
      });
    }
    if (g && g.playing) {
      list.unshift({
        id: `active_${id}`,
        game_id: id,
        start: Math.floor(Date.now() / 1000) - 754,
        end: Math.floor(Date.now() / 1000),
        seconds: 754,
        manual: false,
        active: true,
      });
    }
    demoSessions.set(id, list);
  }
  return demoSessions.get(id);
}

function parseLocalInput(s) {
  // <input type="datetime-local"> → "YYYY-MM-DDTHH:MM"
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m) throw new Error('Некорректная дата/время');
  return Math.floor(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0).getTime() / 1000);
}

function demoAddSession({ id, start, minutes }) {
  const list = demoSessionsFor(id);
  const startTs = parseLocalInput(start);
  const now = Math.floor(Date.now() / 1000);
  if (startTs > now + 300) throw new Error('Нельзя добавить сессию в будущем');
  const end = Math.min(startTs + minutes * 60, now);
  if (end <= startTs) throw new Error('Сессия должна заканчиваться в прошлом');
  const s = {
    id: `m_${Date.now()}`,
    game_id: id,
    start: startTs,
    end,
    seconds: end - startTs,
    manual: true,
    active: false,
  };
  list.unshift(s);
  const g = demo.games.find((x) => x.id === id);
  if (g) g.seconds_played += s.seconds;
  emitDemo();
  return { ...s };
}

function demoDeleteSession(id) {
  let found = false;
  for (const [key, list] of demoSessions) {
    const next = list.filter((s) => s.id !== id);
    if (next.length !== list.length) {
      found = true;
      const removed = list.find((s) => s.id === id);
      const g = demo.games.find((x) => x.id === key);
      if (g && removed && !removed.active) {
        g.seconds_played = Math.max(0, g.seconds_played - removed.seconds);
      }
      demoSessions.set(key, next);
    }
  }
  if (!found) throw new Error('Сессия не найдена');
  emitDemo();
}

function demoResetStats(id) {
  if (id) {
    demoSessions.delete(id);
    const g = demo.games.find((x) => x.id === id);
    if (g) {
      g.seconds_played = 0;
      g.last_played = null;
      g._week = [0, 0, 0, 0, 0, 0, 0];
    }
  } else {
    demoSessions.clear();
    for (const g of demo.games) {
      g.seconds_played = 0;
      g.last_played = null;
      g._week = [0, 0, 0, 0, 0, 0, 0];
    }
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
