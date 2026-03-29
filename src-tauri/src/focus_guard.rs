//! Focus Guard — prevents windows spawned by Claude Code job runs from stealing focus.
//!
//! Registers an NSWorkspace notification observer that fires whenever a new application
//! activates on macOS. If the activating app is a descendant (in the process tree) of
//! any currently running Claude Code process, it is immediately hidden.
//!
//! Architecture:
//! - `init()` — called once at app startup on the main thread
//! - `add_pid(pid)` / `remove_pid(pid)` — called by the agent sidecar stdout handler
//!   when a Claude Code job starts/ends
//! - `set_enabled(bool)` — toggled by user preference

#![cfg(target_os = "macos")]

use core::ptr::NonNull;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

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

    let guarded = match guarded_pids().lock() {
        Ok(g) => g.clone(),
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

    // Never hide browser apps — they are intentionally user-interactable
    // (e.g. spawned by the browser MCP for CAPTCHAs, logins, etc.).
    // The macOS background-launch path (`open -g`) handles the initial
    // "don't steal focus" requirement; the focus guard only needs to
    // suppress non-browser windows spawned by Claude Code.
    if let Some(bundle_id) = app.bundleIdentifier() {
        let id = bundle_id.to_string();
        if is_browser_bundle(&id) {
            return;
        }
    }

    let pid = app.processIdentifier();

    for &guarded_pid in &guarded {
        if is_descendant_of(pid, guarded_pid) {
            app.hide();
            break;
        }
    }
}

/// Known browser bundle identifiers that should never be hidden by the focus guard.
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
pub fn remove_pid(pid: i32) {
    if let Ok(mut pids) = guarded_pids().lock() {
        pids.remove(&pid);
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
