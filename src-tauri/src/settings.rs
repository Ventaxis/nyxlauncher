// Настройки NyxLauncher: сериализуются в settings.json (с подписью, см. integrity.rs)
// и применяются без перезапуска там, где это возможно.
//
// Правило: каждая настройка обязана что-то реально делать. Никаких «декоративных»
// переключателей — иначе экран настроек превращается в ложь.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const THEMES: [&str; 3] = ["graphite", "midnight", "oled"];
pub const SORTS: [&str; 4] = ["recent", "name", "hours", "added"];

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Settings {
    // ── общие / поведение окна ───────────────────────────────────────────
    /// Запускать вместе с Windows (HKCU\...\Run, аргумент --minimized).
    pub autostart: bool,
    /// Стартовать скрытым в трее.
    pub start_minimized: bool,
    /// Крестик закрывает в трей, а не завершает процесс.
    pub close_to_tray: bool,
    /// Кнопка «свернуть» прячет окно в трей.
    pub minimize_to_tray: bool,
    /// Сворачивать лаунчер в трей после запуска игры.
    pub minimize_on_launch: bool,

    // ── интерфейс ────────────────────────────────────────────────────────
    /// Показывать настоящие иконки exe (иначе — монограммы, чуть легче).
    #[serde(default = "default_true")]
    pub show_icons: bool,
    /// graphite | midnight | oled
    pub theme: String,
    /// Отключить анимации (полезно на слабых машинах и при motion sickness).
    pub reduce_motion: bool,
    /// recent | name | hours | added
    pub sort_mode: String,

    // ── трекинг и античит ────────────────────────────────────────────────
    /// Пауза учёта времени: активные сессии закрываются, новые не открываются.
    pub tracker_paused: bool,
    /// Сессии короче порога не засчитываются (секунды).
    pub min_session_secs: u64,
    /// Учитывать только процессы с видимым окном (античит от «пустышек»).
    #[serde(default = "default_true")]
    pub require_window: bool,
    /// Строгий режим: exe должен совпасть по хешу с сохранённым при добавлении.
    /// Источник запуска (лаунчер или рабочий стол) проверяется отдельно —
    /// настройкой `count_direct_launch`.
    pub strict_anticheat: bool,
    /// Учитывать запуск игры напрямую (не через лаунчер).
    #[serde(default = "default_true")]
    pub count_direct_launch: bool,
    /// Интервал опроса процессов, секунды (2..=60).
    pub poll_secs: u64,
    /// Версия схемы настроек: по ней выполняется миграция значений.
    #[serde(default)]
    pub schema: u64,
}

/// Текущая версия схемы настроек.
pub const SCHEMA: u64 = 1;

impl Settings {
    /// Миграция значений, которые в старых версиях мешали учёту времени.
    ///
    /// 0.4.x хранил порог 60 секунд (короткие сессии пропадали) и считал
    /// строгий режим требованием запускать игру только из лаунчера — из-за
    /// этого у игр, запущенных с рабочего стола, время не шло вовсе.
    pub fn migrate(&mut self) {
        if self.schema < SCHEMA {
            if self.min_session_secs == 60 {
                self.min_session_secs = 5;
            }
            // Опрос раз в 5 секунд — старый дефолт: концы сессий теряли до 5 с.
            if self.poll_secs == 5 {
                self.poll_secs = 2;
            }
            self.schema = SCHEMA;
        }
        self.sanitize();
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            autostart: false,
            start_minimized: false,
            // Лаунчер фоновый по умолчанию: крестик не должен убивать учёт времени.
            close_to_tray: true,
            minimize_to_tray: false,
            minimize_on_launch: false,
            show_icons: true,
            theme: "graphite".into(),
            reduce_motion: false,
            sort_mode: "recent".into(),
            tracker_paused: false,
            min_session_secs: 5,
            require_window: true,
            strict_anticheat: false,
            count_direct_launch: true,
            // Опрос раз в 2 секунды: старт и конец сессии фиксируются с
            // точностью до секунд, а не «плюс-минус пять».
            poll_secs: 2,
            schema: SCHEMA,
        }
    }
}

impl Settings {
    /// Приводим значения к безопасным: конфиг может быть отредактирован руками
    /// (даже с валидной подписью — например, после импорта старой версии).
    pub fn sanitize(&mut self) {
        self.poll_secs = self.poll_secs.clamp(2, 60);
        self.min_session_secs = self.min_session_secs.min(3600);
        if !THEMES.contains(&self.theme.as_str()) {
            self.theme = "graphite".into();
        }
        if !SORTS.contains(&self.sort_mode.as_str()) {
            self.sort_mode = "recent".into();
        }
    }
}

// ---------------------------------------------------------------------------
// Автозапуск: HKCU\Software\Microsoft\Windows\CurrentVersion\Run
// Это штатный механизм Windows, без служб и без прав администратора.
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod autostart {
    use super::*;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::RegKey;

    const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const VALUE_NAME: &str = "NyxLauncher";

    fn command() -> Result<String, String> {
        let exe: PathBuf = std::env::current_exe().map_err(|e| e.to_string())?;
        Ok(format!("\"{}\" --minimized", exe.display()))
    }

    pub fn enabled() -> bool {
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(RUN_KEY, KEY_READ)
            .ok()
            .and_then(|k| k.get_value::<String, _>(VALUE_NAME).ok())
            .is_some()
    }

    /// Всегда перезаписывает команду: так переезд exe в другую папку
    /// не оставляет автозапуск со старым путём.
    pub fn set(on: bool) -> Result<(), String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if on {
            let (key, _) = hkcu
                .create_subkey(RUN_KEY)
                .map_err(|e| format!("Не удалось открыть ключ автозапуска: {}", e))?;
            key.set_value(VALUE_NAME, &command()?)
                .map_err(|e| format!("Не удалось включить автозапуск: {}", e))?;
        } else if let Ok(key) = hkcu.open_subkey_with_flags(RUN_KEY, KEY_WRITE) {
            match key.delete_value(VALUE_NAME) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("Не удалось выключить автозапуск: {}", e)),
            }
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod autostart {
    pub fn enabled() -> bool {
        false
    }
    pub fn set(_on: bool) -> Result<(), String> {
        Err("Автозапуск поддерживается только на Windows".into())
    }
}

pub fn autostart_enabled() -> bool {
    autostart::enabled()
}

pub fn set_autostart(on: bool) -> Result<(), String> {
    autostart::set(on)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_sane() {
        let s = Settings::default();
        assert!(s.poll_secs >= 2 && s.poll_secs <= 60);
        assert!(THEMES.contains(&s.theme.as_str()));
        assert!(SORTS.contains(&s.sort_mode.as_str()));
    }

    #[test]
    fn sanitize_clamps_and_falls_back() {
        let mut s = Settings {
            poll_secs: 0,
            min_session_secs: 999_999,
            theme: "neon".into(),
            sort_mode: "chaos".into(),
            ..Settings::default()
        };
        s.sanitize();
        assert_eq!(s.poll_secs, 2);
        assert_eq!(s.min_session_secs, 3600);
        assert_eq!(s.theme, "graphite");
        assert_eq!(s.sort_mode, "recent");
    }

    #[test]
    fn missing_fields_use_defaults() {
        // Старый settings.json без новых полей должен читаться, а не падать.
        let s: Settings = serde_json::from_str(r#"{"theme":"oled"}"#).unwrap();
        assert_eq!(s.theme, "oled");
        assert!(s.require_window);
        assert_eq!(s.poll_secs, 2);
        assert_eq!(s.schema, 0, "старый файл не знает о версии схемы");
    }

    #[test]
    fn migration_lowers_old_session_threshold() {
        // 0.4.x: порог 60 с отбрасывал короткие сессии — поднимаем до 5 с.
        let mut s: Settings =
            serde_json::from_str(r#"{"min_session_secs":60,"poll_secs":5}"#).unwrap();
        s.migrate();
        assert_eq!(s.min_session_secs, 5);
        assert_eq!(s.poll_secs, 2);
        assert_eq!(s.schema, SCHEMA);
    }

    #[test]
    fn migration_keeps_deliberate_threshold() {
        // Осознанно выставленный порог не трогаем: 120 с — не дефолт.
        let mut s: Settings =
            serde_json::from_str(r#"{"min_session_secs":120,"poll_secs":10}"#).unwrap();
        s.migrate();
        assert_eq!(s.min_session_secs, 120);
        assert_eq!(s.poll_secs, 10);
    }

    #[test]
    fn migration_is_one_time() {
        let mut s = Settings {
            min_session_secs: 60,
            schema: SCHEMA,
            ..Settings::default()
        };
        s.migrate();
        assert_eq!(
            s.min_session_secs, 60,
            "после миграции значение не переписывается"
        );
    }
}
