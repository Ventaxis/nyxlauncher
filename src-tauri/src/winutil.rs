// Windows-специфика NyxLauncher:
//  * проверка exe (PE + размер + чёрный список) — античит от «пустышек»;
//  * видимое окно процесса — без окна время не идёт;
//  * иконка exe → PNG для интерфейса.
//
// Всё это эвристики, а не абсолютная защита: на локальной машине пользователь
// контролирует процесс. Задача — убрать дешёвые способы накрутки и сделать
// подмену заметной.

use std::path::Path;

/// Ниже этого размера exe почти наверняка пустышка/лаунчер-заглушка.
const MIN_EXE_BYTES: u64 = 16 * 1024;

/// Системные и служебные программы, которые нельзя выдавать за игру.
const BLACKLIST: &[&str] = &[
    "cmd.exe",
    "powershell.exe",
    "pwsh.exe",
    "conhost.exe",
    "conime.exe",
    "regedit.exe",
    "regsvr32.exe",
    "rundll32.exe",
    "msiexec.exe",
    "cscript.exe",
    "wscript.exe",
    "notepad.exe",
    "calc.exe",
    "mspaint.exe",
    "explorer.exe",
    "taskmgr.exe",
    "control.exe",
    "mmc.exe",
    "wsl.exe",
    "wt.exe",
    "bash.exe",
    "services.exe",
    "svchost.exe",
    "lsass.exe",
    "csrss.exe",
    "smss.exe",
    "winlogon.exe",
    "wininit.exe",
    "dwm.exe",
    "spoolsv.exe",
    "searchapp.exe",
    "searchhost.exe",
    "startmenuexperiencehost.exe",
    "shellexperiencehost.exe",
    "applicationframehost.exe",
    "lockapp.exe",
    "systemsettings.exe",
    "textinputhost.exe",
    "runtimebroker.exe",
    "backgroundtaskhost.exe",
    "sihost.exe",
    "dllhost.exe",
    "gamebar.exe",
    "xboxgamebar.exe",
    "steam.exe",
    "steamwebhelper.exe",
    "discord.exe",
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "opera.exe",
    "brave.exe",
    "code.exe",
    "devenv.exe",
    "nyxlauncher.exe",
];

/// Нормализация пути для сравнения: единый разделитель + нижний регистр.
pub fn norm_path(p: &str) -> String {
    p.replace('/', "\\").to_lowercase()
}

/// Проверка, что файл — настоящее Windows-приложение, а не заглушка.
pub fn validate_game_exe(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.is_file() {
        return Err("Файл не найден. Проверьте путь.".into());
    }
    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if ext != "exe" {
        return Err("Это не exe-файл".into());
    }

    let size = std::fs::metadata(p)
        .map_err(|e| format!("Не удалось прочитать файл: {}", e))?
        .len();
    if size < MIN_EXE_BYTES {
        return Err(format!(
            "Файл слишком маленький ({} КБ). Похоже на пустышку, а не на игру.",
            size / 1024
        ));
    }
    if !pe_ok(p) {
        return Err("Файл не является корректным Windows-приложением (нет PE-заголовка).".into());
    }

    if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
        let lower = name.to_ascii_lowercase();
        if BLACKLIST.contains(&lower.as_str()) {
            return Err(format!(
                "«{}» — системная или служебная программа. Добавьте exe самой игры.",
                name
            ));
        }
    }

    if let Ok(windir) = std::env::var("WINDIR") {
        let prefix = format!("{}\\", norm_path(&windir));
        if norm_path(path).starts_with(&prefix) {
            return Err("Нельзя добавлять программы из папки Windows.".into());
        }
    }

    if let Ok(cur) = std::env::current_exe() {
        if norm_path(path) == norm_path(&cur.to_string_lossy()) {
            return Err("Это сам лаунчер, а не игра.".into());
        }
    }

    Ok(())
}

/// MZ + PE\0\0 по e_lfanew. Дешёвая, но надёжная проверка формата.
fn pe_ok(path: &Path) -> bool {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut mz = [0u8; 2];
    if f.read_exact(&mut mz).is_err() || &mz != b"MZ" {
        return false;
    }
    if f.seek(SeekFrom::Start(0x3c)).is_err() {
        return false;
    }
    let mut off = [0u8; 4];
    if f.read_exact(&mut off).is_err() {
        return false;
    }
    let e_lfanew = u32::from_le_bytes(off) as u64;
    // Разумные границы: заголовок не может лежать в первых 0x40 байтах
    // и не может быть дальше 1 МБ от начала.
    if !(0x40..=0x100000).contains(&e_lfanew) {
        return false;
    }
    if f.seek(SeekFrom::Start(e_lfanew)).is_err() {
        return false;
    }
    let mut sig = [0u8; 4];
    f.read_exact(&mut sig).is_ok() && &sig == b"PE\0\0"
}

// ---------------------------------------------------------------------------
// Видимое окно
// ---------------------------------------------------------------------------

#[cfg(windows)]
pub fn has_visible_window(pids: &[u32]) -> bool {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindow, GetWindowTextLengthW, GetWindowThreadProcessId, IsWindowVisible,
        GW_OWNER,
    };

    struct Ctx<'a> {
        pids: &'a [u32],
        found: bool,
    }

    unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam.0 as *mut Ctx);
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if !ctx.pids.contains(&pid) {
            return BOOL(1);
        }
        if !IsWindowVisible(hwnd).as_bool() || GetWindowTextLengthW(hwnd) <= 0 {
            return BOOL(1);
        }
        // Владельческие окна — тултипы/диалоги; главное окно игры без владельца.
        if GetWindow(hwnd, GW_OWNER).is_ok() {
            return BOOL(1);
        }
        ctx.found = true;
        BOOL(0) // остановить перебор
    }

    if pids.is_empty() {
        return false;
    }
    let mut ctx = Ctx { pids, found: false };
    unsafe {
        let _ = EnumWindows(Some(cb), LPARAM(&mut ctx as *mut Ctx as isize));
    }
    ctx.found
}

#[cfg(not(windows))]
pub fn has_visible_window(_pids: &[u32]) -> bool {
    true
}

// ---------------------------------------------------------------------------
// Иконки exe → PNG
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod icons {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
    };
    use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Controls::{IImageList, ILD_TRANSPARENT};
    use windows::Win32::UI::Shell::{
        ExtractIconExW, SHGetFileInfoW, SHGetImageList, SHFILEINFOW, SHGFI_SYSICONINDEX,
        SHIL_EXTRALARGE, SHIL_JUMBO,
    };
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

    pub fn extract_icon_png(exe: &str) -> Option<Vec<u8>> {
        let wide: Vec<u16> = OsStr::new(exe)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        unsafe {
            // SHGetImageList/COM могут быть не инициализированы в этом потоке.
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let hicon = load_icon(&wide)?;
            let rgba = hicon_to_rgba(hicon);
            let _ = DestroyIcon(hicon);
            let (w, h, data) = rgba?;
            encode_png(w, h, &data)
        }
    }

    unsafe fn load_icon(wide: &[u16]) -> Option<HICON> {
        let ptr = PCWSTR(wide.as_ptr());
        let mut info = SHFILEINFOW::default();
        let ok = SHGetFileInfoW(
            ptr,
            FILE_ATTRIBUTE_NORMAL,
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_SYSICONINDEX,
        );
        if ok != 0 {
            for size in [SHIL_JUMBO, SHIL_EXTRALARGE] {
                if let Ok(list) = SHGetImageList::<IImageList>(size as i32) {
                    if let Ok(hicon) = list.GetIcon(info.iIcon, ILD_TRANSPARENT.0) {
                        if !hicon.is_invalid() {
                            return Some(hicon);
                        }
                    }
                }
            }
        }

        // Запасной путь: обычный 32×32 из ресурсов exe.
        let mut large = HICON(std::ptr::null_mut());
        let mut small = HICON(std::ptr::null_mut());
        let n = ExtractIconExW(ptr, 0, Some(&mut large), Some(&mut small), 1);
        if !small.is_invalid() {
            let _ = DestroyIcon(small);
        }
        if n > 0 && !large.is_invalid() {
            return Some(large);
        }
        None
    }

    unsafe fn hicon_to_rgba(hicon: HICON) -> Option<(u32, u32, Vec<u8>)> {
        let mut ii: ICONINFO = std::mem::zeroed();
        GetIconInfo(hicon, &mut ii).ok()?;
        let result = if !ii.hbmColor.is_invalid() {
            bitmap_rgba(ii.hbmColor)
        } else {
            None
        };
        if !ii.hbmColor.is_invalid() {
            let _ = DeleteObject(HGDIOBJ(ii.hbmColor.0));
        }
        if !ii.hbmMask.is_invalid() {
            let _ = DeleteObject(HGDIOBJ(ii.hbmMask.0));
        }
        result
    }

    unsafe fn bitmap_rgba(bmp: HBITMAP) -> Option<(u32, u32, Vec<u8>)> {
        let mut bm = BITMAP::default();
        let got = GetObjectW(
            HGDIOBJ(bmp.0),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bm as *mut _ as *mut std::ffi::c_void),
        );
        if got == 0 {
            return None;
        }
        let (w, h) = (bm.bmWidth, bm.bmHeight);
        if w <= 0 || h <= 0 || w > 1024 || h > 1024 {
            return None;
        }

        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = w;
        bmi.bmiHeader.biHeight = -h; // top-down
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB.0;

        let mut buf = vec![0u8; (w as usize) * (h as usize) * 4];
        let hdc = CreateCompatibleDC(None);
        if hdc.is_invalid() {
            return None;
        }
        let lines = GetDIBits(
            hdc,
            bmp,
            0,
            h as u32,
            Some(buf.as_mut_ptr() as *mut std::ffi::c_void),
            &mut bmi,
            DIB_RGB_COLORS,
        );
        let _ = DeleteDC(hdc);
        if lines == 0 {
            return None;
        }

        // У старых иконок альфа-канала нет (все нули) — считаем их непрозрачными.
        let (chunks, _) = buf.as_chunks::<4>();
        let has_alpha = chunks.iter().any(|p| p[3] != 0);
        let mut rgba = Vec::with_capacity(buf.len());
        for px in chunks {
            rgba.push(px[2]);
            rgba.push(px[1]);
            rgba.push(px[0]);
            rgba.push(if has_alpha { px[3] } else { 255 });
        }
        Some((w as u32, h as u32, rgba))
    }

    fn encode_png(w: u32, h: u32, rgba: &[u8]) -> Option<Vec<u8>> {
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, w, h);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let mut writer = enc.write_header().ok()?;
            writer.write_image_data(rgba).ok()?;
        }
        Some(out)
    }
}

#[cfg(windows)]
pub use icons::extract_icon_png;

#[cfg(not(windows))]
pub fn extract_icon_png(_exe: &str) -> Option<Vec<u8>> {
    None
}

/// Открыть папку данных в проводнике.
pub fn open_dir(dir: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Не удалось открыть папку: {}", e))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
        Err("Поддерживается только на Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn norm_path_unifies_separators_and_case() {
        assert_eq!(norm_path("C:/Games/Game.EXE"), "c:\\games\\game.exe");
    }

    #[test]
    fn missing_file_is_rejected() {
        assert!(validate_game_exe("C:\\nope\\missing.exe").is_err());
    }

    #[test]
    fn tiny_file_is_rejected() {
        let p = std::env::temp_dir().join(format!("nyx_tiny_{}.exe", std::process::id()));
        std::fs::write(&p, b"MZ").unwrap();
        assert!(validate_game_exe(&p.to_string_lossy()).is_err());
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn blacklisted_name_is_rejected() {
        let dir = std::env::temp_dir().join(format!("nyx_black_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let p = dir.join("notepad.exe");
        std::fs::write(&p, vec![0u8; 20 * 1024]).unwrap();
        assert!(validate_game_exe(&p.to_string_lossy()).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
