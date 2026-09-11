use base64::Engine as _;
use enigo::{Keyboard, Mouse};
use serde::Serialize;
use std::sync::Mutex;
use sysinfo::{Components, System};

// ---------------- System info ----------------

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

    // Probe common GPU component labels (varies by driver/platform).
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

// ---------------- Input control (enigo) ----------------

struct InputState(Mutex<Option<enigo::Enigo>>);

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

#[tauri::command]
fn mouse_scroll(state: tauri::State<'_, InputState>, amount: i32) -> Result<String, String> {
    with_input(&state, |enigo| {
        enigo.scroll(amount, enigo::Axis::Vertical).map_err(|e| e.to_string())?;
        Ok(format!("Scrolled {amount}."))
    })
}

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

#[tauri::command]
fn type_text(state: tauri::State<'_, InputState>, text: String) -> Result<String, String> {
    with_input(&state, |enigo| {
        enigo.text(&text).map_err(|e| e.to_string())?;
        Ok(format!("Typed {} characters.", text.chars().count()))
    })
}

// ---------------- Desktop capture ----------------

#[derive(Serialize)]
pub struct Screenshot {
    data_uri: String,
    width: u32,
    height: u32,
}

#[tauri::command]
fn desktop_picture() -> Result<Screenshot, String> {
    use image::codecs::png::PngEncoder;
    use image::{ExtendedColorType, ImageEncoder};
    let screens =
        screenshots::Screen::all().map_err(|e| format!("screen enumerate failed: {e}"))?;
    let screen = screens.first().ok_or("no screen found")?;
    let shot = screen.capture().map_err(|e| format!("capture failed: {e}"))?;
    let (w, h) = (shot.width(), shot.height());
    let mut png = Vec::new();
    PngEncoder::new(&mut png)
        .write_image(
            shot.as_raw(),
            w,
            h,
            ExtendedColorType::Rgba8,
        )
        .map_err(|e| format!("png encode failed: {e}"))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    Ok(Screenshot {
        data_uri: format!("data:image/png;base64,{b64}"),
        width: w,
        height: h,
    })
}

// ---------------- Apps / URLs / notifications ----------------

#[derive(Serialize)]
pub struct OkMsg {
    ok: bool,
    message: String,
}

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

/// Display size in the same coordinate space `mouse_move` (Abs) uses —
/// lets the frontend scale screenshot pixels to cursor coordinates exactly.
#[derive(Serialize)]
pub struct ScreenMetrics {
    width: i32,
    height: i32,
}

#[tauri::command]
fn screen_metrics(state: tauri::State<'_, InputState>) -> Result<ScreenMetrics, String> {
    with_input(&state, |enigo| {
        let (width, height) = enigo
            .main_display()
            .map_err(|e| format!("display query failed: {e}"))?;
        Ok(ScreenMetrics { width, height })
    })
}

/// Launch ANY program, script or file by name or absolute path — not limited
/// to the open_app mapping. Falls back to the platform shell so PATH entries,
/// documents and folders resolve too.
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(InputState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            system_info,
            system_info_stream,
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
            notify,
            desktop_status,
            screen_metrics
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
