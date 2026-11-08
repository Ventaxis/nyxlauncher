// NyxLauncher UI — библиотека, часы, статус «играет»
const { invoke } = window.__TAURI__.core;
const { open } = window.__TAURI__.dialog;

let games = [];
let selectedId = null;
let playing = new Set();

const $ = (id) => document.getElementById(id);

const el = {
  list: $("game-list"),
  empty: $("empty-state"),
  detail: $("game-detail"),
  name: $("game-name"),
  hours: $("stat-hours"),
  last: $("stat-last"),
  cover: $("cover"),
  status: $("status-text"),
};

function fmtHours(seconds) {
  const h = seconds / 3600;
  if (h < 1) return `${Math.floor(seconds / 60)} мин`;
  return `${h.toFixed(1)} ч`;
}

function fmtLast(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин назад`;
  if (mins < 1440) return `${Math.floor(mins / 60)} ч назад`;
  return d.toLocaleDateString("ru-RU");
}

// Обложка: детерминированный градиент из имени игры
function coverGradient(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const h1 = hash % 360;
  const h2 = (h1 + 70 + (hash % 60)) % 360;
  el.cover.style.background = `linear-gradient(145deg, hsl(${h1} 45% 22%), hsl(${h2} 55% 38%))`;
}

function selected() {
  return games.find((g) => g.id === selectedId) || null;
}

async function refresh() {
  games = await invoke("list_games");
  render();
}

function render() {
  renderList();
  const g = selected();
  el.empty.hidden = games.length > 0;
  el.detail.hidden = !g;
  if (!g) return;
  el.name.textContent = g.name;
  el.hours.textContent = fmtHours(g.seconds_played);
  el.last.textContent = fmtLast(g.last_played);
  coverGradient(g.name);
}

function renderList() {
  el.list.innerHTML = "";
  for (const g of games) {
    const li = document.createElement("li");
    li.className = "game-item" + (g.id === selectedId ? " active" : "") + (playing.has(g.id) ? " playing" : "");
    li.innerHTML = `<span class="dot"></span><span class="gi-name"></span><span class="gi-hours"></span>`;
    li.querySelector(".gi-name").textContent = g.name;
    li.querySelector(".gi-hours").textContent = fmtHours(g.seconds_played);
    li.onclick = () => { selectedId = g.id; render(); };
    el.list.appendChild(li);
  }
}

async function addGame() {
  const path = await open({
    title: "Выбери exe-файл игры",
    filters: [{ name: "Игры", extensions: ["exe"] }],
    multiple: false,
  });
  if (!path) return;
  try {
    const g = await invoke("add_game", { exePath: path });
    selectedId = g.id;
    await refresh();
  } catch (e) {
    el.status.textContent = `🐾 ${e}`;
  }
}

async function removeGame() {
  const g = selected();
  if (!g) return;
  if (!confirm(`Убрать «${g.name}» из библиотеки? Часы тоже сотрутся, мяу.`)) return;
  await invoke("remove_game", { id: g.id });
  selectedId = null;
  await refresh();
}

async function playGame() {
  const g = selected();
  if (!g) return;
  try {
    await invoke("launch_game", { id: g.id });
    el.status.textContent = `🎮 Запускаю «${g.name}»... Nyx следит за часами!`;
    playing.add(g.id);
    renderList();
  } catch (e) {
    el.status.textContent = `🐾 ${e}`;
  }
}

// Часы пришли из руст-трекера — обновим витрину
window.__TAURI__.event.listen("hours-updated", async () => {
  const g = selected();
  const wasPlaying = g ? playing.has(g.id) : false;
  games = await invoke("list_games");

  // если игра больше не видна в процессах — снимаем статус
  for (const id of [...playing]) {
    const gg = games.find((x) => x.id === id);
    const recent = gg && gg.last_played && Date.now() - new Date(gg.last_played).getTime() < 8000;
    if (!recent) playing.delete(id);
  }
  if (wasPlaying && g && !playing.has(g.id)) {
    el.status.textContent = "🐾 Игра завершилась — часы посчитаны!";
  }
  render();
});

$("btn-add").onclick = addGame;
$("btn-play").onclick = playGame;
$("btn-remove").onclick = removeGame;

refresh();
