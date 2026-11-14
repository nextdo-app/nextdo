//! Native window and directed transport; the main webview alone owns focus data.
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, EventTarget, Manager, WebviewWindow};

pub const LABEL: &str = "focus-island";
const MAIN: &str = "main";
const COLLAPSED_WIDTH: f64 = 320.0;
const EXPANDED_WIDTH: f64 = 420.0;
/// Notched Macs get a wider capsule so the center gap can cover the cutout.
const NOTCHED_WIDTH: f64 = 480.0;
/// Logical notch width with slack for wider models (13" Air measures 179).
const NOTCH_RESERVE: f64 = 200.0;
/// Notched Macs raise the menu-bar band to cover the cutout (33pt vs 24pt).
const NOTCH_MIN_INSET: f64 = 30.0;
const MIN_HEIGHT: f64 = 34.0;
const MAX_HEIGHT: f64 = 900.0;
const TOP_GAP: f64 = if cfg!(target_os = "macos") { 0.0 } else { 8.0 };
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Default)]
pub struct FocusIslandState(Mutex<WindowState>);

struct WindowState {
    ready: bool,
    requested_visible: bool,
    creating: bool,
    expanded: bool,
    height: f64,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            ready: false,
            requested_visible: false,
            creating: false,
            expanded: false,
            height: MIN_HEIGHT,
        }
    }
}

impl FocusIslandState {
    fn lock(&self) -> Result<MutexGuard<'_, WindowState>, String> {
        self.0
            .lock()
            .map_err(|_| "focus-island.state-unavailable".into())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Idle,
    Running,
    Paused,
    TimeUp,
    Completed,
    Break,
    BreakComplete,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ActionKind {
    Next,
    Habit,
    Calendar,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    generation: String,
    revision: u64,
    session_id: Option<String>,
    action_id: Option<String>,
    action_kind: Option<ActionKind>,
    title: String,
    phase: Phase,
    started_at: Option<String>,
    ended_at: Option<String>,
    planned_minutes: Option<u16>,
    paused_sec: f64,
    pause_started_at: Option<f64>,
    break_ends_at: Option<f64>,
    break_minutes: Option<u8>,
    is_dark: bool,
    busy: bool,
    error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Command {
    Pause,
    Resume,
    Complete,
    Continue,
    #[serde(rename = "break-5")]
    Break5,
    #[serde(rename = "break-10")]
    Break10,
    EndBreak,
    FinishBreak,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    request_id: String,
    generation: String,
    revision: u64,
    session_id: String,
    command: Command,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandResult {
    request_id: String,
    generation: String,
    ok: bool,
    error: Option<String>,
}

fn valid_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256
}

fn validate_snapshot(snapshot: &Snapshot) -> Result<(), String> {
    // Only main publishes; ISO date interpretation stays in the shared TS decoder.
    let valid_time = |value: Option<f64>| {
        value.is_none_or(|instant| instant.is_finite() && instant.abs() <= 8.64e15)
    };
    let active_identity = snapshot.session_id.as_deref().is_some_and(valid_id)
        && snapshot.action_id.as_deref().is_some_and(valid_id)
        && snapshot.action_kind.is_some()
        && snapshot
            .started_at
            .as_deref()
            .is_some_and(|date| !date.is_empty() && date.len() <= 64);
    if !valid_id(&snapshot.generation)
        || snapshot.revision > MAX_SAFE_INTEGER
        || (snapshot.phase != Phase::Idle && !active_identity)
        || snapshot
            .planned_minutes
            .is_some_and(|minutes| !(1..=180).contains(&minutes))
        || !snapshot.paused_sec.is_finite()
        || snapshot.paused_sec < 0.0
        || snapshot.paused_sec > MAX_SAFE_INTEGER as f64
        || !valid_time(snapshot.pause_started_at)
        || !valid_time(snapshot.break_ends_at)
        || snapshot
            .break_minutes
            .is_some_and(|minutes| minutes != 5 && minutes != 10)
        || serde_json::to_vec(snapshot)
            .map_err(|error| error.to_string())?
            .len()
            > 65_536
    {
        return Err("focus-island.invalid-snapshot".into());
    }
    Ok(())
}

fn validate_request(request: &Request) -> Result<(), String> {
    if !valid_id(&request.request_id)
        || !valid_id(&request.generation)
        || !valid_id(&request.session_id)
        || request.revision > MAX_SAFE_INTEGER
    {
        return Err("focus-island.invalid-command".into());
    }
    Ok(())
}

/// Plugin capabilities do not restrict application commands by default.
pub fn permits_command(caller: &str, command: &str) -> bool {
    match command {
        "focus_island_show" | "focus_island_publish" | "focus_island_reply" => caller == MAIN,
        "focus_island_ready"
        | "focus_island_resize"
        | "focus_island_open_main"
        | "focus_island_command" => caller == LABEL,
        "focus_island_hide" => caller == MAIN || caller == LABEL,
        _ => caller == MAIN,
    }
}

fn notch_reserve(monitor: &tauri::Monitor) -> f64 {
    if !cfg!(target_os = "macos") {
        return 0.0;
    }
    // ponytail: menu-bar inset stands in for NSScreen.safeAreaInsets. It fails
    // when the menu bar is auto-hidden; read safeAreaInsets if that matters.
    let inset =
        f64::from(monitor.work_area().position.y - monitor.position().y) / monitor.scale_factor();
    if inset >= NOTCH_MIN_INSET {
        NOTCH_RESERVE
    } else {
        0.0
    }
}

fn island_width(expanded: bool, reserve: f64) -> f64 {
    if reserve > 0.0 {
        NOTCHED_WIDTH
    } else if expanded {
        EXPANDED_WIDTH
    } else {
        COLLAPSED_WIDTH
    }
}

fn bounds(
    work: &tauri::PhysicalRect<i32, u32>,
    center: &tauri::PhysicalRect<i32, u32>,
    anchor_top: i32,
    scale: f64,
    width: f64,
    height: f64,
) -> Result<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>), String> {
    if !scale.is_finite()
        || scale <= 0.0
        || work.size.width == 0
        || work.size.height == 0
        || center.size.width == 0
    {
        return Err("focus-island.invalid-monitor".into());
    }
    let width = (width * scale).round().min(f64::from(center.size.width)) as u32;
    let height = (height * scale).round().min(f64::from(work.size.height)) as u32;
    let x = f64::from(center.position.x) + f64::from(center.size.width - width) / 2.0;
    let y = (f64::from(anchor_top) + TOP_GAP * scale)
        .min(f64::from(work.position.y) + f64::from(work.size.height - height));
    Ok((
        tauri::PhysicalPosition::new(x.round() as i32, y.round() as i32),
        tauri::PhysicalSize::new(width, height),
    ))
}

/// Returns the notch reserve so the webview can lay out its center gap.
pub fn position_window(app: &AppHandle, prefer_main: bool) -> Result<f64, String> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(0.0);
    };
    let state = app.state::<FocusIslandState>();
    let (expanded, height) = {
        let state = state.lock()?;
        (state.expanded, state.height)
    };
    let reference = if prefer_main {
        app.get_webview_window(MAIN)
            .unwrap_or_else(|| window.clone())
    } else {
        window.clone()
    };
    let monitor = reference
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or(window
            .primary_monitor()
            .map_err(|error| error.to_string())?);
    if let Some(monitor) = monitor {
        let work = monitor.work_area();
        let screen = tauri::PhysicalRect {
            position: *monitor.position(),
            size: *monitor.size(),
        };
        let reserve = notch_reserve(&monitor);
        // The cutout is centered on the physical screen, so a side Dock must
        // not shift the notch gap. Other platforms keep the work-area center.
        let center = if cfg!(target_os = "macos") {
            &screen
        } else {
            &work
        };
        let anchor_top = if cfg!(target_os = "macos") {
            monitor.position().y
        } else {
            work.position.y
        };
        let (position, size) = bounds(
            &work,
            center,
            anchor_top,
            monitor.scale_factor(),
            island_width(expanded, reserve),
            height,
        )?;
        window.set_size(size).map_err(|error| error.to_string())?;
        window
            .set_position(position)
            .map_err(|error| error.to_string())?;
        Ok(reserve)
    } else {
        window
            .set_size(tauri::LogicalSize::new(island_width(expanded, 0.0), height))
            .map_err(|error| error.to_string())?;
        window.center().map_err(|error| error.to_string())?;
        Ok(0.0)
    }
}

fn show_without_focus(window: &WebviewWindow) -> Result<(), String> {
    // Tao's macOS show calls makeKeyAndOrderFront even after focused(false).
    window
        .set_focusable(false)
        .map_err(|error| error.to_string())?;
    let shown = window.show();
    let restored = window.set_focusable(true);
    shown.and(restored).map_err(|error| error.to_string())
}

pub fn hide(app: &AppHandle) -> Result<(), String> {
    app.state::<FocusIslandState>().lock()?.requested_visible = false;
    if let Some(window) = app.get_webview_window(LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn restore_main(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN)
        .ok_or("focus-island.main-unavailable")?;
    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn focus_island_show(app: AppHandle) -> Result<(), String> {
    let state = app.state::<FocusIslandState>();
    {
        let mut state = state.lock()?;
        state.requested_visible = true;
        if state.creating {
            return Ok(());
        }
        if app.get_webview_window(LABEL).is_none() {
            state.creating = true;
            state.ready = false;
        }
    }
    if app.get_webview_window(LABEL).is_none() {
        // Seed the webview's notch gap; ready/resize replies keep it current.
        let reserve = app
            .get_webview_window(MAIN)
            .and_then(|window| window.current_monitor().ok().flatten())
            .map(|monitor| notch_reserve(&monitor))
            .unwrap_or(0.0);
        // No parent: minimizing an owner would hide the capsule on Windows.
        let created = tauri::WebviewWindowBuilder::new(
            &app,
            LABEL,
            tauri::WebviewUrl::App("focus-island".into()),
        )
        .title("Nextdo 专注岛")
        .inner_size(island_width(false, reserve), MIN_HEIGHT)
        .decorations(false)
        .always_on_top(true)
        .transparent(true)
        .background_color(tauri::webview::Color(0, 0, 0, 0))
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .initialization_script(format!(
            "Object.defineProperty(window, '__NEXTDO_FOCUS_ISLAND__', {{ value: true }});\
             window.__NEXTDO_FOCUS_NOTCH_RESERVE__ = {reserve};"
        ))
        .on_page_load(|window, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                match window.state::<FocusIslandState>().lock() {
                    Ok(mut state) => state.ready = false,
                    Err(error) => eprintln!("focus island load: {error}"),
                }
                if let Err(error) = window.hide() {
                    eprintln!("focus island loading hide: {error}");
                }
            }
        })
        .build();
        state.lock()?.creating = false;
        let _window = created.map_err(|error| error.to_string())?;
        #[cfg(target_os = "macos")]
        _window
            .with_webview(|webview| unsafe {
                // NSStatusWindowLevel keeps the island above other floating windows.
                let native = &*webview.ns_window().cast::<objc2::runtime::AnyObject>();
                let _: () = objc2::msg_send![native, setLevel: 25_isize];
            })
            .map_err(|error| error.to_string())?;
    }
    position_window(&app, true)?;
    if state.lock()?.ready {
        app.emit_to(EventTarget::webview_window(MAIN), "focus-island:ready", ())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn focus_island_hide(app: AppHandle) -> Result<(), String> {
    hide(&app)
}

#[tauri::command]
pub fn focus_island_resize(app: AppHandle, expanded: bool, height: f64) -> Result<f64, String> {
    if !height.is_finite() || height <= 0.0 || height > MAX_HEIGHT {
        return Err("focus-island.invalid-size".into());
    }
    {
        let state = app.state::<FocusIslandState>();
        let mut state = state.lock()?;
        state.expanded = expanded;
        state.height = height.max(MIN_HEIGHT);
    }
    position_window(&app, false)
}

#[tauri::command]
pub fn focus_island_open_main(app: AppHandle) -> Result<(), String> {
    restore_main(&app)?;
    app.emit_to(
        EventTarget::webview_window(MAIN),
        "focus-island:open-main",
        (),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn focus_island_ready(app: AppHandle) -> Result<(), String> {
    app.state::<FocusIslandState>().lock()?.ready = true;
    app.emit_to(EventTarget::webview_window(MAIN), "focus-island:ready", ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn focus_island_publish(app: AppHandle, snapshot: Snapshot) -> Result<(), String> {
    validate_snapshot(&snapshot)?;
    let state = app.state::<FocusIslandState>();
    let (ready, requested_visible) = {
        let state = state.lock()?;
        (state.ready, state.requested_visible)
    };
    if !ready {
        return Ok(());
    }
    app.emit_to(
        EventTarget::webview_window(LABEL),
        "focus-island:snapshot",
        snapshot,
    )
    .map_err(|error| error.to_string())?;
    if requested_visible {
        if let Some(window) = app.get_webview_window(LABEL) {
            if !window.is_visible().map_err(|error| error.to_string())? {
                show_without_focus(&window)?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn focus_island_command(app: AppHandle, request: Request) -> Result<(), String> {
    validate_request(&request)?;
    app.emit_to(
        EventTarget::webview_window(MAIN),
        "focus-island:command",
        request,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn focus_island_reply(app: AppHandle, result: CommandResult) -> Result<(), String> {
    if !valid_id(&result.request_id)
        || !valid_id(&result.generation)
        || result
            .error
            .as_ref()
            .is_some_and(|error| error.len() > 8192)
    {
        return Err("focus-island.invalid-result".into());
    }
    app.emit_to(
        EventTarget::webview_window(LABEL),
        "focus-island:result",
        result,
    )
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capsule_cannot_invoke_privileged_or_main_owned_commands() {
        for command in [
            "load_owner_token",
            "download_update",
            "calendar_upsert_event",
            "open_url",
            "focus_island_publish",
            "focus_island_reply",
            "focus_island_show",
        ] {
            assert!(!permits_command(LABEL, command), "{command}");
            assert!(permits_command(MAIN, command), "{command}");
        }
        assert!(permits_command(LABEL, "focus_island_command"));
        assert!(!permits_command(MAIN, "focus_island_command"));
        assert!(!permits_command("other", "focus_island_hide"));
    }

    #[test]
    fn bounds_preserve_negative_monitor_coordinates_and_scale() {
        let work = tauri::PhysicalRect {
            position: tauri::PhysicalPosition::new(-2560, -1392),
            size: tauri::PhysicalSize::new(2560, 1392),
        };
        let screen = tauri::PhysicalRect {
            position: tauri::PhysicalPosition::new(-2560, -1440),
            size: tauri::PhysicalSize::new(2560, 1440),
        };
        let (position, size) = bounds(&work, &screen, -1440, 2.0, COLLAPSED_WIDTH, 34.0).unwrap();
        assert_eq!(size, tauri::PhysicalSize::new(640, 68));
        let expected_top = if cfg!(target_os = "macos") {
            -1440
        } else {
            -1424
        };
        assert_eq!(position, tauri::PhysicalPosition::new(-1600, expected_top));
        let (expanded, _) = bounds(&work, &screen, -1440, 2.0, EXPANDED_WIDTH, 400.0).unwrap();
        assert_eq!(expanded.x, -1700);
        assert_eq!(expanded.y, position.y);
        let (notched, _) = bounds(&work, &screen, -1440, 2.0, NOTCHED_WIDTH, 34.0).unwrap();
        assert_eq!(notched.x, -1760);
        assert_eq!(notched.y, position.y);
    }

    #[test]
    fn notched_displays_reserve_the_center_gap() {
        assert_eq!(island_width(false, 0.0), COLLAPSED_WIDTH);
        assert_eq!(island_width(true, 0.0), EXPANDED_WIDTH);
        assert_eq!(island_width(false, NOTCH_RESERVE), NOTCHED_WIDTH);
        assert_eq!(island_width(true, NOTCH_RESERVE), NOTCHED_WIDTH);
    }

    #[test]
    fn bounds_fit_small_work_areas() {
        let work = tauri::PhysicalRect {
            position: tauri::PhysicalPosition::new(20, 40),
            size: tauri::PhysicalSize::new(320, 480),
        };
        let (position, size) = bounds(&work, &work, 40, 1.0, NOTCHED_WIDTH, 900.0).unwrap();
        assert_eq!(size, work.size);
        assert_eq!(position, work.position);
        assert!(bounds(&work, &work, 40, f64::NAN, COLLAPSED_WIDTH, 80.0).is_err());
    }

    #[test]
    fn command_boundary_rejects_unknown_actions_and_unsafe_revisions() {
        let payload = serde_json::json!({"requestId":"request-1", "generation":"owner-1", "revision":1, "sessionId":"session-1", "command":"pause"});
        let request: Request = serde_json::from_value(payload.clone()).unwrap();
        assert!(validate_request(&request).is_ok());
        let mut invalid = payload.clone();
        invalid["command"] = "delete-action".into();
        assert!(serde_json::from_value::<Request>(invalid).is_err());
        let mut invalid = request;
        invalid.revision = MAX_SAFE_INTEGER + 1;
        assert!(validate_request(&invalid).is_err());
        invalid.revision = 1;
        invalid.session_id.clear();
        assert!(validate_request(&invalid).is_err());
    }

    #[test]
    fn snapshot_boundary_requires_a_live_identity_and_valid_timer_values() {
        let payload = serde_json::json!({
            "generation": "owner-1", "revision": 2, "sessionId": "session-1",
            "actionId": "action-1", "actionKind": "next", "title": "Focus",
            "phase": "paused", "startedAt": "2026-11-09T10:00:00.000Z",
            "endedAt": null, "plannedMinutes": 25, "pausedSec": 0,
            "pauseStartedAt": 1794218460000.0, "breakEndsAt": null,
            "breakMinutes": null, "isDark": false, "busy": false, "error": null
        });
        let mut snapshot: Snapshot = serde_json::from_value(payload).unwrap();
        assert!(validate_snapshot(&snapshot).is_ok());
        snapshot.paused_sec = -1.0;
        assert!(validate_snapshot(&snapshot).is_err());
        snapshot.paused_sec = 0.0;
        snapshot.planned_minutes = Some(181);
        assert!(validate_snapshot(&snapshot).is_err());
        snapshot.planned_minutes = Some(25);
        snapshot.session_id = None;
        assert!(validate_snapshot(&snapshot).is_err());
        snapshot.phase = Phase::Idle;
        assert!(validate_snapshot(&snapshot).is_ok());
    }
}
