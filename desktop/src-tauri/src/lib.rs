use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Saved window position on disk, so the pet returns to where you left it.
#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct SavedPosition {
    x: f64,
    y: f64,
}

fn position_file(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("position.json")
}

#[tauri::command]
fn save_position(app: tauri::AppHandle, x: f64, y: f64) -> Result<(), String> {
    let data = SavedPosition { x, y };
    let path = position_file(&app);
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    fs::write(&path, serde_json::to_string(&data).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn load_position(app: tauri::AppHandle) -> Result<SavedPosition, String> {
    let path = position_file(&app);
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| e.to_string()),
        Err(_) => Ok(SavedPosition::default()),
    }
}

#[tauri::command]
fn set_always_on_top(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.set_always_on_top(on).map_err(|e| e.to_string())
    } else {
        Err("window not found".into())
    }
}

#[tauri::command]
fn is_always_on_top(app: tauri::AppHandle) -> Result<bool, String> {
    if let Some(win) = app.get_webview_window("main") {
        win.is_always_on_top().map_err(|e| e.to_string())
    } else {
        Err("window not found".into())
    }
}

#[tauri::command]
fn reset_position(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        // Bottom-right corner, with a small margin.
        if let Ok(Some(monitor)) = win.primary_monitor() {
            let size = monitor.size();
            let scale = monitor.scale_factor();
            let w = win.outer_size().map_err(|e| e.to_string())?;
            let x = (size.width as f64 / scale) - (w.width as f64 / scale) - 24.0;
            let y = (size.height as f64 / scale) - (w.height as f64 / scale) - 24.0;
            win.set_position(tauri::PhysicalPosition::new(x, y))
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    } else {
        Err("window not found".into())
    }
}

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// Move the window by a delta, in logical pixels. Used by the JS manual-drag
/// implementation: gtk_window_begin_move_drag (behind Tauri's drag region)
/// silently fails on some Linux compositors (KWin + XWayland), so the
/// frontend drives movement itself via pointer events.
#[tauri::command]
fn nudge_window(app: tauri::AppHandle, dx: f64, dy: f64) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let pos = win.outer_position().map_err(|e| e.to_string())?;
        let scale = win.scale_factor().map_err(|e| e.to_string())?;
        win.set_position(tauri::PhysicalPosition::new(
            pos.x + (dx * scale) as i32,
            pos.y + (dy * scale) as i32,
        ))
        .map_err(|e| e.to_string())
    } else {
        Err("window not found".into())
    }
}

/// DSH base URL for state polling. The plugin host sets WHALE_DSH_URL when it
/// spawns us; fall back to the default port when launched manually.
#[tauri::command]
fn get_dsh_url() -> String {
    std::env::var("WHALE_DSH_URL").unwrap_or_else(|_| "http://127.0.0.1:3080".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin: prevents a second pet window from ever appearing.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            save_position,
            load_position,
            set_always_on_top,
            is_always_on_top,
            reset_position,
            quit,
            nudge_window,
            get_dsh_url
        ])
        .setup(|app| {
            // Restore saved position once the window is ready.
            if let Some(win) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                let pos_path = position_file(&app_handle);
                if let Ok(raw) = std::fs::read_to_string(&pos_path) {
                    if let Ok(pos) = serde_json::from_str::<SavedPosition>(&raw) {
                        let _ = win.set_position(tauri::PhysicalPosition::new(pos.x, pos.y));
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Persist position on move so the pet returns to where you left it.
            if let tauri::WindowEvent::Moved(pos) = event {
                let app = window.app_handle();
                let _ = save_position(app.clone(), pos.x as f64, pos.y as f64);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running desk-whale");
}
