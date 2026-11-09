<div align="center">

<img src="src-tauri/icons/icon.png" width="96" alt="NyxLauncher" />

# NyxLauncher

**Игровой хаб от Ventaxis Corp — библиотека твоих игр, часы и ачивки. Без магазина.**

[![Build NyxLauncher](https://github.com/Ventaxis/nyxlauncher/actions/workflows/build.yml/badge.svg)](https://github.com/Ventaxis/nyxlauncher/actions/workflows/build.yml)
![Platform](https://img.shields.io/badge/platform-Windows-1d1d21?logo=windows11&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri%202-Rust-F24D37?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/UI-React%2019-1d1d21?logo=react&logoColor=61DAFB)
![Installer](https://img.shields.io/badge/installer-%20~2%20MB-d9a441)

</div>

---

NyxLauncher — это «Steam без магазина»: складываешь свои игры в одну полку, а лаунчер честно считает часы, ведёт статистику и раздаёт достижения. Младший брат мессенджера **HexShard** в экосистеме **Ventaxis Corp**.

```text
      ╭─────────────────────────────────────────────╮
      │  ◗ NyxLauncher          поиск   [ + Игра ]  │
      ├──────────┬──────────────────────────────────┤
      │ Полка    │  ▙▚ корешок ▚▙   Название игры   │
      │ ▙▚ ▙▚ ▙▚ │  12,4 ч всего                    │
      │ ▙▚ ▙▚ ▙▚ │  ── график недели ──             │
      │          │  ◈ ◈ ▩ ▩ ▩  достижения           │
      └──────────┴──────────────────────────────────┘
```

## Возможности

- **Полка-витрина** — большие обложки-корешки, у каждой игры свой приглушённый оттенок
- **Честные часы** — фоновый трекер видит запущенные игры и ведёт сессии посекундно
- **Ачивки как данные** — 10 достижений из коробки (`achievements.json`), новые добавляются без кода: часы, ночные смены, марафоны, серии дней, коллекция
- **Статистика** — день, неделя (SVG-график), рекорд сессии, серия дней подряд
- **Живой интерфейс** — React 19, движение там, где оно объясняет: вход полки со stagger, draw-in графика, count-up часов
- **Крошечный** — установщик ~2 МБ, в памяти ~20 МБ (спасибо Tauri 2)

## Архитектура

```text
ui/                      React 19 + Vite (витрина, график, ачивки)
src-tauri/
  src/lib.rs             окно, команды (get_summary, add_game, …), трекер процессов
  src/engine.rs          чистый движок статистики и ачивок — 19 тестов
  src/store.rs           атомарный JSON-стор (tmp + rename) — 3 теста
  achievements.json      ачивки как данные: условие = JSON, не код
.github/workflows/       CI: cargo test + сборка exe и NSIS-инсталлера
```

Данные лежат в `%APPDATA%/corp.ventaxis.nyxlauncher` — `games.json`, `sessions.json`, `achievements.json`.

## Сборка

```bash
npm ci
npx tauri build   # exe + NSIS-инсталлер в src-tauri/target/release/bundle
```

CI делает это сам на каждый пуш: артефакты — во вкладке **Actions**, релиз — по тегу `v*`.

## Планы

- [ ] Оверлей поверх игры (FPS, таймер сессии)
- [ ] Сканирование библиотек Steam / Epic / GOG
- [ ] Друзья и статусы — в экосистеме HexShard

---

<div align="center">
<sub>NyxLauncher · Ventaxis Corp · ночь хранит твои часы</sub>
</div>
