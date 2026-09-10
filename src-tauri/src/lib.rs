use serde::Serialize;
use sysinfo::System;

#[derive(Serialize)]
pub struct SystemInfo {
    os_name: String,
    os_version: String,
    kernel: String,
    hostname: String,
    cpu_brand: String,
    cpu_cores: u32,
    cpu_usage_percent: f32,
    total_memory_gb: f32,
    used_memory_gb: f32,
    gpu_names: Vec<String>,
    uptime_secs: u64,
}

#[tauri::command]
fn system_info() -> SystemInfo {
    let mut sys = System::new_all();
    sys.refresh_all();

    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .unwrap_or_else(|| "Unknown CPU".into());

    let gpus: Vec<String> = sys
        .components()
        .iter()
        .filter(|c| c.label().to_lowercase().contains("gpu"))
        .map(|c| c.label().to_string())
        .collect();

    SystemInfo {
        os_name: System::name().unwrap_or_else(|| "Unknown OS".into()),
        os_version: System::os_version().unwrap_or_default(),
        kernel: System::kernel_version().unwrap_or_default(),
        hostname: System::host_name().unwrap_or_default(),
        cpu_brand,
        cpu_cores: sys.cpus().len() as u32,
        cpu_usage_percent: sys.global_cpu_usage(),
        total_memory_gb: sys.total_memory() as f32 / 1024.0 / 1024.0 / 1024.0,
        used_memory_gb: sys.used_memory() as f32 / 1024.0 / 1024.0 / 1024.0,
        gpu_names: gpus,
        uptime_secs: System::uptime(),
    }
}

#[derive(Serialize)]
pub struct OpenResult {
    ok: bool,
    message: String,
}

#[tauri::command]
fn launch_app(name: String) -> OpenResult {
    let candidates: Vec<&str> = match name.to_lowercase().as_str() {
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
            return OpenResult {
                ok: true,
                message: format!("Launched {c}."),
            };
        }
    }
    OpenResult {
        ok: false,
        message: format!("Couldn't launch \"{name}\" on this system."),
    }
}

#[tauri::command]
fn open_url(url: String) -> OpenResult {
    match tauri_plugin_opener::open_url(url.clone()) {
        Ok(_) => OpenResult {
            ok: true,
            message: format!("Opened {url}."),
        },
        Err(e) => OpenResult {
            ok: false,
            message: format!("Failed to open URL: {e}"),
        },
    }
}

#[tauri::command]
fn desktop_status() -> String {
    "desktop-bridge-online".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            system_info,
            launch_app,
            open_url,
            desktop_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
