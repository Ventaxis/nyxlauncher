// Форматирование: числа (ru-RU, tabular), часы, даты, hue-хэш обложек.

const nf = new Intl.NumberFormat('ru-RU');

/** Часы для сводок: целые, меньше часа — минуты. @param {number} seconds */
export function fmtHours(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 ч';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} мин`;
  return `${nf.format(Math.floor(seconds / 3600))} ч`;
}

/** Крупные часы: до 100 ч — один знак после запятой, дальше целые. @param {number} seconds */
export function fmtHoursBig(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 ч';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} мин`;
  const h = seconds / 3600;
  if (h < 100) return `${nf.format(Math.round(h * 10) / 10)} ч`;
  return `${nf.format(Math.floor(h))} ч`;
}

/** Подпись над точкой графика. @param {number} seconds */
export function fmtChartVal(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} мин`;
  return `${nf.format(Math.round((seconds / 3600) * 10) / 10)} ч`;
}

/** Живой таймер сессии: m:ss или h:mm:ss. @param {number} seconds */
export function fmtTimer(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const two = (n) => pad2(n);
  return hh > 0 ? `${hh}:${two(mm)}:${two(ss)}` : `${mm}:${two(ss)}`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dayFloor(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** «сегодня в 23:10», «вчера в 21:04», «5 нояб в 19:45», без данных — тире. @param {string|null} iso */
export function fmtLastPlayed(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const diffDays = Math.round((dayFloor(now) - dayFloor(d)) / 86400000);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (diffDays <= 0) return `сегодня в ${time}`;
  if (diffDays === 1) return `вчера в ${time}`;
  const date = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  const year = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${date}${year} в ${time}`;
}

/** Короткая дата: «5 нояб». @param {string|null} iso */
export function fmtShortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/** Дата и время сессии из Unix-секунд: «5 нояб, 21:30». @param {number} ts */
export function fmtDateTime(ts) {
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

/** Длительность сессии: «1 ч 24 мин» / «37 мин». @param {number} seconds */
export function fmtDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} ч ${pad2(m)} мин`;
  return `${Math.max(1, m)} мин`;
}

/** Значение для <input type="datetime-local"> из Unix-секунд. @param {number} ts */
export function toLocalInputValue(ts) {
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/** @param {string} dateStr 'YYYY-MM-DD' */
export function weekdayShort(dateStr) {
  const parts = String(dateStr || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return '';
  return WEEKDAYS[new Date(parts[0], parts[1] - 1, parts[2]).getDay()] || '';
}

/** Приглушённый оттенок корешка из имени: hue-хэш, мимо фиолетового диапазона. @param {string} name */
export function hueFromName(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  let hue = h % 360;
  if (hue > 240 && hue < 320) hue = 200 + (hue - 240) / 2;
  return Math.round(hue);
}

/** Монограмма: первые буквы первых двух слов. @param {string} name */
export function monogram(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}
