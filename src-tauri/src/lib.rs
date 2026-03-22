use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

/// Build an extended PATH string so the sidecar's `#!/usr/bin/env node` shebang
/// finds the correct Node.js binary in release builds.
///
/// macOS GUI apps inherit a minimal PATH (/usr/bin:/bin:…) that omits Homebrew,
/// NVM, fnm, etc. We must extend it — but we MUST use the same Node.js version
/// that was used to compile native addons (e.g. better-sqlite3). Using a different
/// version produces NODE_MODULE_VERSION mismatches and crashes the agent.
///
/// Strategy (highest → lowest priority):
///   1. Build-time node directory: patch-bundle.mjs writes the exact node binary
///      path used during `npm run tauri:build` into `.node-bin-dir` inside the
///      bundle. This guarantees the same version is used at runtime as was used to
///      compile bundled-node-modules/. Present on locally-built apps.
///   2. Homebrew locations (/opt/homebrew/bin, /usr/local/bin) — the most common
///      primary Node.js installation on macOS; typically matches the dev environment.
///   3. NVM / fnm — fallback for users who use version managers exclusively.
///      These come LAST so they cannot shadow a Homebrew installation that was used
///      to compile native addons.
///
/// In debug builds (tauri dev) the terminal already supplies the correct PATH, so
/// we return it unchanged.
fn build_node_path(bin_dir: &std::path::Path, resource_dir: &str) -> String {
    let current = std::env::var("PATH").unwrap_or_default();

    // Dev mode: inherit terminal PATH as-is.
    #[cfg(debug_assertions)]
    {
        let _ = bin_dir;
        let _ = resource_dir;
        return current;
    }

    // Release mode: build a priority-ordered PATH.
    #[cfg(not(debug_assertions))]
    {
        let mut extra: Vec<String> = Vec::new();

        // 1. Bundled Node.js binary (shipped inside Contents/Resources/ by CI).
        //    This is the most reliable choice — ABI-matched to bundled-node-modules.
        let bundled_node_bin = std::path::PathBuf::from(resource_dir)
            .join("bundled-node")
            .join("bin");
        if bundled_node_bin.join("node").exists() {
            extra.push(bundled_node_bin.to_string_lossy().to_string());
        }

        // 2. Build-time node directory (written by scripts/patch-bundle.mjs).
        //    Present on locally-built apps; points to the exact node that compiled deps.
        let node_bin_dir_file = bin_dir.join(".node-bin-dir");
        if let Ok(dir) = std::fs::read_to_string(&node_bin_dir_file) {
            let dir = dir.trim().to_string();
            if !dir.is_empty() {
                extra.push(dir);
            }
        }

        // 3. Homebrew (most common macOS primary install).
        extra.push("/opt/homebrew/bin".into()); // Apple Silicon
        extra.push("/usr/local/bin".into());    // Intel / official .pkg installer

        // 4. NVM / fnm — fallbacks only.
        if let Ok(home) = std::env::var("HOME") {
            let nvm_base = format!("{}/.nvm/versions/node", home);
            if let Ok(entries) = std::fs::read_dir(&nvm_base) {
                let mut versions: Vec<String> = entries
                    .filter_map(|e| e.ok())
                    .filter_map(|e| e.file_name().into_string().ok())
                    .collect();
                versions.sort();
                if let Some(latest) = versions.last() {
                    extra.push(format!("{}/{}/bin", nvm_base, latest));
                }
            }
            let fnm_base = format!("{}/.local/share/fnm/node-versions", home);
            if let Ok(entries) = std::fs::read_dir(&fnm_base) {
                let mut versions: Vec<String> = entries
                    .filter_map(|e| e.ok())
                    .filter_map(|e| e.file_name().into_string().ok())
                    .collect();
                versions.sort();
                if let Some(latest) = versions.last() {
                    extra.push(format!("{}/{}/installation/bin", fnm_base, latest));
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

/// Send a native macOS notification.
///
/// `tauri-plugin-notification` uses `mac-notification-sys` → `NSUserNotificationCenter`
/// on macOS desktop, which was removed in macOS 14 (Sonoma).
///
/// Release builds: invoke `UNUserNotificationCenter` directly — notifications are
/// attributed to OpenHelm (proper `.app` bundle exists).
///
/// Debug builds: `UNUserNotificationCenter.currentNotificationCenter()` crashes when the
/// process is not running inside a `.app` bundle (the raw `target/debug/openhelm` binary
/// has no bundle proxy). Fall back to `osascript` which works unconditionally.
#[tauri::command]
fn send_notification(title: String, body: String) -> Result<(), String> {
    #[cfg(all(target_os = "macos", not(debug_assertions)))]
    {
        use objc2_foundation::{NSString, NSUUID};
        use objc2_user_notifications::{
            UNMutableNotificationContent, UNNotificationContent, UNNotificationRequest,
            UNUserNotificationCenter,
        };
        use std::ops::Deref;

        let center = UNUserNotificationCenter::currentNotificationCenter();
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(&title));
        content.setBody(&NSString::from_str(&body));
        let identifier = NSUUID::new().UUIDString();
        let base_content: &UNNotificationContent = content.deref();
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &identifier,
            base_content,
            None,
        );
        center.addNotificationRequest_withCompletionHandler(&request, None);
    }

    // Dev builds: process runs as a raw binary without a bundle proxy; fall back to osascript.
    #[cfg(all(target_os = "macos", debug_assertions))]
    {
        let safe_title = title.replace('\\', "\\\\").replace('"', "\\\"");
        let safe_body = body.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(r#"display notification "{safe_body}" with title "{safe_title}""#);
        std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Request macOS notification permission via `UNUserNotificationCenter`.
/// Only meaningful in release builds where the app runs as a proper `.app` bundle.
/// In dev builds this is a no-op — osascript handles its own permission flow.
#[tauri::command]
fn request_notification_permission() {
    #[cfg(all(target_os = "macos", not(debug_assertions)))]
    {
        use block2::RcBlock;
        use objc2::runtime::Bool;
        use objc2_foundation::NSError;
        use objc2_user_notifications::{UNAuthorizationOptions, UNUserNotificationCenter};

        let center = UNUserNotificationCenter::currentNotificationCenter();
        let options = UNAuthorizationOptions::Alert
            | UNAuthorizationOptions::Sound
            | UNAuthorizationOptions::Badge;
        let handler = RcBlock::new(|_granted: Bool, _error: *mut NSError| {});
        center.requestAuthorizationWithOptions_completionHandler(options, &*handler);
    }
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
            send_notification,
            request_notification_permission,
        ])
        .on_window_event(|_window, _event| {
            // Window close (red ✕) quits the app normally.
            // The RunEvent::Exit handler below kills the agent sidecar.
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
            let resource_dir = app
                .path()
                .resource_dir()
                .map(|dir| dir.to_string_lossy().to_string())
                .unwrap_or_default();

            let node_path_env = if resource_dir.is_empty() {
                String::new()
            } else {
                format!("{}/bundled-node-modules", resource_dir)
            };

            // Ensure the agent sidecar is treated as CommonJS by Node.js.
            // Node.js resolves module type by walking UP the directory tree looking
            // for a package.json. When the built .app is run from inside a Node.js
            // workspace (e.g. during dev testing from target/release/bundle/), it
            // finds the workspace root package.json which has "type":"module", causing
            // a "require is not defined in ES module scope" crash. Writing a
            // {"type":"commonjs"} package.json next to our binary prevents this by
            // short-circuiting the traversal at the correct level.
            // Get the directory containing this binary (Contents/MacOS/ in production).
            // Used for both the package.json write and the build-time node path lookup.
            let bin_dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .unwrap_or_default();

            // Ensure the agent sidecar is treated as CommonJS by Node.js.
            // Node.js resolves module type by walking UP the directory tree looking
            // for a package.json. When the built .app is run from inside a Node.js
            // workspace (e.g. during dev testing from target/release/bundle/), it
            // finds the workspace root package.json which has "type":"module", causing
            // a "require is not defined in ES module scope" crash. Writing a
            // {"type":"commonjs"} package.json next to our binary prevents this by
            // short-circuiting the traversal at the correct level.
            let pkg_json = bin_dir.join("package.json");
            if !pkg_json.exists() {
                let _ = std::fs::write(&pkg_json, r#"{"type":"commonjs"}"#);
            }

            // In dev builds, use a separate data directory so dev and production
            // instances don't share state (enables testing onboarding, etc.).
            let openhelm_data_dir: Option<String> = {
                #[cfg(debug_assertions)]
                {
                    if std::env::var("OPENHELM_DATA_DIR").is_ok() {
                        std::env::var("OPENHELM_DATA_DIR").ok()
                    } else if let Ok(home) = std::env::var("HOME") {
                        Some(format!("{}/.openhelm-dev", home))
                    } else {
                        None
                    }
                }
                #[cfg(not(debug_assertions))]
                {
                    std::env::var("OPENHELM_DATA_DIR").ok()
                }
            };

            let shell = app.shell();
            let mut cmd = shell
                .sidecar("agent")
                .expect("failed to create sidecar command")
                .env("PATH", build_node_path(&bin_dir, &resource_dir))
                .env("NODE_PATH", node_path_env);

            if let Some(ref data_dir) = openhelm_data_dir {
                cmd = cmd.env("OPENHELM_DATA_DIR", data_dir);
            }

            let (mut rx, child) = cmd
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
                            // Notify the frontend so it can show an error
                            // instead of hanging on unanswered IPC requests.
                            let code = payload.code.unwrap_or(-1);
                            let _ = handle.emit(
                                "sidecar-terminated",
                                format!("{{\"code\":{}}}", code),
                            );
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // When the app exits (e.g. Cmd+Q), kill the sidecar so it doesn't
            // continue running as an orphan process in the background.
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<SidecarChild>();
                if let Ok(mut guard) = state.0.lock() {
                    if let Some(child) = guard.take() {
                        let _ = child.kill();
                    }
                };
            }
        });
}
