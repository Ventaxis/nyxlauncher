use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// Игра в библиотеке NyxLauncher.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Game {
    pub id: String,
    pub name: String,
    pub exe_path: String,
    pub seconds_played: u64,
    pub last_played: Option<String>,
}

impl Game {
    /// Имя exe-файла в нижнем регистре — по нему ищем процесс в системе.
    fn exe_file_name(&self) -> String {
        std::path::Path::new(&self.exe_path)
            .file_name()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    }
}

pub struct AppState {
    games: Mutex<Vec<Game>>,
}

fn games_file(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("не удалось найти папку данных приложения")
        .join("games.json")
}

fn load_games(app: &AppHandle) -> Vec<Game> {
    fs::read_to_string(games_file(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_games(app: &AppHandle, games: &[Game]) {
    let dir = games_file(app);
    if let Some(parent) = dir.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(games) {
        let _ = fs::write(games_file(app), json);
    }
}

#[tauri::command]
fn list_games(state: State<AppState>) -> Vec<Game> {
    state.games.lock().unwrap().clone()
}

#[tauri::command]
fn add_game(app: AppHandle, state: State<AppState>, exe_path: String) -> Result<Game, String> {
    if !exe_path.to_lowercase().ends_with(".exe") {
        return Err("Это не .exe файл".into());
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
    save_games(&app, &games);
    Ok(game)
}

#[tauri::command]
fn remove_game(app: AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    let mut games = state.games.lock().unwrap();
    let len_before = games.len();
    games.retain(|g| g.id != id);
    if games.len() == len_before {
        return Err("Игра не найдена".into());
    }
    save_games(&app, &games);
    Ok(())
}

#[tauri::command]
fn launch_game(state: State<AppState>, id: String) -> Result<(), String> {
    let games = state.games.lock().unwrap();
    let game = games
        .iter()
        .find(|g| g.id == id)
        .ok_or("Игра не найдена")?;
    std::process::Command::new(&game.exe_path)
        .spawn()
        .map_err(|e| format!("Не удалось запустить: {}", e))?;
    Ok(())
}

/// Фоновый поток: каждые 5 секунд ищет в системе процессы из библиотеки
/// и накапливает часы. Сохраняет и уведомляет интерфейс, когда есть изменения.
fn spawn_tracker(app: AppHandle) {
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(5));

            let state = app.state::<AppState>();
            let mut games = state.games.lock().unwrap();
            if games.is_empty() {
                continue;
            }

            let wanted: HashSet<String> =
                games.iter().map(|g| g.exe_file_name()).collect();

            let sys = sysinfo::System::new_all();
            let running: HashSet<String> = sys
                .processes()
                .values()
                .filter_map(|p| p.exe())
                .filter_map(|e| e.file_name())
                .map(|n| n.to_string_lossy().to_lowercase())
                .filter(|n| wanted.contains(n))
                .collect();

            let mut changed = false;
            for g in games.iter_mut() {
                if running.contains(&g.exe_file_name()) {
                    g.seconds_played += 5;
                    g.last_played = Some(Utc::now().to_rfc3339());
                    changed = true;
                }
            }
            if changed {
                save_games(&app, &games);
                let _ = app.emit("hours-updated", ());
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
            let games = load_games(&handle);
            app.manage(AppState {
                games: Mutex::new(games),
            });
            spawn_tracker(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_games,
            add_game,
            remove_game,
            launch_game
        ])
        .run(tauri::generate_context!())
        .expect("ошибка запуска NyxLauncher");
}
