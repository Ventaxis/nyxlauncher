const THEMES = [
  { value: 'graphite', label: 'Графит' },
  { value: 'midnight', label: 'Полночь' },
  { value: 'oled', label: 'OLED' },
];

const SORTS = [
  { value: 'recent', label: 'Недавние' },
  { value: 'name', label: 'По названию' },
  { value: 'hours', label: 'По часам' },
  { value: 'added', label: 'По добавлению' },
];

const MIN_SESSIONS = [
  { value: 0, label: 'Любая (0 с)' },
  { value: 30, label: '30 секунд' },
  { value: 60, label: '1 минута' },
  { value: 120, label: '2 минуты' },
  { value: 300, label: '5 минут' },
  { value: 600, label: '10 минут' },
];

function Toggle({ label, hint, checked, onChange, disabled }) {
  return (
    <div className={`setting${disabled ? ' is-disabled' : ''}`}>
      <div className="setting-text">
        <div className="setting-label">{label}</div>
        {hint && <div className="setting-hint">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch${checked ? ' is-on' : ''}`}
        onClick={() => onChange(!checked)}
        disabled={disabled}
      >
        <span className="switch-knob" />
      </button>
    </div>
  );
}

function Choice({ label, hint, value, options, onChange, disabled }) {
  return (
    <div className={`setting${disabled ? ' is-disabled' : ''}`}>
      <div className="setting-text">
        <div className="setting-label">{label}</div>
        {hint && <div className="setting-hint">{hint}</div>}
      </div>
      <select
        className="select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={label}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export default function Settings({
  view,
  gameCount,
  onChange,
  onOpenDataDir,
  onExport,
  onImport,
  onResetAll,
  onRecheckAll,
  busy,
  saved,
}) {
  if (!view) return <p className="boot mono">читаю настройки…</p>;
  const s = view.settings;

  return (
    <div className="settings">
      <header className="settings-head">
        <div>
          <h1 className="shelf-title">Настройки</h1>
          <p className="settings-sub">
            Изменения сохраняются сразу. NyxLauncher живёт в трее и не нагружает систему.
          </p>
        </div>
        <span className={`save-chip${saved ? ' is-on' : ''}`}>
          <svg className="icon sm" aria-hidden="true"><use href={saved ? '#i-check' : '#i-refresh'} /></svg>
          {saved ? 'сохранено' : 'автосохранение'}
        </span>
      </header>

      <div className="settings-grid">
        <section className="card">
          <h2 className="card-title">
            <svg className="icon" aria-hidden="true"><use href="#i-monitor" /></svg>
            Запуск и фон
          </h2>

          <Toggle
            label="Запускать с Windows"
            hint="Штатная запись в HKCU\...\Run. Без служб, без прав администратора."
            checked={s.autostart}
            onChange={(v) => onChange({ autostart: v })}
          />
          <Toggle
            label="Стартовать скрытым в трее"
            hint="Окно не показывается при старте — лаунчер просто ждёт в трее."
            checked={s.start_minimized}
            onChange={(v) => onChange({ start_minimized: v })}
          />
          <Toggle
            label="Крестик скрывает в трей"
            hint="Учёт времени продолжается. Полный выход — через меню трея."
            checked={s.close_to_tray}
            onChange={(v) => onChange({ close_to_tray: v })}
          />
          <Toggle
            label="Сворачивать в трей"
            hint="Кнопка «свернуть» прячет окно, а не оставляет его в панели задач."
            checked={s.minimize_to_tray}
            onChange={(v) => onChange({ minimize_to_tray: v })}
          />
          <Toggle
            label="Прятать лаунчер при запуске игры"
            hint="Как в Steam: освобождает экран, трекер продолжает работать."
            checked={s.minimize_on_launch}
            onChange={(v) => onChange({ minimize_on_launch: v })}
          />
        </section>

        <section className="card">
          <h2 className="card-title">
            <svg className="icon" aria-hidden="true"><use href="#i-image" /></svg>
            Интерфейс
          </h2>

          <div className="setting setting-col">
            <div className="setting-text">
              <div className="setting-label">Тема</div>
              <div className="setting-hint">Графит — тёплый, полночь — синий, OLED — чистый чёрный.</div>
            </div>
            <div className="segmented" role="group" aria-label="Тема">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={`segment${s.theme === t.value ? ' is-active' : ''}`}
                  aria-pressed={s.theme === t.value}
                  onClick={() => onChange({ theme: t.value })}
                >
                  <span className={`swatch swatch-${t.value}`} aria-hidden="true" />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <Toggle
            label="Показывать иконки exe"
            hint="Настоящие иконки игр. Выключите, если нужен максимально лёгкий режим."
            checked={s.show_icons}
            onChange={(v) => onChange({ show_icons: v })}
          />
          <Toggle
            label="Меньше анимаций"
            hint="Отключает переходы и появление карточек. Полезно на слабых машинах."
            checked={s.reduce_motion}
            onChange={(v) => onChange({ reduce_motion: v })}
          />
          <Choice
            label="Сортировка библиотеки"
            hint="Порядок карточек на полке."
            value={s.sort_mode}
            options={SORTS}
            onChange={(v) => onChange({ sort_mode: v })}
          />
        </section>

        <section className="card">
          <h2 className="card-title">
            <svg className="icon" aria-hidden="true"><use href="#i-clock" /></svg>
            Учёт времени
          </h2>

          <Toggle
            label="Пауза учёта"
            hint="Активные сессии закрываются, новые не открываются. Часы не растут."
            checked={s.tracker_paused}
            onChange={(v) => onChange({ tracker_paused: v })}
          />

          <div className="setting setting-col">
            <div className="setting-text">
              <div className="setting-label">Опрос процессов</div>
              <div className="setting-hint">
                Раз в {s.poll_secs} с. Реже — легче для системы, но сессии короче в деталях.
              </div>
            </div>
            <div className="range-row">
              <input
                type="range"
                min="2"
                max="60"
                step="1"
                value={s.poll_secs}
                onChange={(e) => onChange({ poll_secs: Number(e.target.value) })}
                aria-label="Интервал опроса процессов"
              />
              <span className="range-val mono">{s.poll_secs} с</span>
            </div>
          </div>

          <Choice
            label="Минимальная сессия"
            hint="Короткие запуски не засчитываются — меньше случайного времени."
            value={s.min_session_secs}
            options={MIN_SESSIONS}
            onChange={(v) => onChange({ min_session_secs: Number(v) })}
          />
          <Toggle
            label="Считать только с окном"
            hint="Если у процесса нет видимого окна, время не идёт. Отсекает фоновые «пустышки»."
            checked={s.require_window}
            onChange={(v) => onChange({ require_window: v })}
          />
          <Toggle
            label="Учитывать прямой запуск"
            hint="Если выключить, считаются только игры, запущенные из NyxLauncher."
            checked={s.count_direct_launch}
            onChange={(v) => onChange({ count_direct_launch: v })}
            disabled={s.strict_anticheat}
          />
        </section>

        <section className="card">
          <h2 className="card-title">
            <svg className="icon" aria-hidden="true"><use href="#i-shield" /></svg>
            Защита от накрутки
          </h2>

          <Toggle
            label="Строгий режим"
            hint="Требует совпадения хеша exe, запуска из лаунчера и видимого окна. Игры без хеша нужно перепроверить."
            checked={s.strict_anticheat}
            onChange={(v) => onChange({ strict_anticheat: v })}
          />

          <div className="note">
            <svg className="icon sm" aria-hidden="true"><use href="#i-info" /></svg>
            <p>
              Абсолютной защиты на домашнем ПК не существует: пользователь владеет и файлами, и процессом.
              NyxLauncher делает накрутку заметной и неудобной: подпись данных, монотонный таймер,
              проверка PE и видимого окна, хеш exe.
            </p>
          </div>

          <div className="setting">
            <div className="setting-text">
              <div className="setting-label">Перепроверить exe</div>
              <div className="setting-hint">
                Пересчитать хеши всех игр ({gameCount}) — нужно после обновлений игр.
              </div>
            </div>
            <button type="button" className="btn btn-quiet" onClick={onRecheckAll} disabled={busy}>
              <svg className="icon" aria-hidden="true"><use href="#i-refresh" /></svg>
              Проверить
            </button>
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">
            <svg className="icon" aria-hidden="true"><use href="#i-folder" /></svg>
            Данные
          </h2>

          <div className="setting setting-col">
            <div className="setting-text">
              <div className="setting-label">Папка данных</div>
              <div className="setting-hint">Библиотека, сессии, настройки, иконки и ключ подписи.</div>
            </div>
            <div className="path-row">
              <code className="path" title={view.data_dir}>{view.data_dir}</code>
              <button type="button" className="icon-btn" onClick={onOpenDataDir} title="Открыть папку">
                <svg className="icon sm" aria-hidden="true"><use href="#i-folder" /></svg>
              </button>
            </div>
          </div>

          <div className="setting">
            <div className="setting-text">
              <div className="setting-label">Резервная копия</div>
              <div className="setting-hint">
                Подписанный файл. Восстановить можно только на этой установке.
              </div>
            </div>
            <div className="btn-row">
              <button type="button" className="btn btn-quiet" onClick={onExport} disabled={busy}>
                <svg className="icon" aria-hidden="true"><use href="#i-download" /></svg>
                Экспорт
              </button>
              <button type="button" className="btn btn-quiet" onClick={onImport} disabled={busy}>
                <svg className="icon" aria-hidden="true"><use href="#i-upload" /></svg>
                Импорт
              </button>
            </div>
          </div>

          <div className="danger-zone">
            <div>
              <div className="danger-title">Сбросить всё</div>
              <div className="danger-desc">Удалит всю статистику и достижения. Игры останутся.</div>
            </div>
            <button type="button" className="btn btn-quiet btn-danger" onClick={onResetAll} disabled={busy}>
              <svg className="icon" aria-hidden="true"><use href="#i-trash" /></svg>
              Сбросить
            </button>
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">
            <svg className="icon" aria-hidden="true"><use href="#i-info" /></svg>
            О программе
          </h2>
          <div className="kv-list">
            <div className="kv">
              <span className="kv-key">версия</span>
              <code className="kv-val mono">{view.version}</code>
            </div>
            <div className="kv">
              <span className="kv-key">ID установки</span>
              <code className="kv-val mono">{view.install_id || '—'}</code>
            </div>
            <div className="kv">
              <span className="kv-key">игр в библиотеке</span>
              <code className="kv-val mono">{gameCount}</code>
            </div>
            <div className="kv">
              <span className="kv-key">автозапуск</span>
              <code className="kv-val mono">{view.autostart_enabled ? 'включён' : 'выключен'}</code>
            </div>
          </div>

          {(view.tampered.length > 0 || view.clock_rollback) && (
            <div className="warn-list">
              {view.tampered.map((w) => (
                <div className="warn-item" key={w}>
                  <svg className="icon sm" aria-hidden="true"><use href="#i-warning" /></svg>
                  <span>{w}</span>
                </div>
              ))}
              {view.clock_rollback && (
                <div className="warn-item">
                  <svg className="icon sm" aria-hidden="true"><use href="#i-warning" /></svg>
                  <span>Обнаружен перевод системных часов назад.</span>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
