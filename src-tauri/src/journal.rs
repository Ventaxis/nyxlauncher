// Журнал учёта: почему время не шло.
//
// Это диагностика, а не доказательство: файл читается человеком и не
// подписывается. Он отвечает на вопрос «играл, а часов нет — почему?»,
// на который подписанные сессии ответить не могут: причина живёт только
// пока запущен процесс.

use serde::{Deserialize, Serialize};
use std::path::Path;

/// Сколько записей храним: примерно месяц активного использования.
pub const CAP: usize = 200;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Entry {
    /// Unix-секунды момента, когда причина появилась.
    pub at: i64,
    pub game_id: String,
    /// Название на момент записи: игра может быть потом переименована.
    pub name: String,
    pub note: String,
}

/// Добавляет причину, если она ещё не последняя для этой игры.
///
/// Проверяется последняя запись именно этой игры, а не последняя вообще:
/// две игры с разными причинами не должны забивать журнал каждый опрос.
/// Возвращает true, если запись добавлена.
pub fn record(entries: &mut Vec<Entry>, entry: Entry) -> bool {
    let last_for_game = entries.iter().rev().find(|e| e.game_id == entry.game_id);
    if last_for_game.is_some_and(|e| e.note == entry.note) {
        return false;
    }

    entries.push(entry);
    if entries.len() > CAP {
        let extra = entries.len() - CAP;
        entries.drain(0..extra);
    }
    true
}

/// Новые записи первыми — так удобнее показывать в интерфейсе.
pub fn newest_first(entries: &[Entry], game_id: Option<&str>) -> Vec<Entry> {
    entries
        .iter()
        .rev()
        .filter(|e| game_id.is_none_or(|id| e.game_id == id))
        .cloned()
        .collect()
}

/// Читает журнал. Битый или отсутствующий файл — пустой журнал, не падение.
pub fn load(path: &Path) -> Vec<Entry> {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Vec<Entry>>(&bytes).ok())
        .unwrap_or_default()
}

/// Пишет журнал целиком: файл маленький, поэтому временный файл и переименование.
pub fn save(path: &Path, entries: &[Entry]) -> Result<(), String> {
    let data = serde_json::to_vec(entries).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &data).map_err(|e| format!("журнал: {}", e))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("журнал: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(at: i64, game: &str, note: &str) -> Entry {
        Entry {
            at,
            game_id: game.into(),
            name: game.to_uppercase(),
            note: note.into(),
        }
    }

    #[test]
    fn records_new_reason() {
        let mut log = Vec::new();
        assert!(record(&mut log, entry(10, "g1", "нет окна")));
        assert_eq!(log.len(), 1);
    }

    #[test]
    fn does_not_repeat_same_reason_for_same_game() {
        let mut log = Vec::new();
        record(&mut log, entry(10, "g1", "нет окна"));
        assert!(!record(&mut log, entry(12, "g1", "нет окна")));
        assert_eq!(log.len(), 1);
        // Время первой записи сохраняется: видно, когда проблема началась.
        assert_eq!(log[0].at, 10);
    }

    #[test]
    fn alternating_games_are_not_spammed() {
        let mut log = Vec::new();
        record(&mut log, entry(10, "g1", "нет хеша"));
        record(&mut log, entry(10, "g2", "нет окна"));
        // Каждый опрос видит обе причины, но новых записей быть не должно.
        assert!(!record(&mut log, entry(12, "g1", "нет хеша")));
        assert!(!record(&mut log, entry(12, "g2", "нет окна")));
        assert_eq!(log.len(), 2);
    }

    #[test]
    fn records_changed_reason() {
        let mut log = Vec::new();
        record(&mut log, entry(10, "g1", "нет хеша"));
        assert!(record(&mut log, entry(20, "g1", "хеш не совпал")));
        assert_eq!(log.len(), 2);
        assert_eq!(log[1].note, "хеш не совпал");
    }

    #[test]
    fn keeps_only_last_entries() {
        let mut log = Vec::new();
        for i in 0..(CAP as i64 + 5) {
            record(&mut log, entry(i, &format!("g{}", i), "нет окна"));
        }
        assert_eq!(log.len(), CAP);
        // Выпали самые старые, новые на месте.
        assert_eq!(log[0].at, 5);
        assert_eq!(log[CAP - 1].at, CAP as i64 + 4);
    }

    #[test]
    fn newest_first_filters_by_game() {
        let log = vec![
            entry(1, "g1", "a"),
            entry(2, "g2", "b"),
            entry(3, "g1", "c"),
        ];
        let g1 = newest_first(&log, Some("g1"));
        assert_eq!(g1.len(), 2);
        assert_eq!(g1[0].at, 3);
        assert_eq!(newest_first(&log, None).len(), 3);
    }
}
