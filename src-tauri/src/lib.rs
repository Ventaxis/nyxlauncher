mod engine;
mod store;

use chrono::Utc;
use engine::{AchievementDef, EvalContext, Session};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

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

struct AppState {
    games: Mutex<Vec<Game>>,
    sessions: Mutex<Vec<Session>>,
    active: Mutex<HashMap<String, ActiveSession>>, // game_id -> сессия
    unlocked: Mutex<HashMap<String, String>>,      // achievement id -> when
    defs: Vec<AchievementDef>,
    data_dir: PathBuf,
}

fn now_ts() -> i64 {
    Utc::now().timestamp()
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn game_stats_from(sessions: &[Session], game_id: &str) -> engine::Stats {
    let mine: Vec<Session> = sessions
        .iter()
        .filter(|s| s.game_id == game_id)
        .cloned()
        .collect();
    engine::compute(&mine)
}

/// Последние 7 дней (UTC) от старого к сегодняшнему, с секундами из per_day.
fn week_from(per_day: &BTreeMap<String, u64>) -> Vec<WeekDay> {
    let today = Utc::now().date_naive();
    (0..7)
        .rev()
        .map(|i| {
            let d = today - chrono::Duration::days(i);
            let key = d.format("%Y-%m-%d").to_string();
            WeekDay {
                date: key,
                seconds: per_day.get(&key).copied().unwrap_or(0),
            }
        })
        .collect()
}

fn achievement_views(state: &AppState, sessions: &[Session]) -> Vec<AchievementView> {
    let stats = engine::compute(sessions);
    let ctx = EvalContext {
        game_count: state.games.lock().unwrap().len() as u32,
    };
    let unlocked = state.unlocked.lock().unwrap();
    engine::evaluate(&state.defs, &stats, &ctx)
        .into_iter()
        .map(|o| {
            let def = state.defs.iter().find(|d| d.id == o.id);
            AchievementView {
                id: o.id,
                title: def.map(|d| d.title.clone()).unwrap_or_default(),
                description: def.map(|d| d.description.clone()).unwrap_or_default(),
                icon: def.map(|d| d.icon.clone()).unwrap_or_default(),
                unlocked: o.unlocked || unlocked.contains_key(&o.id.clone()),
                unlocked_at: unlocked.get(&o.id).cloned(),
                progress: o.progress,
            }
        })
        .collect()
}

#[tauri::command]
fn get_summary(state: State<AppState>) -> Summary {
    let games = state.games.lock().unwrap();
    let sessions = state.sessions.lock().unwrap();
    let active = state.active.lock().unwrap();

    let game_views: Vec<GameView> = games
        .iter()
        .map(|g| {
            // витрина: закрытые часы + текущая незакрытая сессия
            let live = active.get(&g.id).map(|a| (a.end - a.start).max(0) as u64).unwrap_or(0);
            GameView {
                id: g.id.clone(),
                name: g.name.clone(),
                exe_path: g.exe_path.clone(),
                seconds_played: g.seconds_played + live,
                last_played: g.last_played.clone(),
                playing: active.contains_key(&g.id),
            }
        })
        .collect();

    let mut all_sessions = sessions.clone();
    for a in active.values() {
        all_sessions.push(Session {
            game_id: a.game_id.clone(),
            start: a.start,
            end: a.end,
        });
    }
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
        achievements: achievement_views(&state, &sessions),
    }
}

#[tauri::command]
fn get_game_stats(state: State<AppState>, id: String) -> Result<GameStats, String> {
    state
        .games
        .lock()
        .unwrap()
        .iter()
        .find(|g| g.id == id)
        .ok_or_else(|| "Игра не найдена".to_string())?;

    let sessions = state.sessions.lock().unwrap();
    let active = state.active.lock().unwrap();

    let mut mine = game_stats_from(&sessions, &id);
    if let Some(a) = active.get(&id) {
        let open = [Session {
            game_id: id.clone(),
            start: a.start,
            end: a.end,
        }];
        let open_stats = engine::compute(&open);
        mine.total_seconds += open_stats.total_seconds;
        mine.longest_session_seconds = mine
            .longest_session_seconds
            .max(open_stats.longest_session_seconds);
        for (k, v) in open_stats.per_day {
            *mine.per_day.entry(k).or_insert(0) += v;
        }
    }
    let today = Utc::now().date_naive().format("%Y-%m-%d").to_string();
    let last_played = state
        .games
        .lock()
        .unwrap()
        .iter()
        .find(|g| g.id == id)
        .and_then(|g| g.last_played.clone());

    Ok(GameStats {
        total_seconds: mine.total_seconds,
        today_seconds: mine.per_day.get(&today).copied().unwrap_or(0),
        longest_session_seconds: mine.longest_session_seconds,
        last_played,
        sessions_count: mine.sessions_count,
        week: week_from(&mine.per_day),
    })
}

#[tauri::command]
fn add_game(state: State<AppState>, exe_path: String) -> Result<Game, String> {
    if !exe_path.to_lowercase().ends_with(".exe") {
        return Err("Это не exe-файл".into());
    }
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
        id: format!("g_{}", Utc::now().timestamp_millis()),
        name,
        exe_path,
        seconds_played: 0,
        last_played: None,
    };
    games.push(game.clone());
    store::save_json(&state.data_dir.join("games.json"), &*games).map_err(eprint_ok)?;
    Ok(game)
}

/// Ошибки сохранения не роняют команду: показ в лог, игра добавлена.
fn eprint_ok(e: String) -> String {
    eprintln!("nyx store: {}", e);
    e
}

#[tauri::command]
fn remove_game(state: State<AppState>, id: String) -> Result<(), String> {
    {
        let mut games = state.games.lock().unwrap();
        let len_before = games.len();
        games.retain(|g| g.id != id);
        if games.len() == len_before {
            return Err("Игра не найдена".into());
        }
        store::save_json(&state.data_dir.join("games.json"), &*games).map_err(eprint_ok)?;
    }
    state.sessions.lock().unwrap().retain(|s| s.game_id != id);
    state.active.lock().unwrap().remove(&id);
    store::save_json(&state.data_dir.join("sessions.json"), &*state.sessions.lock().unwrap())
        .map_err(eprint_ok)?;
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
    std::process::Command::new(&exe)
        .spawn()
        .map_err(|e| format!("Не удалось запустить: {}", e))?;
    Ok(())
}

/// Каждый тик: сессии открываются/продлеваются/закрываются по живым процессам,
/// ачивки переоцениваются, новые открываются и сохраняются.
fn spawn_tracker(app: AppHandle) {
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(TICK_SECS));
            let state = app.state::<AppState>();
            let wanted: Vec<(String, String)> = {
                let games = state.games.lock().unwrap();
                games
                    .iter()
                    .map(|g| {
                        let exe = std::path::Path::new(&g.exe_path)
                            .file_name()
                            .map(|s| s.to_string_lossy().to_lowercase())
                            .unwrap_or_default();
                        (g.id.clone(), exe)
                    })
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
                .filter_map(|e| e.file_name())
                .map(|n| n.to_string_lossy().to_lowercase())
                .collect();

            let ts = now_ts();
            let mut changed = false;
            let mut any_playing = false;

            {
                let mut active = state.active.lock().unwrap();
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
                        // сессия закрылась: фиксируем и зачисляем часы
                        if a.end > a.start {
                            state.sessions.lock().unwrap().push(Session {
                                game_id: a.game_id.clone(),
                                start: a.start,
                                end: a.end,
                            });
                            let mut games = state.games.lock().unwrap();
                            if let Some(g) = games.iter_mut().find(|g| g.id == *id) {
                                g.seconds_played += (a.end - a.start) as u64;
                            }
                        }
                        changed = true;
                    }
                }
            }

            // ачивки: закрытые + открытые сессии
            let new_unlock = {
                let sessions = state.sessions.lock().unwrap();
                let mut all = sessions.clone();
                for a in state.active.lock().unwrap().values() {
                    all.push(Session {
                        game_id: a.game_id.clone(),
                        start: a.start,
                        end: a.end,
                    });
                }
                let stats = engine::compute(&all);
                let ctx = EvalContext {
                    game_count: state.games.lock().unwrap().len() as u32,
                };
                let outcomes = engine::evaluate(&state.defs, &stats, &ctx);
                let mut unlocked = state.unlocked.lock().unwrap();
                let mut fresh = false;
                for o in outcomes {
                    if o.unlocked && !unlocked.contains_key(&o.id) {
                        unlocked.insert(o.id, now_rfc3339());
                        fresh = true;
                    }
                }
                if fresh {
                    store::save_json(
                        &state.data_dir.join("achievements.json"),
                        &*unlocked,
                    )
                    .map_err(eprint_ok)
                    .ok();
                }
                fresh
            };

            // сохранение сессий при изменениях активного набора
            if changed {
                let mut all = state.sessions.lock().unwrap().clone();
                for a in state.active.lock().unwrap().values() {
                    all.push(Session {
                        game_id: a.game_id.clone(),
                        start: a.start,
                        end: a.end,
                    });
                }
                store::save_json(&state.data_dir.join("sessions.json"), &all)
                    .map_err(eprint_ok)
                    .ok();
            }

            if changed || any_playing || new_unlock {
                let _ = app.emit("library-changed", ());
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = handle
                .path()
                .app_data_dir()
                .expect("не удалось найти папку данных");

            let games: Vec<Game> =
                store::load_json(&data_dir.join("games.json")).unwrap_or_default();
            let sessions: Vec<Session> =
                store::load_json(&data_dir.join("sessions.json")).unwrap_or_default();
            let unlocked: HashMap<String, String> =
                store::load_json(&data_dir.join("achievements.json")).unwrap_or_default();
            let defs: Vec<AchievementDef> =
                serde_json::from_str(ACHIEVEMENTS_JSON).expect("битый achievements.json");

            // секунды на витрине — истина из сессий
            let mut games = games;
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
        .invoke_handler(tauri::generate_handler![
            get_summary,
            get_game_stats,
            add_game,
            remove_game,
            launch_game
        ])
        .run(tauri::generate_context!())
        .expect("ошибка запуска NyxLauncher");
}
