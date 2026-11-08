'use strict';

/* NyxLauncher — интерфейс библиотеки.
   Контракт с ядром (withGlobalTauri):
     invoke('get_summary')            -> { games, totals, achievements }
     invoke('add_game',  { exePath }) -> Game | Error-строка
     invoke('remove_game', { id })
     invoke('launch_game', { id })
     invoke('get_game_stats', { id }) -> { total_seconds, today_seconds, ... , week[7] }
     событие 'library-changed'        -> перезапрос summary (выбор и поиск сохраняются)
   Без ядра (открыто в обычном браузере) — тихий предпросмотр на демо-данных. */

const T = window.__TAURI__ || null;
const invoke = T ? T.core.invoke.bind(T.core) : null;

const BASE_STATUS = 'NyxLauncher 0.2';

let summary = { games: [], totals: null, achievements: [] };
let stats = null;            // ответ get_game_stats выбранной игры
let selectedId = null;
let query = '';
let view = 'grid';           // 'grid' — витрина библиотеки, 'detail' — страница игры

// Локальная интерполяция сессии: сервер — истина по факту playing,
// таймер просто отсчитывает время с момента, когда playing появился
let playingId = null;
let sessionStart = 0;

const $ = (id) => document.getElementById(id);
const els = {
  search: $('search'),
  add: $('btn-add'),
  list: $('game-list'),
  sideCount: $('side-count'),
  totalHours: $('total-hours'),
  footStreak: $('foot-streak'),
  streakVal: $('streak-val'),
  empty: $('empty'),
  emptyAdd: $('btn-empty-add'),
  grid: $('grid'),
  back: $('btn-back'),
  detail: $('detail'),
  title: $('game-title'),
  hoursNum: $('game-hours'),
  last: $('game-last'),
  play: $('btn-play'),
  remove: $('btn-remove'),
  cover: $('cover'),
  coverLetter: $('cover-letter'),
  coverName: $('cover-name'),
  coverExe: $('cover-exe'),
  statToday: $('stat-today'),
  statWeek: $('stat-week'),
  statRecord: $('stat-record'),
  chartWrap: $('chart-wrap'),
  chart: $('chart'),
  achCount: $('ach-count'),
  achGrid: $('ach-grid'),
  statusLeft: $('status-left'),
  statusPlay: $('status-play'),
  spName: $('sp-name'),
  spTimer: $('sp-timer'),
};

const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/* ── Форматы: числа, длительности, даты — моно, запятая ─────────── */

function fmtHours(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  if (sec < 3600) return `${Math.round(sec / 60)} мин`;
  return `${(sec / 3600).toFixed(1).replace('.', ',')} ч`;
}

function fmtTimer(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

function fmtNum(n) {
  n = Number(n) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}

/* Оттенок корешка: детерминированно из имени, золотое сечение по кругу */
function hueOf(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return (h * 137.508) % 360;
}

/* ── Статусбар ──────────────────────────────────────────────────── */

let statusResetTimer = 0;

function say(msg) {
  clearTimeout(statusResetTimer);
  els.statusLeft.textContent = String(msg);
  els.statusLeft.classList.add('is-msg');
  statusResetTimer = setTimeout(() => {
    els.statusLeft.textContent = BASE_STATUS;
    els.statusLeft.classList.remove('is-msg');
  }, 6000);
}

/* ── Выборка ────────────────────────────────────────────────────── */

function currentGame() {
  return summary.games.find((g) => g.id === selectedId) || null;
}

function visibleGames() {
  const q = query.trim().toLowerCase();
  if (!q) return summary.games;
  return summary.games.filter((g) => g.name.toLowerCase().includes(q));
}

/* ── Рендер ─────────────────────────────────────────────────────── */

function render() {
  renderSidebar();
  const g = currentGame();
  const showDetail = Boolean(g) && view === 'detail';
  els.empty.hidden = summary.games.length > 0;
  els.detail.hidden = !showDetail;
  els.grid.hidden = showDetail || summary.games.length === 0;
  if (showDetail) {
    renderDetail(g, stats);
  } else {
    renderGrid();
  }
  renderStatusPlay();
}

/* ── Витрина: сетка корешков ────────────────────────────────────── */

function renderGrid() {
  els.grid.textContent = '';
  const shown = visibleGames();

  if (!shown.length) {
    const note = document.createElement('p');
    note.className = 'grid-note';
    note.textContent = query.trim() ? 'Ничего не найдено' : 'Добавьте игры — они появятся корешками на полке';
    els.grid.appendChild(note);
    return;
  }

  for (const g of shown) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'cell' + (g.id === selectedId ? ' is-active' : '');
    card.style.setProperty('--h', hueOf(g.name).toFixed(1));
    if (g.id === selectedId) card.setAttribute('aria-current', 'true');

    const letter = document.createElement('span');
    letter.className = 'cell-letter';
    letter.textContent = (g.name.trim()[0] || 'N').toUpperCase();

    const name = document.createElement('span');
    name.className = 'cell-name';
    name.textContent = g.name;

    const rule = document.createElement('span');
    rule.className = 'cell-rule';

    const hours = document.createElement('span');
    hours.className = 'cell-hours mono';
    hours.textContent = fmtHours(g.seconds_played);

    card.appendChild(letter);
    card.appendChild(name);
    card.appendChild(rule);
    card.appendChild(hours);

    if (g.playing) {
      const mark = document.createElement('span');
      mark.className = 'cell-mark';
      mark.innerHTML = icon('crescent');
      card.appendChild(mark);
    }

    card.addEventListener('click', () => selectGame(g.id));
    els.grid.appendChild(card);
  }
}

function renderSidebar() {
  const shown = visibleGames();
  els.list.textContent = '';

  for (const g of shown) {
    const li = document.createElement('li');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'row' + (g.id === selectedId ? ' is-active' : '');
    if (g.id === selectedId) row.setAttribute('aria-current', 'true');

    const name = document.createElement('span');
    name.className = 'row-name';
    name.textContent = g.name;

    row.appendChild(name);

    if (g.playing) {
      const mark = document.createElement('span');
      mark.className = 'row-mark';
      mark.innerHTML = icon('crescent');
      row.appendChild(mark);
    }

    const hours = document.createElement('span');
    hours.className = 'row-hours mono';
    hours.textContent = fmtHours(g.seconds_played);
    row.appendChild(hours);

    row.addEventListener('click', () => selectGame(g.id));
    li.appendChild(row);
    els.list.appendChild(li);
  }

  if (!shown.length) {
    const emptyRow = document.createElement('li');
    emptyRow.className = 'ach-empty';
    emptyRow.style.padding = '8px 10px';
    emptyRow.textContent = query.trim() ? 'Ничего не найдено' : 'Игр пока нет';
    els.list.appendChild(emptyRow);
  }

  els.sideCount.textContent = shown.length === summary.games.length
    ? String(shown.length)
    : `${shown.length} / ${summary.games.length}`;

  const totals = summary.totals;
  if (totals) {
    els.totalHours.textContent = fmtHours(totals.seconds);
    const streak = totals.streak_days || 0;
    els.footStreak.hidden = streak < 1;
    if (streak) {
      els.streakVal.textContent = `${streak} ${plural(streak, 'день', 'дня', 'дней')}`;
    }
  }
}

function renderDetail(g, st) {
  const hue = hueOf(g.name);
  els.cover.style.setProperty('--h', hue.toFixed(1));

  const letter = (g.name.trim()[0] || 'N').toUpperCase();
  els.coverLetter.textContent = letter;
  els.coverName.textContent = g.name;
  const exeFile = g.exe_path.split(/[\\/]/).pop() || g.exe_path;
  els.coverExe.textContent = exeFile;
  els.coverExe.title = g.exe_path;

  els.title.textContent = g.name;
  els.hoursNum.textContent = fmtHours(g.seconds_played);

  const last = fmtDate(g.last_played);
  els.last.textContent = last ? `последний запуск ${last}` : 'ещё не запускалась';

  if (st) {
    const weekSeconds = (st.week || []).reduce((acc, d) => acc + (d.seconds || 0), 0);
    els.statToday.textContent = fmtHours(st.today_seconds);
    els.statWeek.textContent = fmtHours(weekSeconds);
    els.statRecord.textContent = fmtHours(st.longest_session_seconds);
    drawChart(st.week || []);
  } else {
    els.statToday.textContent = '—';
    els.statWeek.textContent = '—';
    els.statRecord.textContent = '—';
  }

  renderAchievements(summary.achievements || []);
}

function renderAchievements(list) {
  els.achGrid.textContent = '';
  const unlocked = list.filter((a) => a.unlocked).length;
  els.achCount.textContent = list.length ? `${unlocked} / ${list.length}` : '';

  if (!list.length) {
    const note = document.createElement('p');
    note.className = 'ach-empty';
    note.textContent = 'Пока нет достижений';
    els.achGrid.appendChild(note);
    return;
  }

  for (const a of list) {
    const card = document.createElement('article');
    card.className = 'ach ' + (a.unlocked ? 'is-open' : 'is-locked');

    const ic = document.createElement('span');
    ic.className = 'ach-icon';
    ic.innerHTML = icon(a.unlocked ? 'trophy' : 'lock');
    card.appendChild(ic);

    const title = document.createElement('h3');
    title.className = 'ach-title';
    title.textContent = a.title;
    card.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'ach-desc';
    desc.textContent = a.description || '';
    card.appendChild(desc);

    const foot = document.createElement('div');
    foot.className = 'ach-foot';

    if (a.unlocked) {
      const date = fmtDate(a.unlocked_at);
      if (date) {
        const d = document.createElement('span');
        d.className = 'ach-date mono';
        d.textContent = date;
        foot.appendChild(d);
      }
    } else {
      const p = progressInfo(a.progress);
      const track = document.createElement('div');
      track.className = 'ach-track';
      const fill = document.createElement('div');
      fill.className = 'ach-fill';
      fill.style.width = `${Math.round(p.ratio * 100)}%`;
      track.appendChild(fill);
      foot.appendChild(track);
      if (p.label) {
        const num = document.createElement('span');
        num.className = 'ach-num mono';
        num.textContent = p.label;
        foot.appendChild(num);
      }
    }

    card.appendChild(foot);
    els.achGrid.appendChild(card);
  }
}

/* progress приходит от ядра: строка, доля 0..1 или {current, target} */
function progressInfo(p) {
  if (p == null) return { ratio: 0, label: null };
  if (typeof p === 'string') {
    const nums = p.match(/\d+(?:[.,]\d+)?/g);
    if (nums && nums.length >= 2) {
      const cur = parseFloat(nums[0].replace(',', '.'));
      const tgt = parseFloat(nums[1].replace(',', '.'));
      return { ratio: tgt > 0 ? Math.min(1, cur / tgt) : 0, label: p };
    }
    return { ratio: 0, label: p };
  }
  if (typeof p === 'number') {
    if (p > 0 && p < 1) return { ratio: p, label: `${Math.round(p * 100)}%` };
    return { ratio: Math.min(1, Math.max(0, p)), label: null };
  }
  if (typeof p === 'object') {
    const cur = Number(p.current ?? p.value ?? 0);
    const tgt = Number(p.target ?? p.goal ?? 0);
    return {
      ratio: tgt > 0 ? Math.min(1, cur / tgt) : 0,
      label: `${fmtNum(cur)} / ${fmtNum(tgt)}`,
    };
  }
  return { ratio: 0, label: null };
}

/* ── График недели: canvas, золото 2px, hairline-сетка ──────────── */

let lastWeek = [];

function drawChart(week) {
  lastWeek = week;
  const canvas = els.chart;
  const wrap = els.chartWrap;
  const cssW = wrap.clientWidth;
  const H = 148;
  if (!cssW) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, H);

  const values = week.map((d) => d.seconds || 0);
  const maxVal = Math.max(0, ...values);
  const niceMax = Math.max(7200, Math.ceil(maxVal / 3600) * 3600);

  const top = 16;
  const bottom = H - 26;
  const plotH = bottom - top;
  const pad = 12;

  // Сетка: 3 горизонтальных hairline + подпись максимума
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = 1;
  for (const t of [0, 0.5, 1]) {
    const y = Math.round(top + plotH * t) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(cssW, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#6d6b76';
  ctx.font = '11px "Cascadia Mono", "Consolas", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(fmtHours(niceMax), 0, top - 5);

  const x = (i) => pad + (i * (cssW - pad * 2)) / 6;
  const y = (v) => top + plotH * (1 - v / niceMax);

  // Линия: золото 2px
  if (values.length > 1) {
    ctx.strokeStyle = '#d9a441';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    values.forEach((v, i) => {
      if (i === 0) ctx.moveTo(x(i), y(v));
      else ctx.lineTo(x(i), y(v));
    });
    ctx.stroke();

    // Точки 3px только на днях с часами
    ctx.fillStyle = '#d9a441';
    values.forEach((v, i) => {
      if (v > 0) {
        ctx.beginPath();
        ctx.arc(x(i), y(v), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // Подписи дней 11px muted — по дате каждой точки
  ctx.fillStyle = '#6d6b76';
  ctx.font = '11px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  const DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  week.forEach((d, i) => {
    const [yy, mm, dd] = String(d.date).split('-').map(Number);
    const day = new Date(yy, (mm || 1) - 1, dd || 1).getDay();
    ctx.fillText(DAYS[day], x(i), H - 8);
  });
}

new ResizeObserver(() => {
  if (!els.detail.hidden) drawChart(lastWeek);
}).observe(els.chartWrap);

/* ── Сессия: полумесяц в статусбаре и тикающий таймер ───────────── */

function reconcilePlaying() {
  const pg = summary.games.find((g) => g.playing);
  if (pg) {
    if (playingId !== pg.id) {
      playingId = pg.id;
      sessionStart = Date.now();
    }
  } else {
    playingId = null;
  }
}

function renderStatusPlay() {
  if (!playingId) {
    els.statusPlay.hidden = true;
    return;
  }
  const g = summary.games.find((x) => x.id === playingId);
  if (!g) {
    els.statusPlay.hidden = true;
    return;
  }
  els.statusPlay.hidden = false;
  els.spName.textContent = g.name;
  tickTimer();
}

function tickTimer() {
  if (!playingId) return;
  const elapsed = (Date.now() - sessionStart) / 1000;
  els.spTimer.textContent = fmtTimer(elapsed);
}

setInterval(tickTimer, 1000);

/* ── Данные ─────────────────────────────────────────────────────── */

async function refresh() {
  if (!invoke) {
    loadPreview();
  } else {
    try {
      summary = await invoke('get_summary');
      stats = null;
      if (selectedId) {
        stats = await invoke('get_game_stats', { id: selectedId });
      }
    } catch (e) {
      say(e);
      return;
    }
  }
  if (!summary.games.some((g) => g.id === selectedId)) {
    selectedId = summary.games.length ? summary.games[0].id : null;
    if (!selectedId) view = 'grid';
  }
  reconcilePlaying();
  render();
}

async function selectGame(id) {
  if (id === selectedId && view === 'detail') return;
  selectedId = id;
  view = 'detail';
  stats = null;
  if (invoke) {
    try {
      stats = await invoke('get_game_stats', { id });
    } catch (e) {
      stats = null;
    }
  } else {
    stats = PREVIEW_STATS[id] || null;
  }
  render();
}

async function addGame() {
  if (!T || !invoke) {
    say('Ядро недоступно — предпросмотр');
    return;
  }
  let path = null;
  try {
    path = await T.dialog.open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Игры', extensions: ['exe'] }],
    });
  } catch (e) {
    say(e);
    return;
  }
  if (!path) return;

  try {
    const game = await invoke('add_game', { exePath: Array.isArray(path) ? path[0] : path });
    if (game && game.id) {
      selectedId = game.id;
      stats = null;
      await refresh();
    } else {
      say(typeof game === 'string' ? game : 'Не удалось добавить игру');
    }
  } catch (e) {
    say(e);
  }
}

async function removeGame() {
  const g = currentGame();
  if (!g) return;
  if (!confirm(`Убрать «${g.name}» из библиотеки? Часы и достижения игры будут удалены.`)) return;
  try {
    await invoke('remove_game', { id: g.id });
    selectedId = null;
    stats = null;
    await refresh();
  } catch (e) {
    say(e);
  }
}

async function playGame() {
  const g = currentGame();
  if (!g) return;
  try {
    await invoke('launch_game', { id: g.id });
  } catch (e) {
    say(e);
    return;
  }
  // Трекер ядра замечает процесс в течение нескольких секунд:
  // подтягиваем состояние, не дожидаясь общего события
  setTimeout(refresh, 1500);
  setTimeout(refresh, 5000);
}

/* ── События ────────────────────────────────────────────────────── */

els.search.addEventListener('input', () => {
  query = els.search.value;
  if (query.trim()) view = 'grid';
  render();
});

els.add.addEventListener('click', addGame);
els.emptyAdd.addEventListener('click', addGame);
els.play.addEventListener('click', playGame);
els.remove.addEventListener('click', removeGame);
els.back.addEventListener('click', () => {
  view = 'grid';
  render();
});

if (T) {
  T.event.listen('library-changed', () => refresh());
}

/* ── Предпросмотр без ядра (браузер) ────────────────────────────── */

const PREVIEW_STATS = {};

function loadPreview() {
  const week = [
    { date: '2026-11-02', seconds: 5400 },
    { date: '2026-11-03', seconds: 0 },
    { date: '2026-11-04', seconds: 9060 },
    { date: '2026-11-05', seconds: 3600 },
    { date: '2026-11-06', seconds: 12600 },
    { date: '2026-11-07', seconds: 23400 },
    { date: '2026-11-08', seconds: 4380 },
  ];

  summary = {
    games: [
      { id: 'g1', name: 'Hollow Knight', exe_path: 'D:\\Games\\Hollow Knight\\hollow_knight.exe', seconds_played: 44640, last_played: '2026-11-07T23:41:00', playing: true },
      { id: 'g2', name: 'Disco Elysium', exe_path: 'D:\\Games\\Disco Elysium\\disco.exe', seconds_played: 82140, last_played: '2026-11-05T22:10:00', playing: false },
      { id: 'g3', name: 'Stardew Valley', exe_path: 'D:\\Games\\Stardew Valley\\Stardew Valley.exe', seconds_played: 27300, last_played: '2026-11-01T19:05:00', playing: false },
    ],
    totals: { seconds: 154080, week, streak_days: 3, longest_session_seconds: 9780, sessions_count: 47 },
    achievements: [
      { id: 'a1', title: 'Первый час', description: 'Провести в игре первый час', icon: 'trophy', unlocked: true, unlocked_at: '2026-10-12T21:30:00', progress: null },
      { id: 'a2', title: 'Ночной сторож', description: 'Играть после полуночи', icon: 'trophy', unlocked: true, unlocked_at: '2026-11-07T00:24:00', progress: null },
      { id: 'a3', title: 'Марафон', description: 'Сессия длиной 3 часа без перерыва', icon: 'lock', unlocked: false, unlocked_at: null, progress: { current: 2.1, target: 3 } },
      { id: 'a4', title: 'Коллекционер', description: 'Собрать пять игр в библиотеке', icon: 'lock', unlocked: false, unlocked_at: null, progress: { current: 3, target: 5 } },
      { id: 'a5', title: 'Неделя огня', description: 'Серия из семи дней подряд', icon: 'lock', unlocked: false, unlocked_at: null, progress: 3 / 7 },
      { id: 'a6', title: 'Ранняя пташка', description: 'Запустить игру до восьми утра', icon: 'lock', unlocked: false, unlocked_at: null, progress: '0 / 1' },
    ],
  };

  for (const g of summary.games) {
    PREVIEW_STATS[g.id] = {
      total_seconds: g.seconds_played,
      today_seconds: g.id === 'g1' ? 4380 : 0,
      longest_session_seconds: g.id === 'g2' ? 12300 : 7200,
      last_played: g.last_played,
      sessions_count: 18,
      week,
    };
  }

  els.statusLeft.textContent = `${BASE_STATUS} · предпросмотр без ядра`;
}

refresh();
