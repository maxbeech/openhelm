//! Focus Guard — prevents windows spawned by Claude Code job runs from stealing focus.
//!
//! Registers an NSWorkspace notification observer that fires whenever a new application
//! activates on macOS. If the activating app is a descendant (in the process tree) of
//! any currently running Claude Code process, it is immediately hidden.
//!
//! Browser windows (Chrome, etc.) are also hidden when they self-activate as
//! descendants. However, if the user actively insists by re-activating the browser
//! within a short grace period (0.5s), the guard yields — the user clearly wants
//! to interact (e.g. for CAPTCHA solving).
//!
//! Architecture:
//! - `init()` — called once at app startup on the main thread
//! - `add_pid(pid)` / `remove_pid(pid)` — called by the agent sidecar stdout handler
//!   when a Claude Code job starts/ends
//! - `set_enabled(bool)` — toggled by user preference

#![cfg(target_os = "macos")]

use core::ptr::NonNull;
use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use objc2_app_kit::{
    NSRunningApplication, NSWorkspace, NSWorkspaceApplicationKey,
    NSWorkspaceDidActivateApplicationNotification,
};
use objc2_foundation::NSNotification;

static ENABLED: AtomicBool = AtomicBool::new(true);

fn guarded_pids() -> &'static Mutex<HashSet<i32>> {
    static PIDS: OnceLock<Mutex<HashSet<i32>>> = OnceLock::new();
    PIDS.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Tracks the last time each browser PID was hidden by the focus guard.
/// When a browser re-activates within BROWSER_GRACE_MS of being hidden,
/// the user is actively insisting — the guard yields and stops hiding it.
fn browser_hide_times() -> &'static Mutex<HashMap<i32, Instant>> {
    static TIMES: OnceLock<Mutex<HashMap<i32, Instant>>> = OnceLock::new();
    TIMES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// PIDs that the user has "overridden" by re-activating within the grace period.
/// Once overridden, the focus guard won't hide that browser again (until it dies).
fn overridden_pids() -> &'static Mutex<HashSet<i32>> {
    static PIDS: OnceLock<Mutex<HashSet<i32>>> = OnceLock::new();
    PIDS.get_or_init(|| Mutex::new(HashSet::new()))
}

/// How quickly the user must re-activate a hidden browser to override the guard.
const BROWSER_GRACE_MS: u128 = 500;

/// Initialise the focus guard. Must be called once, on the main thread, during app setup.
pub fn init() {
    use block2::RcBlock;

    unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let center = workspace.notificationCenter();

        // Use block-based observer API — the notification center retains the observer.
        let block: RcBlock<dyn Fn(NonNull<NSNotification>) + 'static> =
            RcBlock::new(move |notification| {
                // SAFETY: notification pointer is valid for the duration of the callback
                on_app_activated(notification);
            });

        let observer = center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceDidActivateApplicationNotification),
            None,
            None,
            &*block,
        );

        // The notification center retains the observer for the app's lifetime.
        // We intentionally leak our Rust handle — the observation stays active forever.
        std::mem::forget(observer);
    }
}

/// Called by the NSWorkspace notification center on every app activation.
///
/// # Safety
/// `notification` must be a valid pointer to a live `NSNotification` object.
unsafe fn on_app_activated(notification: NonNull<NSNotification>) {
    if !ENABLED.load(Ordering::Relaxed) {
        return;
    }

    // Clone and release the lock immediately. `is_descendant_of` calls
    // `proc_pidinfo` syscalls which must not run while holding the mutex —
    // doing so would block `add_pid`/`remove_pid` calls from the main thread
    // and risk a deadlock during high process-tree churn.
    let guarded = match guarded_pids().lock() {
        Ok(g) => g.clone(), // intentional: lock is released here
        Err(_) => return,
    };

    if guarded.is_empty() {
        return;
    }

    let notif = notification.as_ref();
    let Some(user_info) = notif.userInfo() else {
        return;
    };

    // NSWorkspaceApplicationKey is &'static NSString. Cast to &AnyObject for objectForKey.
    let key = &*(NSWorkspaceApplicationKey as *const _ as *const objc2::runtime::AnyObject);
    let Some(obj) = user_info.objectForKey(key) else {
        return;
    };

    // The value stored under NSWorkspaceApplicationKey is guaranteed by AppKit to be
    // an NSRunningApplication. Downcast via pointer identity cast.
    // Retained<T> implements Deref<Target = T>, so &*obj gives &AnyObject.
    let app = &*(&*obj as *const objc2::runtime::AnyObject as *const NSRunningApplication);
    let pid = app.processIdentifier();

    // Check if this is a browser app
    let is_browser = app
        .bundleIdentifier()
        .map(|b| is_browser_bundle(&b.to_string()))
        .unwrap_or(false);

    // If the user has overridden this browser PID (by re-activating quickly), allow it.
    if is_browser {
        if let Ok(overridden) = overridden_pids().lock() {
            if overridden.contains(&pid) {
                return;
            }
        }
    }

    for &guarded_pid in &guarded {
        if is_descendant_of(pid, guarded_pid) {
            if is_browser {
                // Browser descendant — check the re-activation grace period.
                // If we hid this browser recently and it's activating again,
                // the user is insisting → override and allow.
                if let Ok(mut times) = browser_hide_times().lock() {
                    if let Some(&last_hide) = times.get(&pid) {
                        if last_hide.elapsed().as_millis() < BROWSER_GRACE_MS {
                            // User re-activated quickly — permanently allow this PID
                            times.remove(&pid);
                            if let Ok(mut overridden) = overridden_pids().lock() {
                                overridden.insert(pid);
                            }
                            return;
                        }
                    }
                }
            }

            // Hide the app
            app.hide();

            // Track the hide time for browsers (grace period logic)
            if is_browser {
                if let Ok(mut times) = browser_hide_times().lock() {
                    times.insert(pid, Instant::now());
                }
            }

            break;
        }
    }
}

/// Known browser bundle identifiers.
const BROWSER_BUNDLES: &[&str] = &[
    "com.google.chrome",
    "org.chromium.chromium",
    "com.microsoft.edgemac",
    "com.brave.browser",
    "com.operasoftware.opera",
    "com.vivaldi.vivaldi",
];

/// Returns true if `bundle_id` belongs to a browser application.
fn is_browser_bundle(bundle_id: &str) -> bool {
    let lower = bundle_id.to_ascii_lowercase();
    BROWSER_BUNDLES.iter().any(|&b| lower == b)
}

/// Returns true if `pid` is at or below `ancestor` in the macOS process tree.
/// Walks up at most 20 hops to guard against cycles (PID 1 = launchd = root).
fn is_descendant_of(mut pid: libc::pid_t, ancestor: libc::pid_t) -> bool {
    for _ in 0..20 {
        if pid == ancestor {
            return true;
        }
        if pid <= 1 {
            return false;
        }
        match get_parent_pid(pid) {
            Some(ppid) if ppid != pid => pid = ppid,
            _ => return false,
        }
    }
    false
}

/// Fetches the parent PID of `pid` using `proc_pidinfo` (macOS libproc).
fn get_parent_pid(pid: libc::pid_t) -> Option<libc::pid_t> {
    // SAFETY: proc_pidinfo fills the provided struct; return value is bytes written.
    unsafe {
        let mut info: libc::proc_bsdinfo = std::mem::zeroed();
        let ret = libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            &mut info as *mut libc::proc_bsdinfo as *mut libc::c_void,
            std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int,
        );
        if ret > 0 {
            Some(info.pbi_ppid as libc::pid_t)
        } else {
            None
        }
    }
}

/// Register a Claude Code process PID as guarded.
/// Windows created by descendants of this PID will be hidden while it is guarded.
pub fn add_pid(pid: i32) {
    if let Ok(mut pids) = guarded_pids().lock() {
        pids.insert(pid);
    }
}

/// Deregister a PID when the associated job run finishes.
/// Also cleans up any browser override/timing state for descendants.
pub fn remove_pid(pid: i32) {
    if let Ok(mut pids) = guarded_pids().lock() {
        pids.remove(&pid);
    }
    // Clean up stale browser tracking entries (best-effort, non-blocking)
    if let Ok(mut times) = browser_hide_times().lock() {
        times.retain(|_, t| t.elapsed().as_secs() < 3600);
    }
    if let Ok(mut overridden) = overridden_pids().lock() {
        // We can't easily know which browser PIDs belonged to this guarded PID,
        // so just prune dead PIDs. This is a periodic cleanup, not per-run.
        overridden.retain(|&p| get_parent_pid(p).is_some());
    }
}

/// Enable or disable the focus guard globally (persisted as a user setting).
pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::is_browser_bundle;

    #[test]
    fn known_browser_bundles_are_excluded() {
        assert!(is_browser_bundle("com.google.Chrome"));
        assert!(is_browser_bundle("com.google.chrome")); // case-insensitive
        assert!(is_browser_bundle("org.chromium.Chromium"));
        assert!(is_browser_bundle("com.microsoft.edgemac"));
        assert!(is_browser_bundle("com.brave.Browser"));
        assert!(is_browser_bundle("com.operasoftware.Opera"));
        assert!(is_browser_bundle("com.vivaldi.Vivaldi"));
    }

    #[test]
    fn non_browser_apps_are_not_excluded() {
        assert!(!is_browser_bundle("com.apple.terminal"));
        assert!(!is_browser_bundle("com.apple.xcode"));
        assert!(!is_browser_bundle("com.microsoft.VSCode"));
        assert!(!is_browser_bundle("")); // empty string
        assert!(!is_browser_bundle("com.google.chrome.extra")); // prefix-only should not match
    }
}
