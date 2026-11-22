//! Правило засчитывания игровой сессии.
//!
//! Трекер получает набор сигналов (процесс найден, запущен лаунчером, хеш exe
//! совпал, есть видимое окно) и по ним решает: открывать сессию или нет.
//! Решение вынесено в чистую функцию, чтобы его можно было проверить тестами
//! без процессов, файлов и Windows API.

use std::collections::{hash_map::Entry, HashMap, HashSet};
use std::time::Instant;

use crate::engine::Session;

/// Что трекер увидел в этом опросе.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Signal {
    /// Процесс с путём игры найден.
    pub running: bool,
    /// Процесс порождён кнопкой «Играть» лаунчера.
    pub from_launcher: bool,
    /// Совпадение хеша exe с сохранённым: None — хеш не сохранён.
    pub hash: Option<bool>,
    /// У процесса есть видимое окно с непустым заголовком.
    pub window_ok: bool,
    /// Настройка: учитывать запуск игры напрямую, не через лаунчер.
    pub direct_allowed: bool,
    /// Настройка: сверять хеш exe.
    pub strict: bool,
    /// Настройка: считать только при видимом окне.
    pub require_window: bool,
}

/// Почему сессия засчитана или нет.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Count,
    /// Процесс не найден.
    NoProcess,
    /// Игра запущена не из лаунчера, а учитывать прямой запуск запрещено.
    NotFromLauncher,
    /// Файл игры изменился после добавления.
    HashMismatch,
    /// У игры нет сохранённой контрольной суммы, а строгий режим её требует.
    NoHash,
    /// Процесс живёт без видимого окна (фон, «пустышка»).
    NoWindow,
}

impl Verdict {
    pub fn is_count(self) -> bool {
        matches!(self, Verdict::Count)
    }

    /// Понятная причина для интерфейса: почему время не идёт.
    pub fn reason(self) -> &'static str {
        match self {
            Verdict::Count => "время идёт",
            Verdict::NoProcess => "игра не запущена",
            Verdict::NotFromLauncher => {
                "игра запущена не из лаунчера, а прямой запуск отключён в настройках"
            }
            Verdict::HashMismatch => {
                "файл игры изменился после добавления — нажмите «Обновить exe»"
            }
            Verdict::NoHash => "у игры нет контрольной суммы — нажмите «Обновить exe»",
            Verdict::NoWindow => "у процесса нет видимого окна",
        }
    }
}

/// Решение трекера.
pub fn verdict(s: Signal) -> Verdict {
    if !s.running {
        return Verdict::NoProcess;
    }
    // Источник запуска важен только если прямой запуск запрещён настройкой.
    if !s.direct_allowed && !s.from_launcher {
        return Verdict::NotFromLauncher;
    }
    if s.strict {
        match s.hash {
            None => return Verdict::NoHash,
            Some(false) => return Verdict::HashMismatch,
            Some(true) => {}
        }
    }
    if s.require_window && !s.window_ok {
        return Verdict::NoWindow;
    }
    Verdict::Count
}

/// Незакрытая сессия: процесс ещё запущен.
#[derive(Clone, Debug)]
pub struct ActiveSession {
    pub game_id: String,
    /// Unix-время старта — только для отображения.
    pub start: i64,
    /// Монотонные часы: длительность не зависит от перевода системных часов.
    started: Instant,
}

impl ActiveSession {
    pub fn new(game_id: &str, start: i64) -> Self {
        Self {
            game_id: game_id.to_string(),
            start,
            started: Instant::now(),
        }
    }

    pub fn seconds(&self) -> u64 {
        self.started.elapsed().as_secs()
    }

    pub fn end(&self) -> i64 {
        self.start + self.seconds() as i64
    }

    pub fn snapshot(&self) -> Session {
        Session {
            game_id: self.game_id.clone(),
            start: self.start,
            end: self.end(),
            id: format!("s_{}", self.start),
            manual: false,
        }
    }
}

/// Приводит набор активных игр к текущим вердиктам.
///
/// Возвращает `(что-то изменилось, закрытые сессии)`. Открытые сессии пишутся
/// в `active` сразу: их нужно видеть в сводке немедленно. Игры, которых больше
/// нет в библиотеке, закрываются — иначе сессия жила бы после удаления.
pub fn reconcile(
    active: &mut HashMap<String, ActiveSession>,
    verdicts: &[(String, Verdict)],
    ts: i64,
) -> (bool, Vec<ActiveSession>) {
    let mut changed = false;
    let mut closed = Vec::new();

    for (id, v) in verdicts {
        if v.is_count() {
            if let Entry::Vacant(e) = active.entry(id.clone()) {
                e.insert(ActiveSession::new(id, ts));
                changed = true;
            }
        } else if let Some(a) = active.remove(id) {
            changed = true;
            closed.push(a);
        }
    }

    let known: HashSet<&String> = verdicts.iter().map(|(id, _)| id).collect();
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

    (changed, closed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn running() -> Signal {
        Signal {
            running: true,
            from_launcher: false,
            hash: Some(true),
            window_ok: true,
            direct_allowed: true,
            strict: false,
            require_window: true,
        }
    }

    #[test]
    fn counts_direct_launch_by_default() {
        assert_eq!(verdict(running()), Verdict::Count);
    }

    #[test]
    fn strict_mode_counts_direct_launch_with_matching_hash() {
        // Строгий режим не должен превращать лаунчер в единственный способ
        // играть: он проверяет файл, а не источник запуска.
        let s = Signal {
            strict: true,
            ..running()
        };
        assert_eq!(verdict(s), Verdict::Count);
    }

    #[test]
    fn strict_mode_rejects_changed_exe() {
        let s = Signal {
            strict: true,
            hash: Some(false),
            ..running()
        };
        assert_eq!(verdict(s), Verdict::HashMismatch);
    }

    #[test]
    fn strict_mode_without_stored_hash_asks_to_refresh() {
        let s = Signal {
            strict: true,
            hash: None,
            ..running()
        };
        assert_eq!(verdict(s), Verdict::NoHash);
    }

    #[test]
    fn direct_launch_is_ignored_when_not_allowed() {
        let s = Signal {
            direct_allowed: false,
            ..running()
        };
        assert_eq!(verdict(s), Verdict::NotFromLauncher);
    }

    #[test]
    fn launcher_launch_is_counted_when_direct_is_off() {
        let s = Signal {
            direct_allowed: false,
            from_launcher: true,
            ..running()
        };
        assert_eq!(verdict(s), Verdict::Count);
    }

    #[test]
    fn window_is_required_when_asked() {
        let s = Signal {
            window_ok: false,
            ..running()
        };
        assert_eq!(verdict(s), Verdict::NoWindow);
    }

    #[test]
    fn window_is_not_required_when_off() {
        let s = Signal {
            require_window: false,
            window_ok: false,
            ..running()
        };
        assert_eq!(verdict(s), Verdict::Count);
    }

    #[test]
    fn strict_mode_does_not_override_window_setting() {
        // Строгий режим отвечает за целостность файла, окно — отдельная
        // настройка: при выключенной опции сессия считается без окна.
        let s = Signal {
            require_window: false,
            strict: true,
            window_ok: false,
            ..running()
        };
        assert_eq!(verdict(s), Verdict::Count);
    }

    #[test]
    fn missing_process_is_idle() {
        assert_eq!(
            verdict(Signal {
                running: false,
                ..running()
            }),
            Verdict::NoProcess
        );
    }

    #[test]
    fn every_rejection_has_a_human_reason() {
        for v in [
            Verdict::NotFromLauncher,
            Verdict::HashMismatch,
            Verdict::NoHash,
            Verdict::NoWindow,
        ] {
            assert!(!v.reason().is_empty());
        }
    }

    fn active(game_id: &str, start: i64) -> HashMap<String, ActiveSession> {
        let mut m = HashMap::new();
        m.insert(game_id.to_string(), ActiveSession::new(game_id, start));
        m
    }

    fn verdicts(pairs: &[(&str, Verdict)]) -> Vec<(String, Verdict)> {
        pairs.iter().map(|(id, v)| (id.to_string(), *v)).collect()
    }

    #[test]
    fn reconcile_opens_session_for_counted_game() {
        let mut open = HashMap::new();
        let (changed, closed) = reconcile(&mut open, &verdicts(&[("g1", Verdict::Count)]), 1_000);
        assert!(changed);
        assert!(closed.is_empty());
        assert_eq!(open.len(), 1);
        assert_eq!(open["g1"].start, 1_000);
    }

    #[test]
    fn reconcile_closes_session_when_launch_is_rejected() {
        // Регрессия 0.4.0: отказ в учёте не должен оставлять «вечную» сессию.
        let mut open = active("g1", 500);
        let (changed, closed) = reconcile(
            &mut open,
            &verdicts(&[("g1", Verdict::NotFromLauncher)]),
            600,
        );
        assert!(changed);
        assert_eq!(closed.len(), 1);
        assert_eq!(closed[0].game_id, "g1");
        assert!(open.is_empty());
    }

    #[test]
    fn reconcile_keeps_running_session_untouched() {
        let mut open = active("g1", 500);
        let (changed, closed) = reconcile(&mut open, &verdicts(&[("g1", Verdict::Count)]), 900);
        assert!(!changed);
        assert!(closed.is_empty());
        // Старт не перезаписывается: иначе сессия начиналась бы заново каждый тик.
        assert_eq!(open["g1"].start, 500);
    }

    #[test]
    fn reconcile_drops_sessions_of_removed_games() {
        let mut open = active("g_removed", 500);
        let (changed, closed) = reconcile(&mut open, &[], 700);
        assert!(changed);
        assert_eq!(closed.len(), 1);
        assert!(open.is_empty());
    }

    #[test]
    fn reconcile_is_idle_without_changes() {
        let mut open = HashMap::new();
        let (changed, closed) = reconcile(&mut open, &[], 700);
        assert!(!changed);
        assert!(closed.is_empty());
    }
}
