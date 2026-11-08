mod engine;
mod store;

use chrono::Local;
use engine::{AchievementDef, EvalContext, Session};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

const TICK_SECS: u64 = 5;
const ACHIEVEMENTS_JSON: &str = include_str!("../achievements.json");

/// Игра в библиотеке.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Game {
    pub id: String,
    pub name: String,
    pub exe_path: String,
    pub seconds_played: u64,
    pub last_played: Option<String>,
}

/// Игра как её видит интерфейс: + флаг «запущена сейчас».
#[derive(Serialize, Clone, Debug)]
pub struct GameView {
    pub id: String,
    pub name: String,
    pub exe_path: String,
    pub seconds_played: u64,
    pub last_played: Option<String>,
    pub playing: bool,
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
}

#[derive(Serialize, Clone, Debug)]
struct Summary {
    games: Vec<GameView>,
    totals: Totals,
    achievements: Vec<AchievementView>,
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
    start: i64,
    end: i64,
}

impl ActiveSession {
    fn seconds(&self) -> u64 {
        (self.end - self.start).max(0) as u64
    }
}

impl From<&ActiveSession> for Session {
    fn from(a: &ActiveSession) -> Self {
        Session {
            game_id: a.game_id.clone(),
            start: a.start,
            end: a.end,
        }
    }
}

/// Глобальное состояние. ПРАВИЛО БЛОКИРОВОК: если нужно несколько мьютексов,
/// захватывать строго в порядке games → sessions → active → unlocked,
/// и никогда не захватывать уже удерживаемый повторно (std Mutex не реентерабелен).
/// ЗАПИСЬ НА ДИСК — только после drop всех guard'ов: файл может писать десятки мс.
struct AppState {
    games: Mutex<Vec<Game>>,
    sessions: Mutex<Vec<Session>>,
    active: Mutex<HashMap<String, ActiveSession>>,
    unlocked: Mutex<HashMap<String, String>>,
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
fn all_sessions_snapshot(sessions: &[Session], active: &HashMap<String, ActiveSession>) -> Vec<Session> {
    let mut all = sessions.to_vec();
    for a in active.values() {
        all.push(Session::from(a));
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
            AchievementView {
                id: o.id.clone(),
                title: def.map(|d| d.title.clone()).unwrap_or_default(),
                description: def.map(|d| d.description.clone()).unwrap_or_default(),
                icon: def.map(|d| d.icon.clone()).unwrap_or_default(),
                unlocked: o.unlocked || unlocked_map.contains_key(&o.id),
                unlocked_at: unlocked_map.get(&o.id).cloned(),
                progress: o.progress,
            }
        })
        .collect()
}

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
            .map(|(k, a)| (k.clone(), (a.start, a.end)))
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
                playing: active_snapshot.contains_key(&g.id),
            }
        })
        .collect();

    let stats = engine::compute(&all_sessions);

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
    }
}

#[tauri::command]
fn get_game_stats(state: State<AppState>, id: String) -> Result<GameStats, String> {
    let (mut mine, _active_open, last_played) = {
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
            mine.push(Session::from(a));
        }
        (mine, active.contains_key(&id), last_played)
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

/// Запись games.json: снимок под lock, запись после drop.
fn persist_games(state: &AppState) {
    let snapshot = state.games.lock().unwrap().clone();
    store::save_json(&state.data_dir.join("games.json"), &snapshot)
        .map_err(|e| eprintln!("nyx store: {}", e))
        .ok();
}

fn persist_sessions(state: &AppState, snapshot: &[Session]) {
    store::save_json(&state.data_dir.join("sessions.json"), &snapshot)
        .map_err(|e| eprintln!("nyx store: {}", e))
        .ok();
}

#[tauri::command]
fn add_game(state: State<AppState>, exe_path: String) -> Result<Game, String> {
    if !exe_path.to_lowercase().ends_with(".exe") {
        return Err("Это не exe-файл".into());
    }
    let (game, snapshot) = {
        let mut games = state.games.lock().unwrap();
        if games
            .iter()
            .any(|g| g.exe_path.eq_ignore_ascii_case(&exe_path))
        {
            return Err("Эта игра уже в библиотеке".into());
        }
        let name = std::path::Path::new(&exe_path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .ok_or("Не удалось получить имя игры")?;

        let game = Game {
            id: format!("g_{}", Local::now().timestamp_millis()),
            name,
            exe_path,
            seconds_played: 0,
            last_played: None,
        };
        games.push(game.clone());
        (game, games.clone())
    };
    store::save_json(&state.data_dir.join("games.json"), &snapshot)
        .map_err(|e| format!("Не удалось сохранить библиотеку: {}", e))?;
    Ok(game)
}

#[tauri::command]
fn remove_game(state: State<AppState>, id: String) -> Result<(), String> {
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
        (games.clone(), sessions.clone())
    };
    store::save_json(&state.data_dir.join("games.json"), &games_snapshot)
        .map_err(|e| format!("Не удалось сохранить библиотеку: {}", e))?;
    persist_sessions(&state, &sessions_snapshot);
    Ok(())
}

#[tauri::command]
fn launch_game(state: State<AppState>, id: String) -> Result<(), String> {
    let exe = {
        let games = state.games.lock().unwrap();
        let game = games.iter().find(|g| g.id == id).ok_or("Игра не найдена")?;
        game.exe_path.clone()
    };
    {
        let mut games = state.games.lock().unwrap();
        if let Some(g) = games.iter_mut().find(|g| g.id == id) {
            g.last_played = Some(now_rfc3339());
        }
    }
    persist_games(&state);
    std::process::Command::new(&exe)
        .spawn()
        .map_err(|e| format!("Не удалось запустить: {}", e))?;
    Ok(())
}

/// Нормализация пути для сравнения: единый разделитель + нижний регистр.
fn norm_path(p: &str) -> String {
    p.replace('/', "\\").to_lowercase()
}

/// Каждый тик: сессии открываются/продлеваются/закрываются по живым процессам,
/// ачивки переоцениваются, новые открываются и сохраняются.
fn spawn_tracker(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(TICK_SECS));

        let state = app.state::<AppState>();
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
            continue;
        }

        let sys = sysinfo::System::new_all();
        let running: std::collections::HashSet<String> = sys
            .processes()
            .values()
            .filter_map(|p| p.exe())
            .map(|e| norm_path(&e.to_string_lossy()))
            .collect();

        let ts = now_ts();
        let mut changed = false;
        let mut any_playing = false;

        // 1) обновляем активные сессии; закрывшиеся забираем и отпускаем active
        let closed: Vec<ActiveSession> = {
            let mut active = state.active.lock().unwrap();
            let mut closed = Vec::new();
            for (id, exe) in &wanted {
                if running.contains(exe) {
                    any_playing = true;
                    match active.get_mut(id) {
                        Some(a) => a.end = ts,
                        None => {
                            active.insert(
                                id.clone(),
                                ActiveSession {
                                    game_id: id.clone(),
                                    start: ts,
                                    end: ts,
                                },
                            );
                            changed = true;
                        }
                    }
                } else if let Some(a) = active.remove(id) {
                    changed = true;
                    if a.end > a.start {
                        closed.push(a);
                    }
                }
            }
            closed
        };

        // 2) закрывшиеся сессии: games → sessions, запись после drop
        if !closed.is_empty() {
            let sessions_snapshot = {
                let mut games = state.games.lock().unwrap();
                let mut sessions = state.sessions.lock().unwrap();
                for a in &closed {
                    sessions.push(Session::from(a));
                    if let Some(g) = games.iter_mut().find(|g| g.id == a.game_id) {
                        g.seconds_played += a.seconds();
                    }
                }
                all_sessions_snapshot(&sessions, &state.active.lock().unwrap())
            };
            persist_sessions(&state, &sessions_snapshot);
            persist_games(&state);
        }

        // 3) ачивки: снимок под lock, расчёт и запись после drop
        let new_unlock = {
            let games = state.games.lock().unwrap();
            let sessions = state.sessions.lock().unwrap();
            let active = state.active.lock().unwrap();
            let all = all_sessions_snapshot(&sessions, &active);
            let game_count = games.len() as u32;
            let mut unlocked = state.unlocked.lock().unwrap();
            let outcomes = engine::evaluate(&state.defs, &engine::compute(&all), &EvalContext { game_count });
            let mut fresh = false;
            for o in outcomes {
                if o.unlocked && !unlocked.contains_key(&o.id) {
                    unlocked.insert(o.id, now_rfc3339());
                    fresh = true;
                }
            }
            let unlocked_snapshot = unlocked.clone();
            (fresh, unlocked_snapshot, all, game_count)
        };
        if new_unlock.0 {
            store::save_json(&state.data_dir.join("achievements.json"), &new_unlock.1)
                .map_err(|e| eprintln!("nyx store: {}", e))
                .ok();
        }

        // 4) снимок сессий с активными — чтобы закрытие окна не теряло часы;
        // дубликаты схлопываются при следующей загрузке (dedupe_sessions)
        {
            let sessions = state.sessions.lock().unwrap();
            let active = state.active.lock().unwrap();
            let snapshot = all_sessions_snapshot(&sessions, &active);
            drop(sessions);
            drop(active);
            if any_playing || changed {
                persist_sessions(&state, &snapshot);
            }
        }

        if changed || any_playing || new_unlock.0 {
            let _ = app.emit("library-changed", ());
        }
    });
}

/// При выходе приложения: закрытые окна терять нельзя — фиксируем активные сессии.
fn commit_active_sessions(app: &AppHandle) {
    let state = app.state::<AppState>();
    let closed: Vec<ActiveSession> = {
        let mut active = state.active.lock().unwrap();
        let v: Vec<ActiveSession> = active.values().cloned().collect();
        active.clear();
        v
    };
    if closed.is_empty() {
        return;
    }
    let sessions_snapshot = {
        let mut games = state.games.lock().unwrap();
        let mut sessions = state.sessions.lock().unwrap();
        for a in &closed {
            sessions.push(Session::from(a));
            if let Some(g) = games.iter_mut().find(|g| g.id == a.game_id) {
                g.seconds_played += a.seconds();
            }
        }
        sessions.clone()
    };
    persist_sessions(&state, &sessions_snapshot);
    persist_games(&state);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = handle
                .path()
                .app_data_dir()
                .expect("не удалось найти папку данных");

            let mut games: Vec<Game> =
                store::load_json(&data_dir.join("games.json")).unwrap_or_default();
            let mut sessions: Vec<Session> =
                store::load_json(&data_dir.join("sessions.json")).unwrap_or_default();
            // активная сессия прошлой запуска могла попасть в файл снимком — схлопываем
            engine::dedupe_sessions(&mut sessions);
            let unlocked: HashMap<String, String> =
                store::load_json(&data_dir.join("achievements.json")).unwrap_or_default();
            let defs: Vec<AchievementDef> =
                serde_json::from_str(ACHIEVEMENTS_JSON).expect("битый achievements.json");

            // секунды на витрине — истина из сессий
            for g in games.iter_mut() {
                g.seconds_played = engine::compute(
                    &sessions
                        .iter()
                        .filter(|s| s.game_id == g.id)
                        .cloned()
                        .collect::<Vec<_>>(),
                )
                .total_seconds;
            }
            let games_snapshot = games.clone();
            store::save_json(&data_dir.join("games.json"), &games_snapshot)
                .map_err(|e| eprintln!("nyx store: {}", e))
                .ok();

            app.manage(AppState {
                games: Mutex::new(games),
                sessions: Mutex::new(sessions),
                active: Mutex::new(HashMap::new()),
                unlocked: Mutex::new(unlocked),
                defs,
                data_dir,
            });
            spawn_tracker(handle);
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
