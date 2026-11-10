import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addGame,
  addManualSession,
  deleteSession,
  exportData,
  getGameStats,
  getIcons,
  getSessions,
  getSettings,
  getSummary,
  hasTauri,
  importData,
  launchGame,
  onLibraryChanged,
  onSettingsChanged,
  openBackupDialog,
  openDataDir,
  openExeDialog,
  refreshExe,
  removeGame,
  resetStats,
  saveBackupDialog,
  setSettings,
  updateGame,
} from './api.js';
import Topbar from './components/Topbar.jsx';
import Shelf from './components/Shelf.jsx';
import Detail from './components/Detail.jsx';
import Settings from './components/Settings.jsx';
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
  const [sessions, setSessions] = useState(null);
  const [icons, setIcons] = useState({});
  const [settingsView, setSettingsView] = useState(null);
  const [view, setView] = useState('shelf'); // 'shelf' | 'detail' | 'settings'
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(null); // { text, error }
  const [loadError, setLoadError] = useState(null); // ядро не отдало библиотеку
  const [entered, setEntered] = useState(false); // stagger-вход только при первом появлении полки
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [bannerOff, setBannerOff] = useState(false);

  const statusTimer = useRef(null);
  const saveTimer = useRef(null);
  const savedTimer = useRef(null);
  const settingsRef = useRef(null);

  const settings = settingsView ? settingsView.settings : null;

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

  const refreshSettings = useCallback(async () => {
    try {
      const next = await getSettings();
      setSettingsView(next);
    } catch (e) {
      showStatus(errText(e), true);
    }
  }, [showStatus]);

  const retry = useCallback(() => {
    setLoadError(null);
    refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
    refreshSettings();
    return onLibraryChanged(refresh);
  }, [refresh, refreshSettings]);

  useEffect(() => onSettingsChanged(() => refreshSettings()), [refreshSettings]);

  useEffect(() => {
    settingsRef.current = settings;
    const root = document.documentElement;
    if (settings) {
      root.dataset.theme = settings.theme || 'graphite';
      root.dataset.motion = settings.reduce_motion ? 'reduced' : 'full';
    }
  }, [settings]);

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

  const iconKey = useMemo(
    () => (summary ? summary.games.map((g) => g.id).join('|') : ''),
    [summary],
  );

  useEffect(() => {
    if (!summary || (settings && settings.show_icons === false)) {
      setIcons({});
      return undefined;
    }
    let alive = true;
    getIcons()
      .then((map) => {
        if (alive) setIcons(map || {});
      })
      .catch((e) => console.error('nyx: иконки недоступны', e));
    return () => {
      alive = false;
    };
    // iconKey меняется только при изменении набора игр
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iconKey, settings && settings.show_icons]);

  const selected = summary && selectedId
    ? summary.games.find((g) => g.id === selectedId) || null
    : null;

  const loadDetail = useCallback(async (id) => {
    try {
      const [st, list] = await Promise.all([getGameStats(id), getSessions(id)]);
      setStats(st);
      setSessions(list);
    } catch (e) {
      showStatus(errText(e), true);
    }
  }, [showStatus]);

  // Статистика и история выбранной игры; обновляются вместе с summary.
  useEffect(() => {
    if (view !== 'detail' || !selectedId) return undefined;
    if (!selected) {
      setView('shelf');
      return undefined;
    }
    let alive = true;
    Promise.all([getGameStats(selectedId), getSessions(selectedId)])
      .then(([st, list]) => {
        if (alive) {
          setStats(st);
          setSessions(list);
        }
      })
      .catch((e) => showStatus(errText(e), true));
    return () => {
      alive = false;
    };
  }, [view, selectedId, selected, showStatus]);

  const run = useCallback(async (fn) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      showStatus(errText(e), true);
    } finally {
      setBusy(false);
    }
  }, [showStatus]);

  const openGame = useCallback((id) => {
    setSelectedId(id);
    setStats(null);
    setSessions(null);
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
    await run(async () => {
      const game = await addGame(path);
      showStatus(`Добавлено: ${game.name}`);
      await refresh();
    });
  }, [refresh, run, showStatus]);

  const handleLaunch = useCallback(async (id) => {
    await run(async () => {
      await launchGame(id);
      await refresh();
    });
  }, [refresh, run]);

  const handleRemove = useCallback(async (game) => {
    if (!confirm(`Убрать «${game.name}» из библиотеки? Статистика игры будет удалена.`)) return;
    await run(async () => {
      await removeGame(game.id);
      setSelectedId(null);
      setStats(null);
      setSessions(null);
      setView('shelf');
      showStatus(`Убрано: ${game.name}`);
      await refresh();
    });
  }, [refresh, run, showStatus]);

  const handleSaveLaunch = useCallback(async ({ name, args, workDir }) => {
    if (!selectedId) return;
    // Пробрасываем ошибку наверх: форма не должна закрываться,
    // если ядро не приняло название/папку.
    setBusy(true);
    try {
      await updateGame({ id: selectedId, name, args, workDir });
      showStatus('Настройки запуска сохранены');
      await refresh();
      await loadDetail(selectedId);
    } catch (e) {
      showStatus(errText(e), true);
      throw e;
    } finally {
      setBusy(false);
    }
  }, [loadDetail, refresh, selectedId, showStatus]);

  const handleRefreshExe = useCallback(async () => {
    if (!selectedId) return;
    await run(async () => {
      await refreshExe(selectedId);
      showStatus('Exe проверен, хеш обновлён');
      await refresh();
      // Бэкенд сбросил кеш иконки — забираем свежую.
      const map = await getIcons();
      setIcons(map || {});
    });
  }, [refresh, run, selectedId, showStatus]);

  const handleAddSession = useCallback(async (start, minutes) => {
    if (!selectedId) return;
    // Не глотаем ошибку: форма в истории сессий должна остаться открытой
    // и показать причину, а не сделать вид, что запись добавлена.
    setBusy(true);
    try {
      await addManualSession({ id: selectedId, start, minutes });
      showStatus('Сессия добавлена');
      await refresh();
      await loadDetail(selectedId);
    } catch (e) {
      showStatus(errText(e), true);
      throw e;
    } finally {
      setBusy(false);
    }
  }, [loadDetail, refresh, selectedId, showStatus]);

  const handleDeleteSession = useCallback(async (sessionId) => {
    await run(async () => {
      await deleteSession(sessionId);
      await refresh();
      if (selectedId) await loadDetail(selectedId);
    });
  }, [loadDetail, refresh, run, selectedId]);

  const handleResetGame = useCallback(async () => {
    if (!selectedId) return;
    if (!confirm('Удалить все сессии и часы этой игры? Действие необратимо.')) return;
    await run(async () => {
      await resetStats(selectedId);
      showStatus('Статистика игры сброшена');
      await refresh();
      await loadDetail(selectedId);
    });
  }, [loadDetail, refresh, run, selectedId, showStatus]);

  const applySettings = useCallback((patch) => {
    const current = settingsRef.current;
    if (!current) return;
    const next = { ...current, ...patch };
    settingsRef.current = next;
    setSettingsView((prev) => (prev ? { ...prev, settings: next } : prev));

    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const viewNext = await setSettings(next);
        setSettingsView(viewNext);
        settingsRef.current = viewNext.settings;
        setSaved(true);
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 1600);
      } catch (e) {
        showStatus(errText(e), true);
        refreshSettings();
      }
    }, 350);
  }, [refreshSettings, showStatus]);

  const handleRecheckAll = useCallback(async () => {
    if (!summary) return;
    const games = summary.games;
    if (games.length === 0) {
      showStatus('В библиотеке нет игр');
      return;
    }
    await run(async () => {
      let done = 0;
      let failed = 0;
      for (const g of games) {
        try {
          await refreshExe(g.id);
          done += 1;
        } catch {
          failed += 1;
        }
      }
      await refresh();
      const map = await getIcons();
      setIcons(map || {});
      showStatus(
        failed === 0
          ? `Проверено игр: ${done}`
          : `Проверено: ${done}, не удалось: ${failed} (файл мог переехать)`,
        failed > 0,
      );
    });
  }, [refresh, run, showStatus, summary]);

  const handleExport = useCallback(async () => {
    await run(async () => {
      const path = await saveBackupDialog();
      if (!path) return;
      await exportData(path);
      showStatus(`Копия сохранена: ${path}`);
    });
  }, [run, showStatus]);

  const handleImport = useCallback(async () => {
    if (!confirm('Импорт заменит текущую библиотеку, историю и настройки. Продолжить?')) return;
    await run(async () => {
      const path = await openBackupDialog();
      if (!path) return;
      const msg = await importData(path);
      showStatus(msg);
      setSelectedId(null);
      setView('shelf');
      await refresh();
      await refreshSettings();
    });
  }, [refresh, refreshSettings, run, showStatus]);

  const handleResetAll = useCallback(async () => {
    if (!confirm('Удалить всю статистику и достижения? Библиотека игр останется. Это необратимо.')) return;
    await run(async () => {
      await resetStats(null);
      showStatus('Вся статистика сброшена');
      await refresh();
      if (selectedId) await loadDetail(selectedId);
    });
  }, [loadDetail, refresh, run, selectedId, showStatus]);

  const handleOpenDataDir = useCallback(async () => {
    await run(async () => {
      await openDataDir();
    });
  }, [run]);

  // Esc: закрыть сообщение → выйти из настроек/детализации → очистить поиск.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (status) setStatus(null);
      else if (view === 'settings' || view === 'detail') setView('shelf');
      else if (query) setQuery('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, query, status]);

  const handleQuery = useCallback((q) => {
    setQuery(q);
    if (q && view === 'detail') setView('shelf');
  }, [view]);

  const toggleSettings = useCallback(() => {
    setView((v) => (v === 'settings' ? 'shelf' : 'settings'));
  }, []);

  const playingGames = summary ? summary.games.filter((g) => g.playing) : [];
  const playing = playingGames[0] || null;
  const warnings = summary && summary.warnings ? summary.warnings : [];
  const warningsKey = warnings.join('|');

  useEffect(() => {
    setBannerOff(false);
  }, [warningsKey]);

  const showIcons = !settings || settings.show_icons !== false;

  return (
    <div className="app">
      <Topbar
        query={query}
        onQuery={handleQuery}
        onAdd={handleAdd}
        addPrimary={view === 'shelf' && !!summary && summary.games.length > 0}
        view={view}
        onSettings={toggleSettings}
        paused={summary ? summary.tracker_paused : false}
        warnings={warnings}
      />

      <main className="screen view-fade" key={view}>
        {warnings.length > 0 && !bannerOff && (
          <div className="banner" role="alert">
            <svg className="icon" aria-hidden="true"><use href="#i-warning" /></svg>
            <div className="banner-text">
              <strong>Данные требуют внимания.</strong> {warnings[0]}
              {warnings.length > 1 ? ` И ещё ${warnings.length - 1}.` : ''}
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setBannerOff(true)}
              aria-label="Скрыть предупреждение"
            >
              <svg className="icon sm" aria-hidden="true"><use href="#i-x" /></svg>
            </button>
          </div>
        )}

        {view === 'settings' ? (
          <Settings
            view={settingsView}
            gameCount={summary ? summary.games.length : 0}
            onChange={applySettings}
            onOpenDataDir={handleOpenDataDir}
            onExport={handleExport}
            onImport={handleImport}
            onResetAll={handleResetAll}
            onRecheckAll={handleRecheckAll}
            busy={busy}
            saved={saved}
          />
        ) : view === 'shelf' || !selected ? (
          <Shelf
            summary={summary}
            query={query}
            entered={entered}
            onOpen={openGame}
            onAdd={handleAdd}
            error={loadError}
            onRetry={retry}
            settings={settings}
            onSort={(mode) => applySettings({ sort_mode: mode })}
            icons={icons}
          />
        ) : (
          <Detail
            game={selected}
            stats={stats}
            achievements={summary ? summary.achievements : null}
            sessions={sessions}
            icon={showIcons ? icons[selected.id] : null}
            settings={settings}
            busy={busy}
            onBack={() => setView('shelf')}
            onLaunch={() => handleLaunch(selected.id)}
            onRemove={() => handleRemove(selected)}
            onSaveLaunch={handleSaveLaunch}
            onRefreshExe={handleRefreshExe}
            onAddSession={handleAddSession}
            onDeleteSession={handleDeleteSession}
            onResetStats={handleResetGame}
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
