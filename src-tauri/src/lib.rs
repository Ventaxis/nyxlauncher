mod engine;
mod integrity;
mod settings;
mod store;
mod winutil;

use chrono::{Local, NaiveDateTime};
use engine::{AchievementDef, Condition, EvalContext, Session};
use integrity::{Loaded, Signer};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use settings::Settings;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::menu::CheckMenuItem;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, Wry};
use winutil::norm_path;

const ACHIEVEMENTS_JSON: &str = include_str!("../achievements.json");

/// Игра в библиотеке.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Game {
    pub id: String,
    pub name: String,
    pub exe_path: String,
    #[serde(default)]
    pub seconds_played: u64,
    #[serde(default)]
    pub last_played: Option<String>,
    /// Аргументы запуска (строка как в ярлыке Windows).
    #[serde(default)]
    pub args: String,
    /// Рабочая папка; None — папка exe.
    #[serde(default)]
    pub work_dir: Option<String>,
    /// SHA-256 exe на момент добавления/обновления — античит.
    #[serde(default)]
    pub exe_hash: Option<String>,
    /// Unix-время добавления — сортировка «по добавлению».
    #[serde(default)]
    pub added_at: i64,
}

/// Игра как её видит интерфейс: + флаг «запущена сейчас».
#[derive(Serialize, Clone, Debug)]
pub struct GameView {
    pub id: String,
    pub name: String,
    pub exe_path: String,
    pub seconds_played: u64,
    pub last_played: Option<String>,
    pub args: String,
    pub work_dir: Option<String>,
    pub exe_hash: Option<String>,
    pub added_at: i64,
    pub playing: bool,
    /// Unix-секунды начала текущей сессии (для таймера в статусбаре).
    pub playing_since: Option<i64>,
}

#[derive(Serialize, Clone, Debug)]
struct WeekDay {
    date: String,
    seconds: u64,
}

#[derive(Serialize, Clone, Debug)]
struct Totals {
    seconds: u64,
    week: Vec<WeekDay>,
    streak_days: u64,
    longest_session_seconds: u64,
    sessions_count: u64,
}

#[derive(Serialize, Clone, Debug)]
struct AchievementView {
    id: String,
    title: String,
    description: String,
    icon: String,
    unlocked: bool,
    unlocked_at: Option<String>,
    progress: f64,
    /// Текущее значение и порог уже в единицах отображения (часы/шт/дни).
    progress_value: f64,
    threshold: f64,
    unit: String,
    decimals: u8,
}

#[derive(Serialize, Clone, Debug)]
struct Summary {
    games: Vec<GameView>,
    totals: Totals,
    achievements: Vec<AchievementView>,
    tracker_paused: bool,
    /// Подписанные файлы с несошедшейся подписью + откат часов.
    warnings: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
struct GameStats {
    total_seconds: u64,
    today_seconds: u64,
    longest_session_seconds: u64,
    last_played: Option<String>,
    sessions_count: u64,
    week: Vec<WeekDay>,
}

/// Незакрытая сессия: процесс ещё запущен.
#[derive(Clone, Debug)]
struct ActiveSession {
    game_id: String,
    /// Unix-время старта — только для отображения.
    start: i64,
    /// Монотонные часы: длительность не зависит от перевода системных часов.
    started: Instant,
}

impl ActiveSession {
    fn new(game_id: &str, start: i64) -> Self {
        Self {
            game_id: game_id.to_string(),
            start,
            started: Instant::now(),
        }
    }

    fn seconds(&self) -> u64 {
        self.started.elapsed().as_secs()
    }

    fn end(&self) -> i64 {
        self.start + self.seconds() as i64
    }

    fn snapshot(&self) -> Session {
        Session {
            game_id: self.game_id.clone(),
            start: self.start,
            end: self.end(),
            id: format!("s_{}", self.start),
            manual: false,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct Meta {
    #[serde(default)]
    last_seen: i64,
    #[serde(default)]
    install_id: String,
}

/// Глобальное состояние. ПРАВИЛО БЛОКИРОВОК: если нужно несколько мьютексов,
/// захватывать строго в порядке write_lock → games → sessions → active → unlocked
/// (launched/icon/settings — после них), и никогда не захватывать уже
/// удерживаемый повторно (std Mutex не реентерабелен).
/// ЗАПИСЬ НА ДИСК — после drop guard'ов состояния: файл может писать десятки мс.
struct AppState {
    write_lock: Mutex<()>,
    games: Mutex<Vec<Game>>,
    sessions: Mutex<Vec<Session>>,
    active: Mutex<HashMap<String, ActiveSession>>,
    unlocked: Mutex<HashMap<String, String>>,
    settings: Mutex<Settings>,
    icons: Mutex<HashMap<String, String>>,
    /// id игры → PID, запущенный лаунчером (строгий режим).
    launched: Mutex<HashMap<String, u32>>,
    meta: Mutex<Meta>,
    tampered: Mutex<Vec<String>>,
    clock_rollback: Mutex<bool>,
    /// Пункт трея «Пауза», чтобы синхронизировать галочку с настройками.
    tray_pause: Mutex<Option<CheckMenuItem<Wry>>>,
    signer: Signer,
    defs: Vec<AchievementDef>,
    data_dir: PathBuf,
}

fn now_ts() -> i64 {
    Local::now().timestamp()
}

fn now_rfc3339() -> String {
    Local::now().to_rfc3339()
}

/// Полный снимок сессий: закрытые + активные (активные как обычные строки).
fn all_sessions_snapshot(
    sessions: &[Session],
    active: &HashMap<String, ActiveSession>,
) -> Vec<Session> {
    let mut all = sessions.to_vec();
    for a in active.values() {
        all.push(a.snapshot());
    }
    all
}

/// Последние 7 дней (локальное время) от старого к сегодняшнему.
fn week_from(per_day: &BTreeMap<String, u64>) -> Vec<WeekDay> {
    let today = Local::now().date_naive();
    (0..7)
        .rev()
        .map(|i| {
            let d = today - chrono::Duration::days(i);
            let key = d.format("%Y-%m-%d").to_string();
            let seconds = per_day.get(&key).copied().unwrap_or(0);
            WeekDay { date: key, seconds }
        })
        .collect()
}

/// Витрина ачивок: чистая функция от данных, без доступа к AppState.
fn achievement_views(
    defs: &[AchievementDef],
    sessions: &[Session],
    game_count: u32,
    unlocked_map: &HashMap<String, String>,
) -> Vec<AchievementView> {
    let stats = engine::compute(sessions);
    let ctx = EvalContext { game_count };
    engine::evaluate(defs, &stats, &ctx)
        .into_iter()
        .map(|o| {
            let def = defs.iter().find(|d| d.id == o.id);
            let (progress_value, threshold, unit, decimals) = match def {
                Some(d) => display_units(
                    &d.condition,
                    o.progress_value.unwrap_or(0.0),
                    o.threshold.unwrap_or(0.0),
                ),
                None => (0.0, 0.0, String::new(), 0),
            };
            AchievementView {
                id: o.id.clone(),
                title: def.map(|d| d.title.clone()).unwrap_or_default(),
                description: def.map(|d| d.description.clone()).unwrap_or_default(),
                icon: def.map(|d| d.icon.clone()).unwrap_or_default(),
                unlocked: o.unlocked || unlocked_map.contains_key(&o.id),
                unlocked_at: unlocked_map.get(&o.id).cloned(),
                progress: o.progress,
                progress_value,
                threshold,
                unit,
                decimals,
            }
        })
        .collect()
}

/// Перевод «сырых» значений условия в единицы, которые показывает интерфейс.
fn display_units(cond: &Condition, value: f64, threshold: f64) -> (f64, f64, String, u8) {
    match cond {
        Condition::TotalSeconds { .. } | Condition::SessionSeconds { .. } => {
            (value / 3600.0, threshold / 3600.0, "ч".into(), 1)
        }
        Condition::SessionCount { .. }
        | Condition::GameCount { .. }
        | Condition::DistinctGames { .. } => (value, threshold, "шт".into(), 0),
        Condition::StreakDays { .. } => (value, threshold, "дн".into(), 0),
        Condition::SessionStartHour { .. } => (value, threshold, String::new(), 0),
    }
}

// ---------------------------------------------------------------------------
// Запись/чтение подписанных файлов
// ---------------------------------------------------------------------------

fn path_of(state: &AppState, name: &str) -> PathBuf {
    state.data_dir.join(name)
}

fn write_games(state: &AppState, snapshot: &[Game]) -> Result<(), String> {
    integrity::save_signed(&state.signer, &path_of(state, "games.json"), &snapshot)
}

fn write_sessions(state: &AppState, snapshot: &[Session]) -> Result<(), String> {
    integrity::save_signed(&state.signer, &path_of(state, "sessions.json"), &snapshot)
}

fn write_unlocked(state: &AppState) -> Result<(), String> {
    let snapshot = state.unlocked.lock().unwrap().clone();
    integrity::save_signed(
        &state.signer,
        &path_of(state, "achievements.json"),
        &snapshot,
    )
}

fn write_settings(state: &AppState, value: &Settings) -> Result<(), String> {
    integrity::save_signed(&state.signer, &path_of(state, "settings.json"), value)
}

fn write_meta(state: &AppState) -> Result<(), String> {
    let snapshot = {
        let mut meta = state.meta.lock().unwrap();
        meta.last_seen = now_ts();
        meta.clone()
    };
    integrity::save_signed(&state.signer, &path_of(state, "meta.json"), &snapshot)
}

/// Снимок под lock, запись после drop.
fn persist_games(state: &AppState) {
    let snapshot = state.games.lock().unwrap().clone();
    if let Err(e) = write_games(state, &snapshot) {
        eprintln!("nyx store: {}", e);
    }
}

fn persist_sessions(state: &AppState, snapshot: &[Session]) {
    if let Err(e) = write_sessions(state, snapshot) {
        eprintln!("nyx store: {}", e);
    }
}

fn warnings_snapshot(state: &AppState) -> Vec<String> {
    let mut out = state.tampered.lock().unwrap().clone();
    if *state.clock_rollback.lock().unwrap() {
        out.push(
            "Системные часы переведены назад. Время сессий считается по монотонному таймеру, но даты могут выглядеть странно."
                .into(),
        );
    }
    out
}

// ---------------------------------------------------------------------------
// Команды: сводка
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_summary(state: State<AppState>) -> Summary {
    // порядок: games → sessions → active → unlocked; снимки под lock, работа после drop
    let (games_snapshot, all_sessions, active_snapshot, game_count, unlocked_map) = {
        let games = state.games.lock().unwrap();
        let sessions = state.sessions.lock().unwrap();
        let active = state.active.lock().unwrap();
        let unlocked_map = state.unlocked.lock().unwrap().clone();
        let active_snapshot: HashMap<String, (i64, i64)> = active
            .iter()
            .map(|(k, a)| (k.clone(), (a.start, a.end())))
            .collect();
        (
            games.clone(),
            all_sessions_snapshot(&sessions, &active),
            active_snapshot,
            games.len() as u32,
            unlocked_map,
        )
    };

    let game_views: Vec<GameView> = games_snapshot
        .iter()
        .map(|g| {
            // live — только текущая незакрытая сессия этой игры
            let live = active_snapshot
                .get(&g.id)
                .map(|(start, end)| (*end - *start).max(0) as u64)
                .unwrap_or(0);
            GameView {
                id: g.id.clone(),
                name: g.name.clone(),
                exe_path: g.exe_path.clone(),
                seconds_played: g.seconds_played + live,
                last_played: g.last_played.clone(),
                args: g.args.clone(),
                work_dir: g.work_dir.clone(),
                exe_hash: g.exe_hash.clone(),
                added_at: g.added_at,
                playing: active_snapshot.contains_key(&g.id),
                playing_since: active_snapshot.get(&g.id).map(|(start, _)| *start),
            }
        })
        .collect();

    let stats = engine::compute(&all_sessions);
    let tracker_paused = state.settings.lock().unwrap().tracker_paused;

    Summary {
        games: game_views,
        totals: Totals {
            seconds: stats.total_seconds,
            week: week_from(&stats.per_day),
            streak_days: stats.streak_days,
            longest_session_seconds: stats.longest_session_seconds,
            sessions_count: stats.sessions_count,
        },
        achievements: achievement_views(&state.defs, &all_sessions, game_count, &unlocked_map),
        tracker_paused,
        warnings: warnings_snapshot(&state),
    }
}

#[tauri::command]
fn get_game_stats(state: State<AppState>, id: String) -> Result<GameStats, String> {
    let (mine, last_played) = {
        let games = state.games.lock().unwrap();
        let game = games.iter().find(|g| g.id == id).ok_or("Игра не найдена")?;
        let last_played = game.last_played.clone();
        let sessions = state.sessions.lock().unwrap();
        let active = state.active.lock().unwrap();
        let mut mine: Vec<Session> = sessions
            .iter()
            .filter(|s| s.game_id == id)
            .cloned()
            .collect();
        // вклад текущей незакрытой сессии — как в get_summary
        if let Some(a) = active.get(&id) {
            mine.push(a.snapshot());
        }
        (mine, last_played)
    };

    let st = engine::compute(&mine);
    let today = Local::now().date_naive().format("%Y-%m-%d").to_string();

    Ok(GameStats {
        total_seconds: st.total_seconds,
        today_seconds: st.per_day.get(&today).copied().unwrap_or(0),
        longest_session_seconds: st.longest_session_seconds,
        last_played,
        // активная сессия уже внутри mine — счётчики согласованы с get_summary
        sessions_count: st.sessions_count,
        week: week_from(&st.per_day),
    })
}

// ---------------------------------------------------------------------------
// Команды: библиотека
// ---------------------------------------------------------------------------

#[tauri::command]
fn add_game(state: State<AppState>, exe_path: String) -> Result<Game, String> {
    winutil::validate_game_exe(&exe_path)?;
    let normalized = norm_path(&exe_path);
    // Хеш и имя считаем ДО захвата блокировок: чтение большого exe
    // не должно останавливать сводку и трекер.
    let name = Path::new(&exe_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or("Не удалось получить имя игры")?;
    let exe_hash = integrity::sha256_file(Path::new(&exe_path));

    let _write = state.write_lock.lock().unwrap();
    let (game, snapshot) = {
        let mut games = state.games.lock().unwrap();
        if games.iter().any(|g| norm_path(&g.exe_path) == normalized) {
            return Err("Эта игра уже в библиотеке".into());
        }

        let game = Game {
            id: format!("g_{}", Local::now().timestamp_millis()),
            name,
            exe_hash,
            exe_path,
            seconds_played: 0,
            last_played: None,
            args: String::new(),
            work_dir: None,
            added_at: now_ts(),
        };
        games.push(game.clone());
        (game, games.clone())
    };
    if let Err(e) = write_games(&state, &snapshot) {
        // Не оставляем игру только в памяти: иначе повторное добавление
        // скажет «уже в библиотеке», а после перезапуска она исчезнет.
        let mut games = state.games.lock().unwrap();
        games.retain(|g| g.id != game.id);
        return Err(format!("Не удалось сохранить библиотеку: {}", e));
    }
    Ok(game)
}

#[tauri::command]
fn remove_game(state: State<AppState>, id: String) -> Result<(), String> {
    let _write = state.write_lock.lock().unwrap();
    let (games_snapshot, sessions_snapshot) = {
        let mut games = state.games.lock().unwrap();
        let len_before = games.len();
        games.retain(|g| g.id != id);
        if games.len() == len_before {
            return Err("Игра не найдена".into());
        }
        let mut sessions = state.sessions.lock().unwrap();
        sessions.retain(|s| s.game_id != id);
        state.active.lock().unwrap().remove(&id);
        state.launched.lock().unwrap().remove(&id);
        (games.clone(), sessions.clone())
    };
    // Сессии пишем первыми: если вторая запись сорвётся, «призрачных» сессий
    // удалённой игры не останется — игра просто вернётся с нулём часов.
    write_sessions(&state, &sessions_snapshot)
        .map_err(|e| format!("Не удалось сохранить сессии: {}", e))?;
    write_games(&state, &games_snapshot)
        .map_err(|e| format!("Не удалось сохранить библиотеку: {}", e))?;
    state.icons.lock().unwrap().remove(&id);
    let _ = std::fs::remove_file(icon_path(&state, &id));
    Ok(())
}

/// Изменить название, аргументы запуска и рабочую папку.
#[tauri::command]
fn update_game(
    state: State<AppState>,
    id: String,
    name: String,
    args: String,
    work_dir: String,
) -> Result<Game, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Название не может быть пустым".into());
    }
    if name.chars().count() > 120 {
        return Err("Слишком длинное название (максимум 120 символов)".into());
    }
    let args = args.trim().to_string();
    if args.chars().count() > 2000 {
        return Err("Слишком длинная строка аргументов".into());
    }
    let work_dir = work_dir.trim().to_string();
    let work_dir = if work_dir.is_empty() {
        None
    } else {
        if !Path::new(&work_dir).is_dir() {
            return Err("Рабочая папка не найдена".into());
        }
        Some(work_dir)
    };

    let _write = state.write_lock.lock().unwrap();
    let (game, snapshot) = {
        let mut games = state.games.lock().unwrap();
        let g = games
            .iter_mut()
            .find(|g| g.id == id)
            .ok_or("Игра не найдена")?;
        g.name = name;
        g.args = args;
        g.work_dir = work_dir;
        (g.clone(), games.clone())
    };
    write_games(&state, &snapshot)?;
    Ok(game)
}

/// Перепроверить exe после обновления игры: заново валидирует файл,
/// считает хеш и сбрасывает кеш иконки.
#[tauri::command]
fn refresh_exe(state: State<AppState>, id: String) -> Result<Game, String> {
    let exe = {
        let games = state.games.lock().unwrap();
        let g = games.iter().find(|g| g.id == id).ok_or("Игра не найдена")?;
        g.exe_path.clone()
    };
    winutil::validate_game_exe(&exe)?;
    let hash =
        integrity::sha256_file(Path::new(&exe)).ok_or("Не удалось вычислить хеш exe-файла")?;

    let _write = state.write_lock.lock().unwrap();
    let (game, snapshot) = {
        let mut games = state.games.lock().unwrap();
        let g = games
            .iter_mut()
            .find(|g| g.id == id)
            .ok_or("Игра не найдена")?;
        g.exe_hash = Some(hash);
        (g.clone(), games.clone())
    };
    write_games(&state, &snapshot)?;
    state.icons.lock().unwrap().remove(&id);
    let _ = std::fs::remove_file(icon_path(&state, &id));
    Ok(game)
}

/// Разбор строки аргументов «как в ярлыке Windows»: кавычки группируют.
fn split_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let mut touched = false;
    for c in s.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                touched = true;
            }
            c if c.is_whitespace() && !quoted => {
                if touched || !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                    touched = false;
                }
            }
            c => {
                cur.push(c);
                touched = true;
            }
        }
    }
    if touched || !cur.is_empty() {
        out.push(cur);
    }
    out
}

#[tauri::command]
fn launch_game(app: AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    let (game, strict, minimize) = {
        let games = state.games.lock().unwrap();
        let game = games
            .iter()
            .find(|g| g.id == id)
            .ok_or("Игра не найдена")?
            .clone();
        let s = state.settings.lock().unwrap();
        (game, s.strict_anticheat, s.minimize_on_launch)
    };

    // Строгий режим: подмена exe после добавления не должна запускаться.
    if strict {
        let hash = game
            .exe_hash
            .as_ref()
            .ok_or("У игры нет контрольной суммы. Нажмите «Обновить exe».")?;
        match integrity::sha256_file(Path::new(&game.exe_path)) {
            Some(actual) if &actual == hash => {}
            _ => {
                return Err(
                    "Exe-файл изменился после добавления. Если игра обновилась — нажмите «Обновить exe» в карточке."
                        .into(),
                )
            }
        }
    }
    winutil::validate_game_exe(&game.exe_path)?;

    let exe = PathBuf::from(&game.exe_path);
    // Игры часто ищут ресурсы/пишут конфиги относительно своей папки,
    // поэтому рабочей директорией по умолчанию делаем каталог exe.
    let work_dir = game
        .work_dir
        .as_deref()
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| exe.parent().map(Path::to_path_buf));

    let mut cmd = std::process::Command::new(&exe);
    if let Some(dir) = &work_dir {
        cmd.current_dir(dir);
    }
    let args = split_args(&game.args);
    if !args.is_empty() {
        cmd.args(&args);
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("Не удалось запустить: {}", e))?;

    // Запоминаем PID: в строгом режиме считаем только этот процесс.
    state
        .launched
        .lock()
        .unwrap()
        .insert(id.clone(), child.id());

    // last_played фиксируем только после успешного запуска.
    {
        let _write = state.write_lock.lock().unwrap();
        {
            let mut games = state.games.lock().unwrap();
            if let Some(g) = games.iter_mut().find(|g| g.id == id) {
                g.last_played = Some(now_rfc3339());
            }
        }
        persist_games(&state);
    }

    if minimize {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.hide();
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Команды: настройки
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
struct SettingsView {
    settings: Settings,
    autostart_enabled: bool,
    data_dir: String,
    version: String,
    install_id: String,
    tampered: Vec<String>,
    clock_rollback: bool,
}

fn settings_view(state: &AppState) -> SettingsView {
    SettingsView {
        settings: state.settings.lock().unwrap().clone(),
        autostart_enabled: settings::autostart_enabled(),
        data_dir: state.data_dir.to_string_lossy().to_string(),
        version: env!("CARGO_PKG_VERSION").into(),
        install_id: state.meta.lock().unwrap().install_id.clone(),
        tampered: state.tampered.lock().unwrap().clone(),
        clock_rollback: *state.clock_rollback.lock().unwrap(),
    }
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> SettingsView {
    settings_view(&state)
}

#[tauri::command]
fn set_settings(
    app: AppHandle,
    state: State<AppState>,
    next: Settings,
) -> Result<SettingsView, String> {
    let mut next = next;
    next.sanitize();

    let prev_autostart = state.settings.lock().unwrap().autostart;
    // Автозапуск трогаем только при изменении или при включении
    // (перезапись чинит путь, если exe переехал).
    if next.autostart || prev_autostart != next.autostart {
        settings::set_autostart(next.autostart)?;
    }

    {
        let mut current = state.settings.lock().unwrap();
        *current = next.clone();
    }
    write_settings(&state, &next)?;

    // Синхронизируем галочку в трее.
    if let Some(item) = state.tray_pause.lock().unwrap().as_ref() {
        let _ = item.set_checked(next.tracker_paused);
    }

    let _ = app.emit("settings-changed", &next);
    Ok(settings_view(&state))
}

#[tauri::command]
fn open_data_dir(state: State<AppState>) -> Result<(), String> {
    winutil::open_dir(&state.data_dir)
}

// ---------------------------------------------------------------------------
// Команды: иконки
// ---------------------------------------------------------------------------

fn safe_id(id: &str) -> String {
    let s: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    if s.is_empty() {
        "game".into()
    } else {
        s
    }
}

fn icon_path(state: &AppState, id: &str) -> PathBuf {
    state
        .data_dir
        .join("icons")
        .join(format!("{}.png", safe_id(id)))
}

/// Иконки exe в виде data:URL. Извлекаются один раз и кешируются на диске.
#[tauri::command]
fn get_icons(state: State<AppState>) -> Result<HashMap<String, String>, String> {
    let games: Vec<(String, String)> = {
        let games = state.games.lock().unwrap();
        games
            .iter()
            .map(|g| (g.id.clone(), g.exe_path.clone()))
            .collect()
    };

    // Кеш в памяти читаем под коротким локом; извлечение иконок — уже без него,
    // чтобы первый показ полки не блокировал удаление/обновление игр.
    let mut out: HashMap<String, String> = {
        let mut cache = state.icons.lock().unwrap();
        cache.retain(|k, _| games.iter().any(|(id, _)| id == k));
        cache.clone()
    };

    for (id, exe) in games {
        if out.contains_key(&id) {
            continue;
        }
        let path = icon_path(&state, &id);
        let bytes = match std::fs::read(&path) {
            Ok(b) => Some(b),
            Err(_) => {
                let b = winutil::extract_icon_png(&exe);
                if let Some(data) = &b {
                    if let Some(parent) = path.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    let _ = std::fs::write(&path, data);
                }
                b
            }
        };
        if let Some(data) = bytes {
            use base64::Engine;
            let url = format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(&data)
            );
            state.icons.lock().unwrap().insert(id.clone(), url.clone());
            out.insert(id, url);
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Команды: история сессий
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
struct SessionView {
    id: String,
    game_id: String,
    start: i64,
    end: i64,
    seconds: u64,
    manual: bool,
    active: bool,
}

#[tauri::command]
fn get_sessions(state: State<AppState>, id: String) -> Result<Vec<SessionView>, String> {
    let mut out: Vec<SessionView> = {
        let games = state.games.lock().unwrap();
        if !games.iter().any(|g| g.id == id) {
            return Err("Игра не найдена".into());
        }
        let sessions = state.sessions.lock().unwrap();
        let active = state.active.lock().unwrap();
        let mut v: Vec<SessionView> = sessions
            .iter()
            .filter(|s| s.game_id == id)
            .map(|s| SessionView {
                id: s.id.clone(),
                game_id: s.game_id.clone(),
                start: s.start,
                end: s.end,
                seconds: (s.end - s.start).max(0) as u64,
                manual: s.manual,
                active: false,
            })
            .collect();
        if let Some(a) = active.get(&id) {
            v.push(SessionView {
                id: format!("active_{}", a.start),
                game_id: id.clone(),
                start: a.start,
                end: a.end(),
                seconds: a.seconds(),
                manual: false,
                active: true,
            });
        }
        v
    };
    out.sort_by_key(|a| std::cmp::Reverse(a.start));
    Ok(out)
}

fn parse_local_dt(s: &str) -> Result<i64, String> {
    let s = s.trim();
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Ok(dt.timestamp());
    }
    for fmt in [
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
    ] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(s, fmt) {
            return naive
                .and_local_timezone(Local)
                .earliest()
                .map(|d| d.timestamp())
                .ok_or_else(|| "Некорректное локальное время".to_string());
        }
    }
    Err("Некорректная дата/время".into())
}

fn recompute_game_seconds(games: &mut [Game], sessions: &[Session]) {
    for g in games.iter_mut() {
        g.seconds_played = sessions
            .iter()
            .filter(|s| s.game_id == g.id)
            .map(|s| (s.end - s.start).max(0) as u64)
            .sum();
    }
}

fn ensure_session_ids(sessions: &mut [Session]) {
    for (i, s) in sessions.iter_mut().enumerate() {
        if s.id.is_empty() {
            s.id = format!("s_{}_{}", s.start, i);
        }
    }
}

/// Ручная правка истории: добавить сессию задним числом.
/// Потолок — «сейчас»: намотать будущее нельзя.
#[tauri::command]
fn add_manual_session(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    start: String,
    minutes: u64,
) -> Result<SessionView, String> {
    if minutes == 0 || minutes > 24 * 60 {
        return Err("Длительность должна быть от 1 минуты до 24 часов".into());
    }
    let start_ts = parse_local_dt(&start)?;
    let now = now_ts();
    if start_ts > now + 300 {
        return Err("Нельзя добавить сессию в будущем".into());
    }
    let end_ts = (start_ts + minutes as i64 * 60).min(now);
    if end_ts <= start_ts {
        return Err("Сессия должна заканчиваться в прошлом".into());
    }

    let _write = state.write_lock.lock().unwrap();
    let (view, games_snapshot, sessions_snapshot) = {
        let mut games = state.games.lock().unwrap();
        if !games.iter().any(|g| g.id == id) {
            return Err("Игра не найдена".into());
        }
        let mut sessions = state.sessions.lock().unwrap();
        let session = Session {
            game_id: id.clone(),
            start: start_ts,
            end: end_ts,
            id: format!("m_{}_{}", Local::now().timestamp_millis(), sessions.len()),
            manual: true,
        };
        sessions.push(session.clone());
        recompute_game_seconds(&mut games, &sessions);
        let view = SessionView {
            id: session.id.clone(),
            game_id: session.game_id.clone(),
            start: session.start,
            end: session.end,
            seconds: (session.end - session.start).max(0) as u64,
            manual: true,
            active: false,
        };
        (view, games.clone(), sessions.clone())
    };
    write_sessions(&state, &sessions_snapshot)?;
    write_games(&state, &games_snapshot)?;
    let _ = app.emit("library-changed", ());
    Ok(view)
}

#[tauri::command]
fn delete_session(app: AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    let _write = state.write_lock.lock().unwrap();
    let (games_snapshot, sessions_snapshot) = {
        let mut games = state.games.lock().unwrap();
        let mut sessions = state.sessions.lock().unwrap();
        let before = sessions.len();
        sessions.retain(|s| s.id != id);
        if sessions.len() == before {
            return Err("Сессия не найдена".into());
        }
        recompute_game_seconds(&mut games, &sessions);
        (games.clone(), sessions.clone())
    };
    write_sessions(&state, &sessions_snapshot)?;
    write_games(&state, &games_snapshot)?;
    let _ = app.emit("library-changed", ());
    Ok(())
}

/// Сброс статистики: одной игры или всей библиотеки.
#[tauri::command]
fn reset_stats(app: AppHandle, state: State<AppState>, id: Option<String>) -> Result<(), String> {
    let _write = state.write_lock.lock().unwrap();
    let (games_snapshot, sessions_snapshot) = {
        let mut games = state.games.lock().unwrap();
        let mut sessions = state.sessions.lock().unwrap();
        match &id {
            Some(gid) => {
                if !games.iter().any(|g| &g.id == gid) {
                    return Err("Игра не найдена".into());
                }
                sessions.retain(|s| &s.game_id != gid);
                if let Some(g) = games.iter_mut().find(|g| &g.id == gid) {
                    g.seconds_played = 0;
                    g.last_played = None;
                }
            }
            None => {
                sessions.clear();
                for g in games.iter_mut() {
                    g.seconds_played = 0;
                    g.last_played = None;
                }
                state.unlocked.lock().unwrap().clear();
            }
        }
        (games.clone(), sessions.clone())
    };
    write_sessions(&state, &sessions_snapshot)?;
    write_games(&state, &games_snapshot)?;
    if id.is_none() {
        write_unlocked(&state)?;
    }
    let _ = app.emit("library-changed", ());
    Ok(())
}

// ---------------------------------------------------------------------------
// Команды: экспорт / импорт
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct DataBundle {
    #[serde(default)]
    schema: u32,
    #[serde(default)]
    exported_at: String,
    #[serde(default)]
    games: Vec<Game>,
    #[serde(default)]
    sessions: Vec<Session>,
    #[serde(default)]
    unlocked: HashMap<String, String>,
    #[serde(default)]
    settings: Option<Settings>,
}

#[tauri::command]
fn export_data(state: State<AppState>, path: String) -> Result<String, String> {
    let (games, sessions, unlocked, settings) = {
        let games = state.games.lock().unwrap().clone();
        let sessions = state.sessions.lock().unwrap().clone();
        let active = state.active.lock().unwrap();
        let all = all_sessions_snapshot(&sessions, &active);
        let unlocked = state.unlocked.lock().unwrap().clone();
        let settings = state.settings.lock().unwrap().clone();
        (games, all, unlocked, settings)
    };
    let bundle = DataBundle {
        schema: 2,
        exported_at: now_rfc3339(),
        games,
        sessions,
        unlocked,
        settings: Some(settings),
    };
    let envelope = state.signer.wrap(&bundle)?;
    let p = PathBuf::from(&path);
    store::save_json(&p, &envelope)?;
    Ok(path)
}

#[tauri::command]
fn import_data(app: AppHandle, state: State<AppState>, path: String) -> Result<String, String> {
    let text =
        std::fs::read_to_string(&path).map_err(|e| format!("Не удалось прочитать файл: {}", e))?;
    let value: Value =
        serde_json::from_str(&text).map_err(|e| format!("Это не файл резервной копии: {}", e))?;
    let bundle: DataBundle = state.signer.unwrap(&value).map_err(|e| {
        format!(
            "Копия повреждена или сделана на другой машине/установке ({}).",
            e
        )
    })?;

    let _write = state.write_lock.lock().unwrap();
    let mut games = bundle.games;
    let mut sessions = bundle.sessions;
    if games.is_empty() && sessions.is_empty() {
        return Err("В файле нет данных".into());
    }
    for (i, g) in games.iter_mut().enumerate() {
        if g.id.is_empty() {
            g.id = format!("g_import_{}", i);
        }
    }
    engine::dedupe_sessions(&mut sessions);
    ensure_session_ids(&mut sessions);
    sessions.retain(|s| games.iter().any(|g| g.id == s.game_id));
    recompute_game_seconds(&mut games, &sessions);

    {
        *state.games.lock().unwrap() = games.clone();
        *state.sessions.lock().unwrap() = sessions.clone();
        *state.unlocked.lock().unwrap() = bundle.unlocked;
        if let Some(mut s) = bundle.settings {
            s.sanitize();
            *state.settings.lock().unwrap() = s;
        }
        state.active.lock().unwrap().clear();
        state.launched.lock().unwrap().clear();
    }

    let autostart = state.settings.lock().unwrap().autostart;
    let _ = settings::set_autostart(autostart);
    let paused = state.settings.lock().unwrap().tracker_paused;
    if let Some(item) = state.tray_pause.lock().unwrap().as_ref() {
        let _ = item.set_checked(paused);
    }

    write_games(&state, &games)?;
    write_sessions(&state, &sessions)?;
    write_unlocked(&state)?;
    {
        let settings = state.settings.lock().unwrap().clone();
        write_settings(&state, &settings)?;
    }

    // Иконки могли быть от других exe с теми же id — сбрасываем кеш.
    state.icons.lock().unwrap().clear();
    let _ = std::fs::remove_dir_all(state.data_dir.join("icons"));

    let _ = app.emit("library-changed", ());
    let _ = app.emit("settings-changed", &state.settings.lock().unwrap().clone());
    Ok(format!(
        "Восстановлено: {} игр, {} сессий",
        games.len(),
        sessions.len()
    ))
}

// ---------------------------------------------------------------------------
// Трекер
// ---------------------------------------------------------------------------

/// Закрытые сессии: фильтр по минимальной длительности, запись сессий и часов.
/// Возвращает true, если что-то записано.
fn record_closed(state: &AppState, closed: &[ActiveSession], min_secs: u64) -> bool {
    if closed.is_empty() {
        return false;
    }
    let _write = state.write_lock.lock().unwrap();
    let mut changed = false;
    {
        let mut games = state.games.lock().unwrap();
        let mut sessions = state.sessions.lock().unwrap();
        let mut launched = state.launched.lock().unwrap();
        for a in closed {
            launched.remove(&a.game_id);
            let secs = a.seconds();
            if secs < min_secs {
                continue;
            }
            if let Some(g) = games.iter_mut().find(|g| g.id == a.game_id) {
                sessions.push(a.snapshot());
                g.seconds_played = g.seconds_played.saturating_add(secs);
                changed = true;
            }
        }
    }
    if changed {
        let snapshot = {
            let sessions = state.sessions.lock().unwrap();
            let active = state.active.lock().unwrap();
            all_sessions_snapshot(&sessions, &active)
        };
        persist_sessions(state, &snapshot);
    }
    changed
}

fn close_all_active(state: &AppState, min_secs: u64) -> bool {
    let closed: Vec<ActiveSession> = {
        let mut active = state.active.lock().unwrap();
        let v: Vec<ActiveSession> = active.values().cloned().collect();
        active.clear();
        v
    };
    record_closed(state, &closed, min_secs)
}

/// Каждый тик: сессии открываются/продлеваются/закрываются по живым процессам,
/// ачивки переоцениваются, новые открываются и сохраняются.
fn spawn_tracker(app: AppHandle) {
    thread::spawn(move || {
        let mut last_meta = now_ts();
        loop {
            let state = app.state::<AppState>();
            let (poll, paused, require_window, strict, direct, min_secs) = {
                let s = state.settings.lock().unwrap();
                (
                    s.poll_secs.clamp(2, 60),
                    s.tracker_paused,
                    s.require_window,
                    s.strict_anticheat,
                    s.count_direct_launch,
                    s.min_session_secs,
                )
            };
            thread::sleep(Duration::from_secs(poll));

            // Пауза: закрываем активные сессии, засчитав уже накопленное,
            // и не открываем новые, пока паузу не снимут.
            if paused {
                if close_all_active(&state, min_secs) {
                    let _ = app.emit("library-changed", ());
                }
                continue;
            }

            // матч по полному пути exe (нормализованному): одинаковые имена файлов
            // у разных игр больше не путают счётчик
            let wanted: Vec<(String, String)> = {
                let games = state.games.lock().unwrap();
                games
                    .iter()
                    .map(|g| (g.id.clone(), norm_path(&g.exe_path)))
                    .collect()
            };
            if wanted.is_empty() {
                // Активные сессии удалённых игр всё равно надо закрыть.
                if close_all_active(&state, min_secs) {
                    let _ = app.emit("library-changed", ());
                }
                continue;
            }

            // Не тянем диски/сети/компоненты, как new_all(): для трекера нужны
            // только процессы и их exe.
            let mut sys = sysinfo::System::new();
            sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
            let mut procs: HashMap<String, Vec<u32>> = HashMap::new();
            for (pid, p) in sys.processes() {
                if let Some(exe) = p.exe() {
                    procs
                        .entry(norm_path(&exe.to_string_lossy()))
                        .or_default()
                        .push(pid.as_u32());
                }
            }

            let launched = state.launched.lock().unwrap().clone();
            let ts = now_ts();
            let mut changed = false;
            let mut any_playing = false;
            let mut closed: Vec<ActiveSession> = Vec::new();

            // Окна проверяем ДО захвата active: перебор окон не должен
            // блокировать get_summary.
            let mut states: Vec<(String, bool)> = Vec::with_capacity(wanted.len());
            for (id, exe) in &wanted {
                let pids = procs.get(exe);
                let launched_pid = launched.get(id).copied();
                let mut ok = pids.is_some();
                if let Some(pids) = pids {
                    if strict {
                        // Только процесс, запущенный лаунчером, и только с окном.
                        ok = launched_pid.is_some_and(|pid| pids.contains(&pid));
                    } else if !direct {
                        ok = launched_pid.is_some();
                    }
                    if ok && (require_window || strict) {
                        ok = winutil::has_visible_window(pids);
                    }
                }
                states.push((id.clone(), ok));
            }

            {
                let mut active = state.active.lock().unwrap();
                for (id, ok) in &states {
                    if *ok {
                        any_playing = true;
                        if let std::collections::hash_map::Entry::Vacant(e) =
                            active.entry(id.clone())
                        {
                            e.insert(ActiveSession::new(id, ts));
                            changed = true;
                        }
                    } else if let Some(a) = active.remove(id) {
                        changed = true;
                        closed.push(a);
                    }
                }
                // игра удалена из библиотеки, пока процесс был жив
                let known: HashSet<&String> = wanted.iter().map(|(id, _)| id).collect();
                let stale: Vec<String> = active
                    .keys()
                    .filter(|k| !known.contains(k))
                    .cloned()
                    .collect();
                for k in stale {
                    if let Some(a) = active.remove(&k) {
                        changed = true;
                        closed.push(a);
                    }
                }
            }

            // Закрытые сессии: games → sessions, запись после drop.
            let recorded = record_closed(&state, &closed, min_secs);

            // Ачивки: снимок под lock, расчёт и запись после drop
            let new_unlock = {
                let games = state.games.lock().unwrap();
                let sessions = state.sessions.lock().unwrap();
                let active = state.active.lock().unwrap();
                let all = all_sessions_snapshot(&sessions, &active);
                let game_count = games.len() as u32;
                let mut unlocked = state.unlocked.lock().unwrap();
                let outcomes = engine::evaluate(
                    &state.defs,
                    &engine::compute(&all),
                    &EvalContext { game_count },
                );
                let mut fresh = false;
                for o in outcomes {
                    if o.unlocked && !unlocked.contains_key(&o.id) {
                        unlocked.insert(o.id, now_rfc3339());
                        fresh = true;
                    }
                }
                let unlocked_snapshot = unlocked.clone();
                (fresh, unlocked_snapshot)
            };
            if new_unlock.0 {
                let _ = integrity::save_signed(
                    &state.signer,
                    &path_of(&state, "achievements.json"),
                    &new_unlock.1,
                );
            }

            // снимок сессий с активными — чтобы закрытие окна не теряло часы;
            // дубликаты схлопываются при следующей загрузке (dedupe_sessions)
            if any_playing || changed || recorded {
                let _write = state.write_lock.lock().unwrap();
                let snapshot = {
                    let sessions = state.sessions.lock().unwrap();
                    let active = state.active.lock().unwrap();
                    all_sessions_snapshot(&sessions, &active)
                };
                persist_sessions(&state, &snapshot);
            }

            if ts - last_meta >= 60 {
                last_meta = ts;
                let _ = write_meta(&state);
            }

            if changed || any_playing || new_unlock.0 {
                let _ = app.emit("library-changed", ());
            }
        }
    });
}

/// При выходе приложения: закрытые окна терять нельзя — фиксируем активные сессии.
fn commit_active_sessions(app: &AppHandle) {
    let state = app.state::<AppState>();
    let min_secs = state.settings.lock().unwrap().min_session_secs;
    close_all_active(&state, min_secs);
    let _ = write_meta(&state);
}

// ---------------------------------------------------------------------------
// Трей
// ---------------------------------------------------------------------------

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn toggle_pause(app: &AppHandle) {
    let state = app.state::<AppState>();
    let next = {
        let mut s = state.settings.lock().unwrap();
        s.tracker_paused = !s.tracker_paused;
        s.clone()
    };
    if let Err(e) = write_settings(&state, &next) {
        eprintln!("nyx store: {}", e);
    }
    if let Some(item) = state.tray_pause.lock().unwrap().as_ref() {
        let _ = item.set_checked(next.tracker_paused);
    }
    let _ = app.emit("settings-changed", &next);
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let paused = app
        .state::<AppState>()
        .settings
        .lock()
        .unwrap()
        .tracker_paused;
    let open = MenuItem::with_id(app, "open", "Открыть NyxLauncher", true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(
        app,
        "pause",
        "Пауза учёта времени",
        true,
        paused,
        None::<&str>,
    )?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &pause, &sep, &quit])?;

    {
        let state = app.state::<AppState>();
        *state.tray_pause.lock().unwrap() = Some(pause.clone());
    }

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("NyxLauncher")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "pause" => toggle_pause(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Загрузка с бэкапом
// ---------------------------------------------------------------------------

/// Загрузка подписанного файла с бэкапом:
///  * нет файла — (None, false);
///  * валидная подпись/старый формат — (Some, true);
///  * битая подпись — `*.tampered.bak` + предупреждение;
///  * битый JSON — `*.json.bak`.
fn load_file<T: DeserializeOwned>(
    signer: &Signer,
    path: &Path,
    tampered: &mut Vec<String>,
) -> (Option<T>, bool) {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    match integrity::load_signed::<T>(signer, path) {
        Ok(Loaded::Signed(v)) => (Some(v), true),
        Ok(Loaded::Legacy(v)) => (Some(v), true),
        Ok(Loaded::Missing) => (None, false),
        Ok(Loaded::Tampered(reason)) => {
            eprintln!("nyx integrity: {}: {}", path.display(), reason);
            let backup = path.with_extension("tampered.bak");
            if std::fs::rename(path, &backup).is_err() {
                let _ = std::fs::copy(path, &backup);
            }
            tampered.push(format!(
                "{} — подпись не совпала ({}). Файл сохранён как {}.",
                name,
                reason,
                backup
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default()
            ));
            (None, false)
        }
        Err(e) => {
            eprintln!("nyx store: {}: {}", path.display(), e);
            let backup = path.with_extension("json.bak");
            if std::fs::rename(path, &backup).is_err() {
                let _ = std::fs::copy(path, &backup);
            }
            (None, false)
        }
    }
}

fn random_install_id() -> String {
    let mut bytes = [0u8; 8];
    if getrandom::fill(&mut bytes).is_err() {
        return format!("{:x}", Local::now().timestamp_millis());
    }
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_summary,
            get_game_stats,
            add_game,
            remove_game,
            update_game,
            refresh_exe,
            launch_game,
            get_settings,
            set_settings,
            get_icons,
            open_data_dir,
            get_sessions,
            add_manual_session,
            delete_session,
            reset_stats,
            export_data,
            import_data
        ])
        .on_window_event(|window, event| {
            let state = window.state::<AppState>();
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if state.settings.lock().unwrap().close_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                tauri::WindowEvent::Resized(_) => {
                    let minimize_to_tray = state.settings.lock().unwrap().minimize_to_tray;
                    if minimize_to_tray && window.is_minimized().unwrap_or(false) {
                        let _ = window.hide();
                    }
                }
                _ => {}
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = handle
                .path()
                .app_data_dir()
                .expect("не удалось найти папку данных");
            std::fs::create_dir_all(&data_dir).ok();

            let signer = Signer::load_or_create(&data_dir)
                .map_err(|e| format!("Не удалось инициализировать защиту данных: {}", e))?;
            let mut tampered = Vec::new();

            let (games_loaded, games_present) =
                load_file::<Vec<Game>>(&signer, &data_dir.join("games.json"), &mut tampered);
            let (sessions_loaded, sessions_present) =
                load_file::<Vec<Session>>(&signer, &data_dir.join("sessions.json"), &mut tampered);
            let (unlocked_loaded, _) = load_file::<HashMap<String, String>>(
                &signer,
                &data_dir.join("achievements.json"),
                &mut tampered,
            );
            let (settings_loaded, _) =
                load_file::<Settings>(&signer, &data_dir.join("settings.json"), &mut tampered);
            let (meta_loaded, _) =
                load_file::<Meta>(&signer, &data_dir.join("meta.json"), &mut tampered);

            let mut games: Vec<Game> = games_loaded.unwrap_or_default();
            let mut sessions: Vec<Session> = sessions_loaded.unwrap_or_default();
            // активная сессия прошлой запуска могла попасть в файл снимком — схлопываем
            engine::dedupe_sessions(&mut sessions);
            ensure_session_ids(&mut sessions);
            let unlocked: HashMap<String, String> = unlocked_loaded.unwrap_or_default();
            let mut settings: Settings = settings_loaded.unwrap_or_default();
            settings.sanitize();
            let mut meta: Meta = meta_loaded.unwrap_or_default();
            if meta.install_id.is_empty() {
                meta.install_id = random_install_id();
            }

            // Откат системных часов: сессии считаются монотонно, но даты
            // в статистике могут поехать — честно предупреждаем.
            let now = now_ts();
            let clock_rollback = meta.last_seen > 0 && now + 300 < meta.last_seen;
            meta.last_seen = now;

            let defs: Vec<AchievementDef> =
                serde_json::from_str(ACHIEVEMENTS_JSON).expect("битый achievements.json");

            // Сессии удалённых игр не должны жить в статистике. Чистим только
            // когда оба файла реально прочитаны: иначе «пустая библиотека»
            // после сбоя чтения снесла бы все сессии.
            if games_present && sessions_present {
                sessions.retain(|s| games.iter().any(|g| g.id == s.game_id));
            }

            // секунды на витрине — истина из сессий; без прочитанных сессий
            // не обнуляем games.json
            if sessions_present {
                recompute_game_seconds(&mut games, &sessions);
            }

            app.manage(AppState {
                write_lock: Mutex::new(()),
                games: Mutex::new(games.clone()),
                sessions: Mutex::new(sessions.clone()),
                active: Mutex::new(HashMap::new()),
                unlocked: Mutex::new(unlocked.clone()),
                settings: Mutex::new(settings.clone()),
                icons: Mutex::new(HashMap::new()),
                launched: Mutex::new(HashMap::new()),
                meta: Mutex::new(meta.clone()),
                tampered: Mutex::new(tampered.clone()),
                clock_rollback: Mutex::new(clock_rollback),
                tray_pause: Mutex::new(None),
                signer,
                defs,
                data_dir: data_dir.clone(),
            });

            // Автозапуск: включаем/перезаписываем путь или убираем запись.
            if settings.autostart {
                let _ = settings::set_autostart(true);
            } else if settings::autostart_enabled() {
                let _ = settings::set_autostart(false);
            }

            // Первый запуск: сохраняем всё в подписанном формате (миграция v0.3).
            {
                let state = app.state::<AppState>();
                let _ = write_games(&state, &games);
                let _ = write_sessions(&state, &sessions);
                let _ = write_unlocked(&state);
                let _ = write_settings(&state, &settings);
                let _ = write_meta(&state);
            }

            build_tray(&handle)?;
            spawn_tracker(handle.clone());

            // Окно создаётся скрытым (без мигания), показываем, если не просили старт в трее.
            let minimized =
                settings.start_minimized || std::env::args().any(|a| a == "--minimized");
            if let Some(w) = app.get_webview_window("main") {
                if !minimized {
                    let _ = w.show();
                }
            }
            let _ = &handle;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("ошибка запуска NyxLauncher");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            commit_active_sessions(app_handle);
        }
    });
}
