use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

/// Build an extended PATH string that prepends common Node.js install locations.
/// macOS GUI apps inherit a minimal PATH (/usr/bin:/bin:...) that may not include
/// Homebrew (/opt/homebrew/bin) or NVM paths. Prepending them ensures the sidecar's
/// #!/usr/bin/env node shebang can find node on most developer machines.
///
/// In debug builds (tauri dev) the terminal already supplies the correct PATH, so we
/// return it unchanged. Overriding it can cause the sidecar to run with a different
/// Node.js version than the one used to compile native addons (e.g. better-sqlite3),
/// producing NODE_MODULE_VERSION mismatches.
fn build_node_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();

    // Dev mode: inherit terminal PATH as-is so native addons and the sidecar's node
    // are guaranteed to match.
    #[cfg(debug_assertions)]
    return current;

    // Release mode: macOS .app bundles have a minimal PATH — prepend known locations.
    #[cfg(not(debug_assertions))]
    {
        let mut extra: Vec<String> = vec![
            "/opt/homebrew/bin".into(),  // Homebrew (Apple Silicon)
            "/usr/local/bin".into(),     // Homebrew (Intel) / official .pkg installer
        ];

        // NVM: check for the highest installed version under ~/.nvm
        if let Ok(home) = std::env::var("HOME") {
            let nvm_base = format!("{}/.nvm/versions/node", home);
            if let Ok(entries) = std::fs::read_dir(&nvm_base) {
                let mut versions: Vec<String> = entries
                    .filter_map(|e| e.ok())
                    .filter_map(|e| e.file_name().into_string().ok())
                    .collect();
                versions.sort();
                if let Some(latest) = versions.last() {
                    extra.insert(0, format!("{}/{}/bin", nvm_base, latest));
                }
            }

            // fnm (Fast Node Manager)
            let fnm_base = format!("{}/.local/share/fnm/node-versions", home);
            if let Ok(entries) = std::fs::read_dir(&fnm_base) {
                let mut versions: Vec<String> = entries
                    .filter_map(|e| e.ok())
                    .filter_map(|e| e.file_name().into_string().ok())
                    .collect();
                versions.sort();
                if let Some(latest) = versions.last() {
                    extra.insert(0, format!("{}/{}/installation/bin", fnm_base, latest));
                }
            }
        }

        format!("{}:{}", extra.join(":"), current)
    }
}

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
            // Create the main window programmatically so we can set traffic_light_position.
            // The header row is h-10 (40px); traffic lights at y=14 puts button centres at ~20px,
            // matching the logo/chat button centre in that row.
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("/".into()),
            )
            .title("")
            .inner_size(1200.0, 800.0)
            .min_inner_size(960.0, 600.0)
            .resizable(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .traffic_light_position(tauri::LogicalPosition::new(16.0_f64, 24.0_f64))
            .build()?;

            // Resolve the bundled-node-modules resource directory so that
            // better-sqlite3 (and its bindings helper) can be found at runtime.
            // In production the path is inside Contents/Resources/; in dev it
            // falls back to an empty string (workspace node_modules are found
            // via normal directory traversal instead).
            let node_path_env = app
                .path()
                .resource_dir()
                .map(|dir| {
                    dir.join("bundled-node-modules")
                        .to_string_lossy()
                        .to_string()
                })
                .unwrap_or_default();

            let shell = app.shell();
            let (mut rx, child) = shell
                .sidecar("agent")
                .expect("failed to create sidecar command")
                .env("PATH", build_node_path())
                .env("NODE_PATH", node_path_env)
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
