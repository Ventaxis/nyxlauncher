# Сторонние компоненты и их лицензии

NyxLauncher использует открытые библиотеки. Ниже перечислены прямые зависимости
и их лицензии. Полный перечень транзитивных зависимостей с точными версиями —
в `src-tauri/Cargo.lock` и `package-lock.json`; тексты лицензий поставляются
самими пакетами.

## Приложение (Rust)

| Компонент | Назначение | Лицензия |
| --- | --- | --- |
| [Tauri 2](https://tauri.app) | каркас приложения, окно, трей | MIT или Apache-2.0 |
| [tauri-plugin-dialog](https://github.com/tauri-apps/plugins-workspace) | системные диалоги выбора файлов | MIT или Apache-2.0 |
| [serde](https://serde.rs) / [serde_json](https://github.com/serde-rs/json) | сериализация данных | MIT или Apache-2.0 |
| [sysinfo](https://github.com/GuillaumeGomez/sysinfo) | перечисление процессов | MIT |
| [chrono](https://github.com/chronotope/chrono) | даты и локальное время | MIT или Apache-2.0 |
| [hmac](https://github.com/RustCrypto/MACs) | HMAC-SHA256 | MIT или Apache-2.0 |
| [sha2](https://github.com/RustCrypto/hashes) | SHA-256 | MIT или Apache-2.0 |
| [getrandom](https://github.com/rust-random/getrandom) | криптостойкий генератор | MIT или Apache-2.0 |
| [base64](https://github.com/marshallpierce/rust-base64) | кодирование подписи и иконок | MIT или Apache-2.0 |
| [png](https://github.com/image-rs/image-png) | кодирование иконок в PNG | MIT или Apache-2.0 |
| [winreg](https://github.com/gentoo90/winreg-rs) | автозапуск через реестр | MIT |
| [windows](https://github.com/microsoft/windows-rs) | Win32 API: иконки, окна, PE | MIT или Apache-2.0 |

## Сборка интерфейса (JavaScript)

| Компонент | Назначение | Лицензия |
| --- | --- | --- |
| [React 19](https://react.dev) | интерфейс | MIT |
| [Vite](https://vite.dev) | сборка | MIT |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | поддержка React в Vite | MIT |
| [@tauri-apps/cli](https://github.com/tauri-apps/tauri) | сборка и упаковка | MIT или Apache-2.0 |

## Системные компоненты

| Компонент | Лицензия |
| --- | --- |
| Microsoft Edge WebView2 Runtime | проприетарная, распространяется Microsoft в составе Windows |
| Windows API (Win32) | проприетарная, использование регулируется лицензией Windows |

## Товарные знаки

Упоминания Windows, Microsoft, Steam, Valve, Epic Games и GOG используются
исключительно в информационных целях и принадлежат соответствующим
правообладателям. NyxLauncher не связан с ними, не спонсируется и не одобряется
ими. Подробнее — [docs/legal/TRADEMARKS.md](docs/legal/TRADEMARKS.md).

## Обязательства при распространении

При распространении неизменённых официальных сборок настоящий файл должен
сохраняться вместе с ними. Условия открытых лицензий применяются к
соответствующим компонентам и не отменяются условиями [LICENSE](LICENSE).
