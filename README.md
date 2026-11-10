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

- **Полка-витрина** — большие карточки с настоящими иконками exe, hero-панель игры и свой приглушённый оттенок у каждой
- **Живёт в трее** — автозапуск с Windows (HKCU, без прав администратора), старт скрытым, крестик прячет в трей, пауза учёта из меню
- **Честные часы** — фоновый трекер видит запущенные игры и ведёт сессии посекундно; монотонный таймер не боится перевода системных часов
- **История и ручные правки** — список сессий, добавление задним числом (но не в будущее), удаление, сброс статистики игры
- **Запуск как в Steam** — аргументы командной строки, рабочая папка, кнопка «Обновить exe» после обновления игры
- **Античит без иллюзий** — подпись данных HMAC-SHA256, проверка PE-заголовка и размера exe, видимое окно процесса, хеш exe, строгий режим «только запущенное лаунчером»
- **Настройки, которые работают** — темы (графит / полночь / OLED), меньше анимаций, сортировка, интервал опроса, минимальная сессия, экспорт и импорт подписанной копии
- **Ачивки как данные** — 10 достижений из коробки (`achievements.json`), новые добавляются без кода: часы, ночные смены, марафоны, серии дней, коллекция
- **Статистика** — день, неделя (SVG-график), рекорд сессии, серия дней подряд
- **Крошечный** — установщик ~2 МБ, в памяти ~20 МБ (спасибо Tauri 2)

## Архитектура

```text
ui/                      React 19 + Vite (витрина, hero, настройки, история)
src-tauri/
  src/lib.rs             окно, команды, трекер, трей, автозапуск
  src/engine.rs          чистый движок статистики и ачивок — 19 тестов
  src/settings.rs        настройки, sanitize, HKCU\...\Run — 3 теста
  src/integrity.rs       подпись JSON (HMAC-SHA256), SHA-256 файлов — 6 тестов
  src/winutil.rs         проверка exe, видимое окно, иконки — 4 теста
  src/store.rs           атомарный JSON-стор (tmp + rename) — 3 теста
  achievements.json      ачивки как данные: условие = JSON, не код
.github/workflows/       CI: cargo test + сборка exe и NSIS-инсталлера
```

Данные лежат в `%APPDATA%/corp.ventaxis.nyxlauncher` — `games.json`, `sessions.json`, `achievements.json`, `settings.json`, `meta.json` и `secret.bin` (ключ подписи). Иконки кешируются в `icons/`. Подпись делает ручную правку заметной, а испорченный файл уводится в `*.tampered.bak` вместо тихого принятия.

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
