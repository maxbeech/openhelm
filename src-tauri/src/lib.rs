use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

struct SidecarChild(Mutex<Option<CommandChild>>);

#[tauri::command]
fn write_to_sidecar(
    state: tauri::State<'_, SidecarChild>,
    message: String,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.as_mut() {
        child
            .write((message + "\n").as_bytes())
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Sidecar not running".into())
    }
}

#[tauri::command]
fn relaunch_app(app: tauri::AppHandle) {
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(SidecarChild(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            write_to_sidecar,
            relaunch_app,
        ])
        .on_window_event(|window, event| {
            // Hide window on close instead of quitting (agent keeps running).
            // The macOS "Quit" menu item still terminates the app normally.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let shell = app.shell();
            let (mut rx, child) = shell
                .sidecar("agent")
                .expect("failed to create sidecar command")
                .spawn()
                .expect("failed to spawn sidecar");

            // Store child handle so we can write to stdin
            let state = app.state::<SidecarChild>();
            *state.0.lock().unwrap() = Some(child);

            // Forward sidecar stdout/stderr as Tauri events
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;

                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let text = String::from_utf8_lossy(&line);
                            let _ = handle.emit("sidecar-stdout", text.to_string());
                        }
                        CommandEvent::Stderr(line) => {
                            let text = String::from_utf8_lossy(&line);
                            eprintln!("[agent] {}", text);
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!(
                                "[agent] sidecar terminated with code: {:?}",
                                payload.code
                            );
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
