use serde::Serialize;
use std::sync::Mutex;
use sysinfo::{Components, System};

// enigo's trait methods (move_mouse, button, scroll, key, text, main_display)
// must be in scope for the desktop input commands to compile.
#[cfg(not(target_os = "android"))]
use enigo::{Keyboard, Mouse};

// JARVIS native backend.
//
// Desktop (Windows/macOS/Linux): full OS powers — input control (enigo),
// screen capture, app launching, real system stats.
//
// Android: the same UI and brain. On a ROOTED phone (KernelSU/Magisk — e.g.
// KernelSU v3.0.0 legacy) JARVIS gets the full Mark-III treatment: screen
// capture (screencap), input injection (input tap/swipe/text/keyevent), app
// launching (monkey/am) and root shell execution. Without root those reply
// honestly that they need root; everything else works regardless.

// ---------------- System info (all platforms) ----------------

#[derive(Serialize, Clone)]
pub struct SystemInfo {
    os_name: String,
    os_version: String,
    hostname: String,
    cpu_brand: String,
    cpu_cores: u32,
    cpu_usage_percent: f32,
    total_memory_gb: f32,
    used_memory_gb: f32,
    gpus: Vec<String>,
    uptime_secs: u64,
}

fn collect_info() -> SystemInfo {
    let mut sys = System::new_all();
    sys.refresh_all();

    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .unwrap_or_else(|| "Unknown CPU".into());

    let components = Components::new_with_refreshed_list();
    let gpus: Vec<String> = components
        .list()
        .iter()
        .filter_map(|c| {
            let label = c.label().to_lowercase();
            if label.contains("gpu") || label.contains("graphics") || label.contains("vga") {
                Some(c.label().to_string())
            } else {
                None
            }
        })
        .collect();

    SystemInfo {
        os_name: System::name().unwrap_or_else(|| "Unknown OS".into()),
        os_version: System::os_version().unwrap_or_default(),
        hostname: System::host_name().unwrap_or_default(),
        cpu_brand,
        cpu_cores: sys.cpus().len() as u32,
        cpu_usage_percent: sys.global_cpu_usage(),
        total_memory_gb: sys.total_memory() as f32 / 1073741824.0,
        used_memory_gb: sys.used_memory() as f32 / 1073741824.0,
        gpus,
        uptime_secs: System::uptime(),
    }
}

#[tauri::command]
fn system_info() -> SystemInfo {
    collect_info()
}

#[tauri::command]
fn system_info_stream(app: tauri::AppHandle) {
    use tauri::Emitter;
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let info = collect_info();
        if app.emit("desktop-stats", &info).is_err() {
            break; // app closed
        }
    });
}

// ---------------- Desktop: input control (enigo) ----------------
// Compiled only outside Android.

#[cfg(not(target_os = "android"))]
struct InputState(Mutex<Option<enigo::Enigo>>);

#[cfg(not(target_os = "android"))]
fn with_input<T>(
    state: &tauri::State<'_, InputState>,
    f: impl FnOnce(&mut enigo::Enigo) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.0.lock().map_err(|_| "input lock poisoned")?;
    if guard.is_none() {
        let enigo = enigo::Enigo::new(&enigo::Settings::default())
            .map_err(|e| format!("input init failed: {e}"))?;
        *guard = Some(enigo);
    }
    f(guard.as_mut().unwrap())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn mouse_move(
    state: tauri::State<'_, InputState>,
    x: i32,
    y: i32,
    relative: bool,
) -> Result<String, String> {
    with_input(&state, |enigo| {
        if relative {
            enigo
                .move_mouse(x, y, enigo::Coordinate::Rel)
                .map_err(|e| e.to_string())?;
        } else {
            enigo
                .move_mouse(x, y, enigo::Coordinate::Abs)
                .map_err(|e| e.to_string())?;
        }
        Ok(format!("Mouse moved to ({x}, {y})."))
    })
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn mouse_click(
    state: tauri::State<'_, InputState>,
    button: String,
    kind: String,
) -> Result<String, String> {
    use enigo::{Button, Direction};
    with_input(&state, |enigo| {
        let btn = match button.as_str() {
            "right" => Button::Right,
            "middle" => Button::Middle,
            _ => Button::Left,
        };
        let dir = match kind.as_str() {
            "down" => Direction::Press,
            "up" => Direction::Release,
            _ => Direction::Click,
        };
        enigo.button(btn, dir).map_err(|e| e.to_string())?;
        Ok(format!("{kind:?} {button} click sent."))
    })
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn mouse_scroll(state: tauri::State<'_, InputState>, amount: i32) -> Result<String, String> {
    with_input(&state, |enigo| {
        enigo.scroll(amount, enigo::Axis::Vertical).map_err(|e| e.to_string())?;
        Ok(format!("Scrolled {amount}."))
    })
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn mouse_double_click(state: tauri::State<'_, InputState>) -> Result<String, String> {
    use enigo::{Button, Direction};
    with_input(&state, |enigo| {
        enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(60));
        enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
        Ok("Double clicked.".into())
    })
}

/// Press, move smoothly, release — used for drags and drawing strokes.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn mouse_drag(
    state: tauri::State<'_, InputState>,
    from_x: i32,
    from_y: i32,
    to_x: i32,
    to_y: i32,
    steps: Option<i32>,
) -> Result<String, String> {
    use enigo::{Button, Direction};
    let steps = steps.unwrap_or(25).clamp(2, 200);
    with_input(&state, |enigo| {
        enigo
            .move_mouse(from_x, from_y, enigo::Coordinate::Abs)
            .map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(80));
        enigo
            .button(Button::Left, Direction::Press)
            .map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(80));
        for i in 1..=steps {
            let t = i as f32 / steps as f32;
            let x = from_x + ((to_x - from_x) as f32 * t) as i32;
            let y = from_y + ((to_y - from_y) as f32 * t) as i32;
            enigo
                .move_mouse(x, y, enigo::Coordinate::Abs)
                .map_err(|e| e.to_string())?;
            std::thread::sleep(std::time::Duration::from_millis(12));
        }
        std::thread::sleep(std::time::Duration::from_millis(80));
        enigo
            .button(Button::Left, Direction::Release)
            .map_err(|e| e.to_string())?;
        Ok(format!("Dragged ({from_x},{from_y}) → ({to_x},{to_y})."))
    })
}

/// Press at the first point, trace every point, release — freehand drawing.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn mouse_draw(state: tauri::State<'_, InputState>, points: Vec<(i32, i32)>) -> Result<String, String> {
    use enigo::{Button, Direction};
    if points.len() < 2 {
        return Err("need at least 2 points".into());
    }
    with_input(&state, |enigo| {
        let (sx, sy) = points[0];
        enigo
            .move_mouse(sx, sy, enigo::Coordinate::Abs)
            .map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(80));
        enigo
            .button(Button::Left, Direction::Press)
            .map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(80));
        for (x, y) in points.iter().skip(1) {
            enigo
                .move_mouse(*x, *y, enigo::Coordinate::Abs)
                .map_err(|e| e.to_string())?;
            std::thread::sleep(std::time::Duration::from_millis(12));
        }
        std::thread::sleep(std::time::Duration::from_millis(80));
        enigo
            .button(Button::Left, Direction::Release)
            .map_err(|e| e.to_string())?;
        Ok(format!("Drew a path through {} points.", points.len()))
    })
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn key_press(state: tauri::State<'_, InputState>, key: String) -> Result<String, String> {
    use enigo::Key;
    with_input(&state, |enigo| {
        // Named special keys
        const SPECIAL: &[(&str, Key)] = &[
            ("enter", Key::Return),
            ("tab", Key::Tab),
            ("escape", Key::Escape),
            ("space", Key::Space),
            ("backspace", Key::Backspace),
            ("delete", Key::Delete),
            ("up", Key::UpArrow),
            ("down", Key::DownArrow),
            ("left", Key::LeftArrow),
            ("right", Key::RightArrow),
            ("home", Key::Home),
            ("end", Key::End),
            ("pageup", Key::PageUp),
            ("pagedown", Key::PageDown),
            ("f4", Key::F4),
            ("f5", Key::F5),
            ("f11", Key::F11),
            ("volumeup", Key::VolumeUp),
            ("volumedown", Key::VolumeDown),
            ("volumemute", Key::VolumeMute),
            ("medianext", Key::MediaNextTrack),
            ("mediaprev", Key::MediaPrevTrack),
            ("mediaplaypause", Key::MediaPlayPause),
            // enigo 0.2.1 has no PrintScr variant; VK_SNAPSHOT (0x2C) is the
            // documented Windows virtual key for PrintScreen via Key::Other.
            ("printscreen", Key::Other(0x2C)),
            ("insert", Key::Insert),
            ("capslock", Key::CapsLock),
            ("numlock", Key::Numlock),
            ("meta", Key::Meta),
            ("shift", Key::Shift),
            ("control", Key::Control),
            ("alt", Key::Alt),
        ];
        let lower = key.to_lowercase();
        for (name, k) in SPECIAL {
            if lower == *name {
                enigo.key(*k, enigo::Direction::Click).map_err(|e| e.to_string())?;
                return Ok(format!("Pressed {name}."));
            }
        }
        // Single character
        let mut chars = key.chars();
        if let (Some(c), None) = (chars.next(), chars.next()) {
            enigo
                .key(enigo::Key::Unicode(c), enigo::Direction::Click)
                .map_err(|e| e.to_string())?;
            return Ok(format!("Pressed {c}."));
        }
        // Word of text → type it
        enigo.text(&key).map_err(|e| e.to_string())?;
        Ok(format!("Typed \"{key}\"."))
    })
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn type_text(state: tauri::State<'_, InputState>, text: String) -> Result<String, String> {
    with_input(&state, |enigo| {
        enigo.text(&text).map_err(|e| e.to_string())?;
        Ok(format!("Typed {} characters.", text.chars().count()))
    })
}

// ---------------- Screen capture / metrics ----------------
// The structs are shared by both platforms; the implementations differ.

#[derive(Serialize)]
pub struct Screenshot {
    data_uri: String,
    width: u32,
    height: u32,
}

#[derive(Serialize)]
pub struct ScreenMetrics {
    width: i32,
    height: i32,
}

#[derive(Serialize)]
pub struct OkMsg {
    ok: bool,
    message: String,
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn desktop_picture() -> Result<Screenshot, String> {
    use base64::Engine as _;
    use image::codecs::png::PngEncoder;
    use image::{ExtendedColorType, ImageEncoder};
    let screens =
        screenshots::Screen::all().map_err(|e| format!("screen enumerate failed: {e}"))?;
    let screen = screens.first().ok_or("no screen found")?;
    let shot = screen.capture().map_err(|e| format!("capture failed: {e}"))?;
    let (w, h) = (shot.width(), shot.height());
    let mut png = Vec::new();
    PngEncoder::new(&mut png)
        .write_image(shot.as_raw(), w, h, ExtendedColorType::Rgba8)
        .map_err(|e| format!("png encode failed: {e}"))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    Ok(Screenshot {
        data_uri: format!("data:image/png;base64,{b64}"),
        width: w,
        height: h,
    })
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn screen_metrics(state: tauri::State<'_, InputState>) -> Result<ScreenMetrics, String> {
    with_input(&state, |enigo| {
        let (width, height) = enigo
            .main_display()
            .map_err(|e| format!("display query failed: {e}"))?;
        Ok(ScreenMetrics { width, height })
    })
}

// ---------------- Desktop: apps / URLs / execution ----------------

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn launch_app(name: String) -> OkMsg {
    let lowered = name.to_lowercase();
    let candidates: Vec<&str> = match lowered.as_str() {
        "notepad" => vec!["notepad"],
        "calculator" | "calc" => vec!["calc"],
        "paint" => vec!["mspaint"],
        "explorer" | "files" => vec!["explorer"],
        "task manager" => vec!["taskmgr"],
        "cmd" | "terminal" | "powershell" => vec!["powershell"],
        "vscode" | "code" | "visual studio code" => vec!["code"],
        "spotify" => vec!["spotify"],
        "discord" => vec!["discord"],
        "steam" => vec!["steam"],
        other => vec![other],
    };
    for c in candidates {
        if open::that(c).is_ok() {
            return OkMsg {
                ok: true,
                message: format!("Launched {c}."),
            };
        }
    }
    OkMsg {
        ok: false,
        message: format!("Couldn't launch \"{name}\" on this system."),
    }
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn open_url(url: String) -> OkMsg {
    match open::that(url.clone()) {
        Ok(_) => OkMsg {
            ok: true,
            message: format!("Opened {url}."),
        },
        Err(e) => OkMsg {
            ok: false,
            message: format!("Failed to open URL: {e}"),
        },
    }
}

/// Launch ANY program, script or file by name or absolute path — not limited
/// to the open_app mapping. Falls back to the platform shell so PATH entries,
/// documents and folders resolve too.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn execute_command(command: String, args: Option<Vec<String>>) -> OkMsg {
    let arglist = args.unwrap_or_default();
    let direct = std::process::Command::new(&command).args(&arglist).spawn();
    match direct {
        Ok(child) => OkMsg {
            ok: true,
            message: format!("Launched {} (PID {}).", command, child.id()),
        },
        Err(direct_err) => {
            let mut line = command.clone();
            for a in &arglist {
                line.push(' ');
                line.push_str(a);
            }
            #[cfg(target_os = "windows")]
            let shell = std::process::Command::new("cmd")
                .args(["/C", "start", "", &line])
                .spawn();
            #[cfg(not(target_os = "windows"))]
            let shell = std::process::Command::new("sh")
                .args(["-c", &format!("exec {line} >/dev/null 2>&1 &")])
                .spawn();
            match shell {
                Ok(_) => OkMsg {
                    ok: true,
                    message: format!("Launched {command} via shell."),
                },
                Err(e) => OkMsg {
                    ok: false,
                    message: format!("Couldn't launch {command}: {direct_err} / shell: {e}"),
                },
            }
        }
    }
}

// ---------------- Android: root powers ----------------
// On a rooted phone (KernelSU/Magisk) JARVIS drives the whole device:
// screencap for vision, `input` for taps/swipes/text/keys, monkey/am for
// launching apps, and a root shell for everything else. Without root these
// commands explain what's missing instead of failing cryptically.

#[cfg(target_os = "android")]
/// Last pointer position — touchscreens have no persistent cursor, so
/// mouse_move stores the target and mouse_click taps there (See & Act flow).
static LAST_POS: Mutex<(i32, i32)> = Mutex::new((0, 0));

#[cfg(target_os = "android")]
fn android_unavailable(what: &str) -> String {
    format!(
        "{what} needs root on Android. Grant JARVIS root access in your root manager (KernelSU/Magisk) and try again — or use the Windows version of JARVIS, where this works fully."
    )
}

/// True when `su` works and really gives uid 0 (root granted to JARVIS).
#[cfg(target_os = "android")]
fn has_root() -> bool {
    std::process::Command::new("su")
        .arg("-c")
        .arg("id")
        .output()
        .map(|o| {
            o.status.success()
                && String::from_utf8_lossy(&o.stdout).contains("uid=0")
        })
        .unwrap_or(false)
}

/// Run a shell command as root, returning trimmed stdout.
#[cfg(target_os = "android")]
fn su_run(script: &str) -> Result<String, String> {
    let out = std::process::Command::new("su")
        .arg("-c")
        .arg(script)
        .output()
        .map_err(|e| format!("couldn't start su (root not granted?): {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(format!(
            "root command failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

#[cfg(target_os = "android")]
#[tauri::command]
fn root_status() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({ "root": has_root() }))
}

// Desktop build reports "no root" so the frontend bridge can call this
// unconditionally on any native platform.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn root_status() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({ "root": false }))
}

#[cfg(target_os = "android")]
#[tauri::command]
fn mouse_move(x: i32, y: i32, relative: bool) -> Result<String, String> {
    let mut pos = LAST_POS.lock().map_err(|_| "position lock poisoned")?;
    if relative {
        pos.0 = (pos.0 + x).clamp(0, 20000);
        pos.1 = (pos.1 + y).clamp(0, 20000);
    } else {
        *pos = (x, y);
    }
    Ok(format!("Pointer set to ({}, {}).", pos.0, pos.1))
}

#[cfg(target_os = "android")]
#[tauri::command]
fn mouse_click(button: String, kind: String) -> Result<String, String> {
    if !has_root() {
        return Err(android_unavailable("Clicking things on screen"));
    }
    let (x, y) = *LAST_POS.lock().map_err(|_| "position lock poisoned")?;
    // Right-click ≈ long-press on touch; middle/left are plain taps.
    if button == "right" {
        su_run(&format!("input swipe {x} {y} {x} {y} 600"))?;
        Ok(format!("Long-pressed ({x}, {y})."))
    } else {
        su_run(&format!("input tap {x} {y}"))?;
        let _ = kind;
        Ok(format!("Tapped ({x}, {y})."))
    }
}

#[cfg(target_os = "android")]
#[tauri::command]
fn mouse_double_click() -> Result<String, String> {
    if !has_root() {
        return Err(android_unavailable("Double-tapping the screen"));
    }
    let (x, y) = *LAST_POS.lock().map_err(|_| "position lock poisoned")?;
    su_run(&format!("input tap {x} {y}"))?;
    std::thread::sleep(std::time::Duration::from_millis(70));
    su_run(&format!("input tap {x} {y}"))?;
    Ok(format!("Double-tapped ({x}, {y})."))
}

#[cfg(target_os = "android")]
#[tauri::command]
fn mouse_scroll(amount: i32) -> Result<String, String> {
    if !has_root() {
        return Err(android_unavailable("Scrolling the screen"));
    }
    let (x, y) = *LAST_POS.lock().map_err(|_| "position lock poisoned")?;
    let dist = (amount.abs() * 3).clamp(120, 1200);
    let (fy, ty) = if amount > 0 { (y, y - dist) } else { (y, y + dist) };
    su_run(&format!("input swipe {x} {fy} {x} {ty} 250"))?;
    Ok(format!("Scrolled {amount} at ({x}, {y})."))
}

#[cfg(target_os = "android")]
#[tauri::command]
fn mouse_drag(
    from_x: i32,
    from_y: i32,
    to_x: i32,
    to_y: i32,
    steps: Option<i32>,
) -> Result<String, String> {
    if !has_root() {
        return Err(android_unavailable("Dragging on the screen"));
    }
    let dur = (steps.unwrap_or(25).clamp(2, 200) * 12).max(200);
    su_run(&format!("input swipe {from_x} {from_y} {to_x} {to_y} {dur}"))?;
    Ok(format!("Dragged ({from_x},{from_y}) → ({to_x},{to_y})."))
}

#[cfg(target_os = "android")]
#[tauri::command]
fn mouse_draw(points: Vec<(i32, i32)>) -> Result<String, String> {
    if !has_root() {
        return Err(android_unavailable("Drawing on the screen"));
    }
    if points.len() < 2 {
        return Err("need at least 2 points".into());
    }
    // Android 11+ supports motion-event injection — a true freehand stroke in
    // one root shell. Falls back to a simple swipe on older devices.
    let mut script = String::from("input motionevent");
    script.push_str(&format!(" DOWN {} {}", points[0].0, points[0].1));
    for (x, y) in points.iter().skip(1).take(120) {
        script.push_str(&format!(" ; input motionevent MOVE {x} {y}"));
    }
    let last = points.last().unwrap();
    script.push_str(&format!(" ; input motionevent UP {} {}", last.0, last.1));
    match su_run(&script) {
        Ok(_) => Ok(format!("Drew a path through {} points.", points.len())),
        Err(_) => {
            let (fx, fy) = points[0];
            su_run(&format!(
                "input swipe {fx} {fy} {} {} 400",
                last.0, last.1
            ))?;
            Ok(format!("Drew a stroke ({} points, simplified).", points.len()))
        }
    }
}

#[cfg(target_os = "android")]
#[tauri::command]
fn key_press(key: String) -> Result<String, String> {
    if !has_root() {
        return Err(android_unavailable("Pressing keys"));
    }
    // Android KEYCODE_* values for the named keys JARVIS knows.
    const SPECIAL: &[(&str, i32)] = &[
        ("enter", 66),
        ("back", 4),
        ("home", 3),
        ("tab", 61),
        ("escape", 111),
        ("space", 62),
        ("backspace", 67),
        ("delete", 112),
        ("up", 19),
        ("down", 20),
        ("left", 21),
        ("right", 22),
        ("pageup", 92),
        ("pagedown", 93),
        ("f4", 131),
        ("f5", 132),
        ("f11", 139),
        ("volumeup", 24),
        ("volumedown", 25),
        ("volumemute", 164),
        ("medianext", 87),
        ("mediaprev", 88),
        ("mediaplaypause", 85),
        ("power", 26),
        ("printscreen", 120),
        ("insert", 124),
        ("capslock", 115),
        ("numlock", 143),
        ("shift", 59),
        ("control", 129),
        ("alt", 57),
        ("meta", 117),
    ];
    let lower = key.to_lowercase();
    for (name, code) in SPECIAL {
        if lower == *name {
            su_run(&format!("input keyevent {code}"))?;
            return Ok(format!("Pressed {name}."));
        }
    }
    // Single character or word → type it (input text uses %s for spaces).
    let escaped = key.replace(' ', "%s");
    su_run(&format!("input text \"{escaped}\""))?;
    Ok(format!("Pressed/typed \"{key}\"."))
}

#[cfg(target_os = "android")]
#[tauri::command]
fn type_text(text: String) -> Result<String, String> {
    if !has_root() {
        return Err(android_unavailable("Typing text"));
    }
    let escaped = text.replace(' ', "%s");
    su_run(&format!("input text \"{escaped}\""))?;
    Ok(format!("Typed {} characters.", text.chars().count()))
}

/// Root screencap → PNG bytes → data URI. Width/height come straight from
/// the PNG IHDR header (big-endian u32s at offsets 16 and 20) — no image
/// decoding crate needed on Android.
#[cfg(target_os = "android")]
#[tauri::command]
fn desktop_picture() -> Result<Screenshot, String> {
    use base64::Engine as _;
    if !has_root() {
        return Err(android_unavailable("Capturing the screen"));
    }
    let path = "/data/local/tmp/jarvis_screen.png";
    su_run(&format!("screencap -p {path}"))?;
    let png = std::fs::read(path).map_err(|e| format!("couldn't read capture: {e}"))?;
    let _ = std::fs::remove_file(path);
    if png.len() < 24 || png[0..4] != [0x89, b'P', b'N', b'G'] {
        return Err("capture produced an invalid image".into());
    }
    let be = |b: &[u8]| u32::from_be_bytes([b[0], b[1], b[2], b[3]]);
    let width = be(&png[16..20]);
    let height = be(&png[20..24]);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    Ok(Screenshot {
        data_uri: format!("data:image/png;base64,{b64}"),
        width,
        height,
    })
}

/// Display size in the same space `input tap` uses — `wm size`, with or
/// without root. If even that fails the frontend falls back to the
/// screenshot's pixel dimensions.
#[cfg(target_os = "android")]
#[tauri::command]
fn screen_metrics() -> Result<ScreenMetrics, String> {
    let out = su_run("wm size").or_else(|_| -> Result<String, String> {
        let o = std::process::Command::new("wm")
            .arg("size")
            .output()
            .map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
    })?;
    // Lines look like "Physical size: 1080x2400" (plus an optional override).
    for line in out.lines().rev() {
        if let Some(size) = line.split(':').nth(1) {
            let mut it = size.trim().split('x');
            if let (Some(w), Some(h)) = (it.next(), it.next()) {
                if let (Ok(w), Ok(h)) = (w.trim().parse::<i32>(), h.trim().parse::<i32>()) {
                    return Ok(ScreenMetrics { width: w, height: h });
                }
            }
        }
    }
    Err("couldn't determine screen size".into())
}

/// Launch apps by name: known package map first, then a fuzzy search over
/// `pm list packages`. Launching doesn't need root on most devices.
#[cfg(target_os = "android")]
#[tauri::command]
fn launch_app(name: String) -> OkMsg {
    let lowered = name.to_lowercase().trim().to_string();
    let known: Option<&str> = match lowered.as_str() {
        "camera" => Some("com.android.camera"),
        "gallery" | "photos" => Some("com.miui.gallery"),
        "chrome" | "browser" => Some("com.android.chrome"),
        "youtube" => Some("com.google.android.youtube"),
        "settings" => Some("com.android.settings"),
        "phone" | "dialer" => Some("com.android.dialer"),
        "messages" | "sms" => Some("com.android.mms"),
        "whatsapp" => Some("com.whatsapp"),
        "telegram" => Some("org.telegram.messenger"),
        "instagram" => Some("com.instagram.android"),
        "spotify" => Some("com.spotify.music"),
        _ => None,
    };
    let launch = |pkg: &str| -> Result<String, String> {
        su_run(&format!(
            "monkey -p {pkg} -c android.intent.category.LAUNCHER 1"
        ))
        .map(|_| format!("Launched {pkg}."))
        .or_else(|_| {
            // am start needs the launcher activity; `cmd package resolve-activity`
            // finds it. Root not required on most builds for either.
            let act = su_run(&format!(
                "cmd package resolve-activity --brief {pkg} | tail -n 1"
            ))?;
            let act = act.lines().next().unwrap_or("").trim().to_string();
            if act.is_empty() {
                return Err(format!("no launcher activity for {pkg}"));
            }
            su_run(&format!("am start -n {act}")).map(|_| format!("Launched {pkg}."))
        })
    };
    if let Some(pkg) = known {
        return match launch(pkg) {
            Ok(m) => OkMsg { ok: true, message: m },
            Err(e) => OkMsg { ok: false, message: e },
        };
    }
    // Fuzzy: search installed packages for the requested name.
    let list = su_run("pm list packages")
        .or_else(|_| -> Result<String, String> {
            let o = std::process::Command::new("pm")
                .arg("list")
                .arg("packages")
                .output()
                .map_err(|e| e.to_string())?;
            Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
        })
        .unwrap_or_default();
    for line in list.lines() {
        let pkg = line.trim().strip_prefix("package:").unwrap_or("").trim();
        if pkg.contains(&lowered) {
            return match launch(pkg) {
                Ok(m) => OkMsg { ok: true, message: m },
                Err(e) => OkMsg { ok: false, message: e },
            };
        }
    }
    OkMsg {
        ok: false,
        message: format!("Couldn't find an installed app matching \"{name}\"."),
    }
}

#[cfg(target_os = "android")]
#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) -> Result<OkMsg, String> {
    // Real on every Android device: hands the URL to the system browser.
    use tauri_plugin_opener::OpenerExt;
    match app.opener().open_url(url.clone(), None::<&str>) {
        Ok(_) => Ok(OkMsg {
            ok: true,
            message: format!("Opened {url} in your browser."),
        }),
        Err(e) => Ok(OkMsg {
            ok: false,
            message: format!("Couldn't open {url}: {e}"),
        }),
    }
}

/// Run an arbitrary shell command — needs root, captures output.
#[cfg(target_os = "android")]
#[tauri::command]
fn execute_command(command: String, args: Option<Vec<String>>) -> OkMsg {
    let arglist = args.unwrap_or_default();
    // The root-GRANT probe: running `su` is itself what makes KernelSU /
    // Magisk pop their allow dialog, so it must bypass the has_root()
    // pre-check — otherwise root could never be requested from the app.
    if command == "su" {
        let script = arglist.join(" ");
        return match std::process::Command::new("su").arg("-c").arg(&script).output() {
            Ok(o) => {
                if o.status.success() {
                    OkMsg {
                        ok: true,
                        message: "Root granted — JARVIS has superuser access.".into(),
                    }
                } else {
                    OkMsg {
                        ok: false,
                        message: "Root request wasn't approved. Allow JARVIS in your manager (KernelSU / Magisk → Superuser) and try again.".into(),
                    }
                }
            }
            Err(e) => OkMsg {
                ok: false,
                message: format!("No root manager answered (is KernelSU or Magisk installed?): {e}"),
            },
        };
    }
    if !has_root() {
        return OkMsg {
            ok: false,
            message: android_unavailable("Running shell commands"),
        };
    }
    let mut line = command.clone();
    if !arglist.is_empty() {
        line.push(' ');
        line.push_str(&arglist.join(" "));
    }
    match su_run(&line) {
        Ok(out) => OkMsg {
            ok: true,
            message: if out.is_empty() {
                format!("{command} ran (no output).")
            } else {
                out.chars().take(2000).collect()
            },
        },
        Err(e) => OkMsg {
            ok: false,
            message: e,
        },
    }
}

// ---------------- Notifications (all platforms) ----------------

#[tauri::command]
fn notify(app: tauri::AppHandle, title: String, body: String) -> Result<String, String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())?;
    Ok("Notification shown.".into())
}

// ---------------- Status ----------------

#[tauri::command]
fn desktop_status() -> String {
    "desktop-bridge-online".to_string()
}

// Both platforms define every command name, so one flat handler list works
// everywhere — the implementations just differ per platform.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(not(target_os = "android"))]
    let builder = builder.manage(InputState(Mutex::new(None)));

    builder
        .invoke_handler(tauri::generate_handler![
            system_info,
            system_info_stream,
            root_status,
            mouse_move,
            mouse_click,
            mouse_double_click,
            mouse_scroll,
            mouse_drag,
            mouse_draw,
            key_press,
            type_text,
            desktop_picture,
            launch_app,
            open_url,
            execute_command,
            screen_metrics,
            notify,
            desktop_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
