import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addGame,
  getGameStats,
  getSummary,
  hasTauri,
  launchGame,
  onLibraryChanged,
  openExeDialog,
  removeGame,
} from './api.js';
import Topbar from './components/Topbar.jsx';
import Shelf from './components/Shelf.jsx';
import Detail from './components/Detail.jsx';
import StatusPlay from './components/StatusPlay.jsx';

function errText(e) {
  if (e && typeof e === 'object' && 'message' in e) return String(e.message);
  return String(e);
}

// Версия приходит из package.json через define в vite.config.mjs.
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

const BOOT_TIMEOUT_MS = 10000;

export default function App() {
  const [summary, setSummary] = useState(null);
  const [stats, setStats] = useState(null);
  const [view, setView] = useState('shelf'); // 'shelf' | 'detail'
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(null); // { text, error }
  const [loadError, setLoadError] = useState(null); // ядро не отдало библиотеку
  const [entered, setEntered] = useState(false); // stagger-вход только при первом появлении полки
  const statusTimer = useRef(null);

  const showStatus = useCallback((text, error = false) => {
    setStatus({ text, error });
    clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), error ? 8000 : 4000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await getSummary();
      setSummary(next);
      setLoadError(null);
    } catch (e) {
      const text = errText(e);
      setLoadError(text);
      showStatus(text, true);
    }
  }, [showStatus]);

  const retry = useCallback(() => {
    setLoadError(null);
    refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
    return onLibraryChanged(refresh);
  }, [refresh]);

  // Страховка от «вечной распаковки»: если ядро молчит дольше 10 секунд,
  // показываем ошибку с кнопкой повтора вместо бесконечного «открываю архив…».
  useEffect(() => {
    if (summary || loadError) return undefined;
    const t = setTimeout(() => {
      setLoadError('Ядро не ответило за 10 секунд. Попробуйте запустить лаунчер ещё раз.');
    }, BOOT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [summary, loadError]);

  // Stagger-вход полки: классы снимаются, когда анимация гарантированно доиграла.
  useEffect(() => {
    if (!summary || entered) return undefined;
    const t = setTimeout(() => setEntered(true), 750);
    return () => clearTimeout(t);
  }, [summary, entered]);

  const selected = (summary && selectedId)
    ? summary.games.find((g) => g.id === selectedId) || null
    : null;

  // Статистика выбранной игры; обновляется вместе с summary (library-changed).
  useEffect(() => {
    if (view !== 'detail' || !selectedId) return undefined;
    if (!selected) {
      setView('shelf');
      return undefined;
    }
    let alive = true;
    getGameStats(selectedId)
      .then((s) => {
        if (alive) setStats(s);
      })
      .catch((e) => showStatus(errText(e), true));
    return () => {
      alive = false;
    };
  }, [view, selectedId, selected, showStatus]);

  const openGame = useCallback((id) => {
    setSelectedId(id);
    setStats(null);
    setQuery('');
    setView('detail');
  }, []);

  const handleAdd = useCallback(async () => {
    let path;
    try {
      path = await openExeDialog();
    } catch (e) {
      showStatus(errText(e), true);
      return;
    }
    if (hasTauri && !path) return; // в ядре отмена диалога — тихий выход
    try {
      const game = await addGame(path);
      showStatus(`Добавлено: ${game.name}`);
      refresh();
    } catch (e) {
      showStatus(errText(e), true);
    }
  }, [refresh, showStatus]);

  const handleLaunch = useCallback(async (id) => {
    try {
      await launchGame(id);
      refresh();
    } catch (e) {
      showStatus(errText(e), true);
    }
  }, [refresh, showStatus]);

  const handleRemove = useCallback(async (game) => {
    if (!confirm(`Убрать «${game.name}» из библиотеки? Статистика игры будет удалена.`)) return;
    try {
      await removeGame(game.id);
      setSelectedId(null);
      setStats(null);
      setView('shelf');
      showStatus(`Убрано: ${game.name}`);
      refresh();
    } catch (e) {
      showStatus(errText(e), true);
    }
  }, [refresh, showStatus]);

  // Esc: закрыть сообщение → выйти из детализации → очистить поиск.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (status) setStatus(null);
      else if (view === 'detail') setView('shelf');
      else if (query) setQuery('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, query, status]);

  const handleQuery = useCallback((q) => {
    setQuery(q);
    if (q && view === 'detail') setView('shelf');
  }, [view]);

  const playingGames = summary ? summary.games.filter((g) => g.playing) : [];
  const playing = playingGames[0] || null;

  return (
    <div className="app">
      <Topbar
        query={query}
        onQuery={handleQuery}
        onAdd={handleAdd}
        addPrimary={view === 'shelf' && !!summary && summary.games.length > 0}
      />

      <main className="screen view-fade" key={view}>
        {view === 'shelf' || !selected ? (
          <Shelf
            summary={summary}
            query={query}
            entered={entered}
            onOpen={openGame}
            onAdd={handleAdd}
            error={loadError}
            onRetry={retry}
          />
        ) : (
          <Detail
            game={selected}
            stats={stats}
            achievements={summary ? summary.achievements : null}
            onBack={() => setView('shelf')}
            onLaunch={() => handleLaunch(selected.id)}
            onRemove={() => handleRemove(selected)}
          />
        )}
      </main>

      <footer className="statusbar">
        <span className="status-left mono">
          NyxLauncher {APP_VERSION}{hasTauri ? '' : ' · предпросмотр, демо-данные'}
        </span>
        {status && (
          <span className={`status-msg${status.error ? ' is-error' : ''}`} role="status">
            {status.text}
          </span>
        )}
        <span className="status-flex" />
        {playing && (
          <StatusPlay
            key={playing.id}
            game={playing}
            extra={playingGames.length - 1}
          />
        )}
      </footer>
    </div>
  );
}
