use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

#[cfg(target_os = "macos")]
mod focus_guard;

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

/// Resolved data directory — same root used by the agent sidecar.
struct DataDir(String);

/// Environment variables needed to (re)spawn the sidecar.
struct SidecarEnv {
    path: String,
    node_path: String,
    data_dir: Option<String>,
}

/// Set to true when the app is exiting — prevents sidecar auto-restart.
struct ShuttingDown(AtomicBool);

/// Maximum number of automatic sidecar restarts before giving up.
const MAX_SIDECAR_RESTARTS: u32 = 5;

/// Spawn the agent sidecar and return the event receiver + child handle.
fn spawn_sidecar(
    handle: &tauri::AppHandle,
    env: &SidecarEnv,
) -> Result<
    (
        tokio::sync::mpsc::Receiver<tauri_plugin_shell::process::CommandEvent>,
        CommandChild,
    ),
    String,
> {
    let shell = handle.shell();
    let mut cmd = shell
        .sidecar("agent")
        .map_err(|e| e.to_string())?
        .env("PATH", &env.path)
        .env("NODE_PATH", &env.node_path);

    if let Some(ref data_dir) = env.data_dir {
        cmd = cmd.env("OPENHELM_DATA_DIR", data_dir);
    }

    cmd.spawn().map_err(|e| e.to_string())
}

/// Open a locally-stored file with the OS default application.
///
/// `shell:allow-open` scopes only permit mailto/tel/https — `file://` is blocked.
/// This command shells out directly to macOS `open`, which accepts bare paths.
#[tauri::command]
fn open_local_file(path: String) -> Result<(), String> {
    use std::path::Path;
    // Reject anything that isn't an absolute path — no shell metacharacters needed.
    if !Path::new(&path).is_absolute() {
        return Err("Path must be absolute".into());
    }
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Copy a user-selected file into the OpenHelm files directory and return its metadata.
///
/// Called from the frontend after `@tauri-apps/plugin-dialog` `open()` returns a path.
/// The destination is `<data_dir>/files/<timestamp_hex>-<original_name>`.
#[tauri::command]
fn copy_file_to_storage(
    data_dir_state: tauri::State<'_, DataDir>,
    path: String,
) -> Result<serde_json::Value, String> {
    use std::path::Path;

    let src = Path::new(&path);
    if !src.exists() {
        return Err(format!("Source file not found: {path}"));
    }

    let files_dir = Path::new(&data_dir_state.0).join("files");
    std::fs::create_dir_all(&files_dir).map_err(|e| e.to_string())?;

    let file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");

    // Unique prefix from wall-clock nanoseconds — no extra dependency needed.
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dest_name = format!("{:016x}-{}", ts, file_name);
    let dest = files_dir.join(&dest_name);

    std::fs::copy(src, &dest).map_err(|e| e.to_string())?;

    let size = std::fs::metadata(&dest)
        .map(|m| m.len())
        .unwrap_or(0);

    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let mime_type = ext_to_mime(ext);

    Ok(serde_json::json!({
        "name": file_name,
        "path": dest.to_string_lossy(),
        "size": size,
        "mimeType": mime_type,
    }))
}

fn ext_to_mime(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "zip" => "application/zip",
        "csv" => "text/csv",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "json" => "application/json",
        "doc" | "docx" => "application/msword",
        "xls" | "xlsx" => "application/vnd.ms-excel",
        "ppt" | "pptx" => "application/vnd.ms-powerpoint",
        _ => "application/octet-stream",
    }
}

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
        // Escape backslashes, double-quotes, and newlines so the values are safe
        // inside AppleScript double-quoted string literals. Unescaped newlines
        // would break the AppleScript parser (string literals cannot span lines).
        let safe_title = title.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', " ").replace('\r', "");
        let safe_body = body.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', " ").replace('\r', "");
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
        .manage(ShuttingDown(AtomicBool::new(false)))
        .invoke_handler(tauri::generate_handler![
            write_to_sidecar,
            relaunch_app,
            send_notification,
            request_notification_permission,
            copy_file_to_storage,
            open_local_file,
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

            // Initialise the focus guard (NSWorkspace notification observer).
            // Prevents windows spawned by Claude Code job runs from stealing focus.
            #[cfg(target_os = "macos")]
            focus_guard::init();

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

            // Expose resolved data dir to Tauri commands (e.g. copy_file_to_storage).
            {
                let resolved = openhelm_data_dir.clone().unwrap_or_else(|| {
                    std::env::var("HOME")
                        .map(|h| format!("{}/.openhelm", h))
                        .unwrap_or_else(|_| ".openhelm".to_string())
                });
                app.manage(DataDir(resolved));
            }

            // Store environment for sidecar (re)spawning
            let sidecar_env = SidecarEnv {
                path: build_node_path(&bin_dir, &resource_dir),
                node_path: node_path_env,
                data_dir: openhelm_data_dir,
            };

            // Initial spawn
            let (rx, child) = spawn_sidecar(app.handle(), &sidecar_env)
                .expect("failed to spawn sidecar");

            // Store child handle so we can write to stdin
            let state = app.state::<SidecarChild>();
            *state.0.lock().unwrap() = Some(child);

            app.manage(sidecar_env);

            // Monitor sidecar stdout/stderr with auto-restart on unexpected termination
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(monitor_sidecar(handle, rx));

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // When the app exits (e.g. Cmd+Q), kill the sidecar so it doesn't
            // continue running as an orphan process in the background.
            if let tauri::RunEvent::Exit = event {
                // Signal the monitor loop to stop restarting
                app.state::<ShuttingDown>()
                    .0
                    .store(true, Ordering::Relaxed);
                let state = app.state::<SidecarChild>();
                if let Ok(mut guard) = state.0.lock() {
                    if let Some(child) = guard.take() {
                        let _ = child.kill();
                    }
                };
            }
        });
}

/// Forward sidecar stdout/stderr events. Returns the exit code when the sidecar terminates.
async fn forward_sidecar_events(
    handle: &tauri::AppHandle,
    mut rx: tokio::sync::mpsc::Receiver<tauri_plugin_shell::process::CommandEvent>,
) -> i32 {
    use tauri_plugin_shell::process::CommandEvent;

    let mut exit_code: i32 = -1;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                let text = String::from_utf8_lossy(&line);
                // Intercept focus_guard protocol events before forwarding to frontend.
                #[cfg(target_os = "macos")]
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                    match parsed.get("event").and_then(|e| e.as_str()) {
                        Some("focus_guard.addPid") => {
                            if let Some(pid) = parsed["data"]["pid"].as_i64() {
                                focus_guard::add_pid(pid as i32);
                            }
                            continue;
                        }
                        Some("focus_guard.removePid") => {
                            if let Some(pid) = parsed["data"]["pid"].as_i64() {
                                focus_guard::remove_pid(pid as i32);
                            }
                            continue;
                        }
                        Some("focus_guard.setEnabled") => {
                            if let Some(enabled) = parsed["data"]["enabled"].as_bool() {
                                focus_guard::set_enabled(enabled);
                            }
                            continue;
                        }
                        _ => {}
                    }
                }
                let _ = handle.emit("sidecar-stdout", text.to_string());
            }
            CommandEvent::Stderr(line) => {
                let text = String::from_utf8_lossy(&line);
                eprintln!("[agent] {}", text);
            }
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code.unwrap_or(-1);
                eprintln!("[agent] sidecar terminated with code: {}", exit_code);
                let _ = handle.emit(
                    "sidecar-terminated",
                    format!("{{\"code\":{}}}", exit_code),
                );
            }
            _ => {}
        }
    }

    exit_code
}

/// Monitor the sidecar and auto-restart on unexpected termination.
/// Gives up after MAX_SIDECAR_RESTARTS consecutive failures.
async fn monitor_sidecar(
    handle: tauri::AppHandle,
    initial_rx: tokio::sync::mpsc::Receiver<tauri_plugin_shell::process::CommandEvent>,
) {
    let mut restart_count: u32 = 0;
    let mut exit_code = forward_sidecar_events(&handle, initial_rx).await;

    loop {
        if handle.state::<ShuttingDown>().0.load(Ordering::Relaxed) {
            break;
        }

        // Don't restart if agent exited cleanly (stdin closed → graceful shutdown)
        if exit_code == 0 {
            eprintln!("[agent] sidecar exited cleanly, not restarting");
            break;
        }

        restart_count += 1;
        if restart_count > MAX_SIDECAR_RESTARTS {
            eprintln!(
                "[agent] sidecar crashed {} times, giving up on auto-restart",
                restart_count
            );
            break;
        }

        // Exponential backoff: 2s, 4s, 8s, 16s, 16s
        let delay_secs = 2u64.pow(restart_count.min(4));
        eprintln!(
            "[agent] restarting sidecar in {}s (attempt {}/{})",
            delay_secs, restart_count, MAX_SIDECAR_RESTARTS
        );
        tokio::time::sleep(std::time::Duration::from_secs(delay_secs)).await;

        if handle.state::<ShuttingDown>().0.load(Ordering::Relaxed) {
            break;
        }

        // Clear the dead child handle
        {
            let state = handle.state::<SidecarChild>();
            let _ = state.0.lock().map(|mut g| *g = None);
        }

        let spawn_result = {
            let env = handle.state::<SidecarEnv>();
            spawn_sidecar(&handle, &env)
        };
        match spawn_result {
            Ok((rx, child)) => {
                eprintln!("[agent] sidecar restarted (attempt {})", restart_count);
                {
                    let state = handle.state::<SidecarChild>();
                    let _ = state.0.lock().map(|mut g| *g = Some(child));
                }
                exit_code = forward_sidecar_events(&handle, rx).await;
            }
            Err(err) => {
                eprintln!("[agent] failed to restart sidecar: {}", err);
                exit_code = -1;
            }
        }
    }
}
