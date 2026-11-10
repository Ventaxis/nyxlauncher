// Движок статистики и ачивок NyxLauncher — чистые функции, без tauri.
// Тестируется отдельно от приложения (cargo test).

use chrono::{Local, NaiveDate, TimeZone, Timelike};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

/// Одна игровая сессия: от появления процесса до его исчезновения.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Session {
    pub game_id: String,
    /// Unix-секунды начала сессии.
    pub start: i64,
    /// Unix-секунды конца сессии.
    pub end: i64,
    /// Стабильный идентификатор для правки истории; у старых файлов пустой
    /// и назначается при загрузке.
    #[serde(default)]
    pub id: String,
    /// Сессия добавлена вручную в истории.
    #[serde(default)]
    pub manual: bool,
}

/// Аггрегированная статистика по всем сессиям.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Stats {
    pub total_seconds: u64,
    pub sessions_count: u64,
    pub longest_session_seconds: u64,
    /// Сколько разных игр встречается в сессиях.
    pub distinct_games: u64,
    /// Самая длинная серия подряд идущих дней с игрой.
    pub streak_days: u64,
    /// Секунды по дням (локальное время, YYYY-MM-DD → секунды).
    pub per_day: BTreeMap<String, u64>,
    /// Сколько сессий началось в каждом локальном часе (0..24) — для оконных условий.
    pub start_hour_counts: [u64; 24],
}

/// Условие ачивки — данные, не код (правила расширяются JSON-ом без перекомпиляции).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Condition {
    TotalSeconds {
        seconds: u64,
    },
    SessionSeconds {
        seconds: u64,
    },
    /// Старт сессии попадает в локальное окно часов [from, to);
    /// from > to — через полночь, from == to — пустое окно.
    SessionStartHour {
        from: u32,
        to: u32,
    },
    GameCount {
        count: u32,
    },
    DistinctGames {
        count: u32,
    },
    StreakDays {
        days: u32,
    },
    SessionCount {
        count: u32,
    },
}

/// Определение ачивки (из achievements.json).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AchievementDef {
    pub id: String,
    pub title: String,
    pub description: String,
    pub icon: String,
    pub condition: Condition,
}

/// Результат оценки ачивки: открыта ли и прогресс 0..=1 для закрытых.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Outcome {
    pub id: String,
    pub unlocked: bool,
    pub progress: f64,
    /// Текущее значение метрики (для «3.2 / 5 ч»).
    pub progress_value: Option<f64>,
    pub threshold: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct EvalContext {
    /// Игр в библиотеке (для GameCount).
    pub game_count: u32,
}

fn secs_between(start: i64, end: i64) -> u64 {
    if end > start {
        (end - start) as u64
    } else {
        0
    }
}

fn date_key(ts: i64) -> String {
    // earliest() не теряет сессии в неоднозначный час перевода стрелок
    // (single() там возвращает None).
    Local
        .timestamp_opt(ts, 0)
        .earliest()
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

/// Аггрегация сессий в статистику. Сессия целиком относится к дате начала (локальное время).
pub fn compute(sessions: &[Session]) -> Stats {
    let mut s = Stats::default();
    let mut distinct = HashSet::new();
    for sess in sessions {
        let dur = secs_between(sess.start, sess.end);
        s.total_seconds += dur;
        s.longest_session_seconds = s.longest_session_seconds.max(dur);
        distinct.insert(sess.game_id.clone());
        *s.per_day.entry(date_key(sess.start)).or_insert(0) += dur;
        if let Some(dt) = Local.timestamp_opt(sess.start, 0).earliest() {
            s.start_hour_counts[dt.hour() as usize] += 1;
        }
    }
    s.sessions_count = sessions.len() as u64;
    s.distinct_games = distinct.len() as u64;
    s.streak_days = streak(&s.per_day);
    s
}

/// Схлопывание дубликатов сессий (одинаковая игра и старт — например,
/// активная сессия попала в файл, а потом закрылась и записалась снова):
/// оставляем вариант с максимальным end.
pub fn dedupe_sessions(sessions: &mut Vec<Session>) {
    let mut best: HashMap<(String, i64), usize> = HashMap::new();
    let mut kept: Vec<Session> = Vec::with_capacity(sessions.len());
    for s in sessions.drain(..) {
        let key = (s.game_id.clone(), s.start);
        match best.get(&key) {
            Some(&i) => {
                if s.end > kept[i].end {
                    kept[i].end = s.end;
                }
            }
            None => {
                best.insert(key, kept.len());
                kept.push(s);
            }
        }
    }
    *sessions = kept;
}

/// Самая длинная серия подряд идущих дней с игрой.
fn streak(per_day: &BTreeMap<String, u64>) -> u64 {
    let mut days: Vec<NaiveDate> = per_day
        .keys()
        .filter_map(|k| NaiveDate::parse_from_str(k, "%Y-%m-%d").ok())
        .collect();
    days.sort();
    days.dedup();
    let mut best: u64 = 0;
    let mut run: u64 = 0;
    let mut prev: Option<NaiveDate> = None;
    for d in days {
        match prev {
            Some(p) if (d - p).num_days() == 1 => run += 1,
            _ => run = 1,
        }
        best = best.max(run);
        prev = Some(d);
    }
    best
}

/// Оценка всех ачивок по статистике.
pub fn evaluate(defs: &[AchievementDef], stats: &Stats, ctx: &EvalContext) -> Vec<Outcome> {
    defs.iter()
        .map(|d| {
            let (done, value, threshold) = measure(&d.condition, stats, ctx);
            let progress = if threshold > 0.0 {
                (value / threshold).clamp(0.0, 1.0)
            } else if done {
                1.0
            } else {
                0.0
            };
            Outcome {
                id: d.id.clone(),
                unlocked: done,
                progress,
                progress_value: Some(value),
                threshold: Some(threshold),
            }
        })
        .collect()
}

/// (выполнено, текущее значение, порог).
fn measure(cond: &Condition, stats: &Stats, ctx: &EvalContext) -> (bool, f64, f64) {
    match cond {
        Condition::TotalSeconds { seconds } => (
            stats.total_seconds >= *seconds,
            stats.total_seconds as f64,
            *seconds as f64,
        ),
        Condition::SessionSeconds { seconds } => (
            stats.longest_session_seconds >= *seconds,
            stats.longest_session_seconds as f64,
            *seconds as f64,
        ),
        Condition::SessionCount { count } => (
            stats.sessions_count >= *count as u64,
            stats.sessions_count as f64,
            *count as f64,
        ),
        Condition::DistinctGames { count } => (
            stats.distinct_games >= *count as u64,
            stats.distinct_games as f64,
            *count as f64,
        ),
        Condition::GameCount { count } => (
            ctx.game_count >= *count,
            ctx.game_count as f64,
            *count as f64,
        ),
        Condition::StreakDays { days } => (
            stats.streak_days >= *days as u64,
            stats.streak_days as f64,
            *days as f64,
        ),
        Condition::SessionStartHour { from, to } => {
            // Конфиг приходит из JSON: не даём выйти за границы массива и
            // трактуем from == to как пустое окно, а не как «любой час».
            let from = (*from).min(24);
            let to = (*to).min(24);
            let hit = if from < to {
                (from..to).any(|h| stats.start_hour_counts[h as usize] > 0)
            } else if from > to {
                (0u32..24).any(|h| stats.start_hour_counts[h as usize] > 0 && (h >= from || h < to))
            } else {
                false
            };
            (hit, if hit { 1.0 } else { 0.0 }, 1.0)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sess(game: &str, start_iso: &str, dur_secs: i64) -> Session {
        // интерпретируем строку как ЛОКАЛЬНОЕ время (как и продакшн-код)
        let naive = chrono::NaiveDateTime::parse_from_str(start_iso, "%Y-%m-%d %H:%M:%S").unwrap();
        let start = naive
            .and_local_timezone(Local)
            .single()
            .unwrap()
            .timestamp();
        Session {
            game_id: game.into(),
            start,
            end: start + dur_secs,
            id: String::new(),
            manual: false,
        }
    }

    #[test]
    fn dedupe_keeps_longest_end_for_same_start() {
        let mut v = vec![
            sess("a", "2026-11-08 10:00:00", 60),
            sess("a", "2026-11-08 10:00:00", 300),
            sess("a", "2026-11-08 11:00:00", 120),
            sess("b", "2026-11-08 10:00:00", 60),
        ];
        dedupe_sessions(&mut v);
        assert_eq!(v.len(), 3);
        let merged = v
            .iter()
            .find(|s| s.game_id == "a" && s.end - s.start == 300);
        assert!(merged.is_some(), "должен остаться самый длинный вариант");
    }

    // ── Слайс 1: агрегация ────────────────────────────────

    #[test]
    fn empty_sessions_give_zero_stats() {
        let s = compute(&[]);
        assert_eq!(s, Stats::default());
    }

    #[test]
    fn two_sessions_sum_count_longest_and_distinct() {
        let s = compute(&[
            sess("a", "2026-11-07 18:00:00", 3600),
            sess("a", "2026-11-08 20:00:00", 7200),
        ]);
        assert_eq!(s.total_seconds, 3600 + 7200);
        assert_eq!(s.sessions_count, 2);
        assert_eq!(s.longest_session_seconds, 7200);
        assert_eq!(s.distinct_games, 1);
    }

    #[test]
    fn per_day_uses_start_date_local() {
        let s = compute(&[
            sess("a", "2026-11-07 22:00:00", 1800),
            sess("a", "2026-11-08 23:30:00", 600),
        ]);
        assert_eq!(s.per_day.get("2026-11-07"), Some(&1800));
        assert_eq!(s.per_day.get("2026-11-08"), Some(&600));
        assert_eq!(s.per_day.len(), 2);
    }

    #[test]
    fn streak_counts_consecutive_days_and_resets_on_gap() {
        let s = compute(&[
            sess("a", "2026-11-01 12:00:00", 60),
            sess("a", "2026-11-02 12:00:00", 60),
            sess("a", "2026-11-03 12:00:00", 60),
            // пропуск 11-04
            sess("a", "2026-11-05 12:00:00", 60),
            sess("a", "2026-11-06 12:00:00", 60),
        ]);
        assert_eq!(s.streak_days, 3);
    }

    #[test]
    fn same_day_double_session_counts_as_one_streak_day() {
        let s = compute(&[
            sess("a", "2026-11-01 10:00:00", 60),
            sess("a", "2026-11-01 20:00:00", 60),
            sess("a", "2026-11-02 10:00:00", 60),
        ]);
        assert_eq!(s.streak_days, 2);
    }

    #[test]
    fn distinct_games_counts_unique() {
        let s = compute(&[
            sess("a", "2026-11-01 10:00:00", 60),
            sess("b", "2026-11-01 11:00:00", 60),
            sess("a", "2026-11-02 10:00:00", 60),
        ]);
        assert_eq!(s.distinct_games, 2);
    }

    #[test]
    fn start_hour_histogram_counts_sessions() {
        let s = compute(&[
            sess("a", "2026-11-08 02:30:00", 60),
            sess("a", "2026-11-08 02:50:00", 60),
            sess("a", "2026-11-08 14:00:00", 60),
        ]);
        assert_eq!(s.start_hour_counts[2], 2);
        assert_eq!(s.start_hour_counts[14], 1);
        assert_eq!(s.start_hour_counts[3], 0);
    }

    // ── Слайс 2: пороги, прогресс, ночное окно ────────────

    fn def(id: &str, cond: Condition) -> AchievementDef {
        AchievementDef {
            id: id.into(),
            title: id.into(),
            description: String::new(),
            icon: "clock".into(),
            condition: cond,
        }
    }

    #[test]
    fn total_seconds_threshold_progress_halfway() {
        let stats = compute(&[sess("a", "2026-11-08 10:00:00", 1800)]);
        let ctx = EvalContext { game_count: 0 };
        let out = evaluate(
            &[def("h1", Condition::TotalSeconds { seconds: 3600 })],
            &stats,
            &ctx,
        );
        assert!(!out[0].unlocked);
        assert!((out[0].progress - 0.5).abs() < 1e-9);
        assert_eq!(out[0].progress_value, Some(1800.0));
        assert_eq!(out[0].threshold, Some(3600.0));
    }

    #[test]
    fn progress_clamps_at_one() {
        let stats = compute(&[sess("a", "2026-11-08 10:00:00", 7200)]);
        let ctx = EvalContext { game_count: 0 };
        let out = evaluate(
            &[def("h1", Condition::TotalSeconds { seconds: 3600 })],
            &stats,
            &ctx,
        );
        assert!(out[0].unlocked);
        assert_eq!(out[0].progress, 1.0);
    }

    #[test]
    fn session_seconds_reads_longest_session() {
        let stats = compute(&[
            sess("a", "2026-11-08 10:00:00", 1800),
            sess("a", "2026-11-08 14:00:00", 7200),
        ]);
        let ctx = EvalContext { game_count: 0 };
        let out = evaluate(
            &[def("m", Condition::SessionSeconds { seconds: 3600 })],
            &stats,
            &ctx,
        );
        assert!(out[0].unlocked);
    }

    #[test]
    fn game_count_uses_library_not_sessions() {
        let stats = Stats::default();
        let ctx = EvalContext { game_count: 5 };
        let out = evaluate(
            &[def("collector", Condition::GameCount { count: 5 })],
            &stats,
            &ctx,
        );
        assert!(out[0].unlocked);
    }

    #[test]
    fn distinct_games_condition() {
        let stats = compute(&[
            sess("a", "2026-11-08 10:00:00", 60),
            sess("b", "2026-11-08 11:00:00", 60),
        ]);
        let ctx = EvalContext { game_count: 0 };
        let out = evaluate(
            &[def("d", Condition::DistinctGames { count: 3 })],
            &stats,
            &ctx,
        );
        assert!(!out[0].unlocked);
        assert!((out[0].progress - 2.0 / 3.0).abs() < 1e-9);
    }

    #[test]
    fn streak_condition_reads_streak_days() {
        let stats = compute(&[
            sess("a", "2026-11-01 12:00:00", 60),
            sess("a", "2026-11-02 12:00:00", 60),
        ]);
        let ctx = EvalContext { game_count: 0 };
        let out = evaluate(&[def("s", Condition::StreakDays { days: 3 })], &stats, &ctx);
        assert!(!out[0].unlocked);
        assert!((out[0].progress - 2.0 / 3.0).abs() < 1e-9);
    }

    #[test]
    fn night_window_matches_session_started_in_range() {
        let stats = compute(&[sess("a", "2026-11-08 02:30:00", 600)]);
        let ctx = EvalContext { game_count: 0 };
        let out = evaluate(
            &[def("night", Condition::SessionStartHour { from: 0, to: 5 })],
            &stats,
            &ctx,
        );
        assert!(out[0].unlocked);
        assert_eq!(out[0].progress, 1.0);
    }

    #[test]
    fn night_window_locked_for_evening_session() {
        let stats = compute(&[sess("a", "2026-11-08 22:30:00", 600)]);
        let ctx = EvalContext { game_count: 0 };
        let out = evaluate(
            &[def("night", Condition::SessionStartHour { from: 0, to: 5 })],
            &stats,
            &ctx,
        );
        assert!(!out[0].unlocked);
        assert_eq!(out[0].progress, 0.0);
    }

    #[test]
    fn night_window_wraps_midnight() {
        let stats = compute(&[sess("a", "2026-11-08 23:00:00", 600)]);
        let ctx = EvalContext { game_count: 0 };
        let out = evaluate(
            &[def(
                "evening",
                Condition::SessionStartHour { from: 22, to: 6 },
            )],
            &stats,
            &ctx,
        );
        assert!(out[0].unlocked);
    }

    #[test]
    fn empty_hour_window_never_unlocks() {
        let stats = compute(&[sess("a", "2026-11-08 05:00:00", 600)]);
        let ctx = EvalContext { game_count: 0 };
        let out = evaluate(
            &[def("exact", Condition::SessionStartHour { from: 5, to: 5 })],
            &stats,
            &ctx,
        );
        assert!(!out[0].unlocked);
    }

    #[test]
    fn hour_window_clamps_instead_of_panicking() {
        let stats = compute(&[
            sess("a", "2026-11-08 23:00:00", 600),
            sess("a", "2026-11-08 10:00:00", 600),
        ]);
        let ctx = EvalContext { game_count: 0 };
        let late = evaluate(
            &[def(
                "late",
                Condition::SessionStartHour { from: 18, to: 26 },
            )],
            &stats,
            &ctx,
        );
        assert!(late[0].unlocked, "23:00 попадает в 18..24");
        let morning = compute(&[sess("a", "2026-11-08 10:00:00", 600)]);
        let out = evaluate(
            &[def(
                "late",
                Condition::SessionStartHour { from: 18, to: 26 },
            )],
            &morning,
            &ctx,
        );
        assert!(!out[0].unlocked, "10:00 не попадает в 18..24");
    }
}
