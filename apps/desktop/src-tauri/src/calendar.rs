//! macOS EventKit bridge (task 10-23) — the desktop counterpart of
//! `apps/mobile/lib/calendar-sync/device.ts`.
//!
//! EventKit is an Objective-C framework with no first-class Rust binding, so
//! the commands below are the entire surface the JS side sees. They mirror the
//! mobile adapter's lifecycle: one event per calendar action, looked up by the
//! event id the client persists, so "create" and "update" share one idempotent
//! upsert path.
//!
//! Access level: FULL (`requestFullAccessToEventsWithCompletion:`). Write-only
//! access (macOS 14+) can neither read back nor delete the events it created,
//! which would make reminder cancellation and edits impossible — the same
//! reason the mobile adapter asks for full access.
//!
//! EventKit objects are not `Send` and the framework expects to be driven from
//! the main run loop, so every command hops there via `run_on_main_thread` and
//! returns its result through a channel. The store is created per call: it is
//! a thin handle onto the calendar database, and a cached one would go stale
//! after the user edits permissions.

#![cfg(target_os = "macos")]

use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2_event_kit::{
    EKAlarm, EKAuthorizationStatus, EKCalendar, EKCalendarItem, EKEntityType, EKEvent,
    EKEventStore, EKSpan,
};
use objc2_foundation::{NSArray, NSDate, NSError, NSString};
use tauri::AppHandle;

/// The calendar we create and own — same title as the mobile adapter's
/// `CALENDAR_TITLE`, so a user running both builds sees one Nextdo calendar.
const CALENDAR_TITLE: &str = "Nextdo";

/// Note written into an event whose action carries none of its own.
const EVENT_NOTE: &str = "由 Nextdo 自动同步";

/// Bound on how long a command waits for the main thread. A calendar write is
/// local I/O; hitting this means the main run loop is blocked, and the caller
/// retries on its next reconcile pass.
const MAIN_THREAD_TIMEOUT: Duration = Duration::from_secs(15);

/// Permission state as a stable wire string.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Access {
    NotDetermined,
    Restricted,
    Denied,
    Authorized,
}

impl Access {
    fn from_status(status: EKAuthorizationStatus) -> Self {
        // `WriteOnly` can neither read back nor delete what it wrote, so it is
        // useless for this feature. Reporting it as denied keeps the JS side on
        // the notification channel instead of silently losing reminders.
        if status == EKAuthorizationStatus::FullAccess {
            Self::Authorized
        } else if status == EKAuthorizationStatus::NotDetermined {
            Self::NotDetermined
        } else if status == EKAuthorizationStatus::Restricted {
            Self::Restricted
        } else {
            Self::Denied
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::NotDetermined => "notDetermined",
            Self::Restricted => "restricted",
            Self::Denied => "denied",
            Self::Authorized => "authorized",
        }
    }
}

fn current_status() -> Access {
    // `authorizationStatusForEntityType:` is a class method and thread-safe.
    Access::from_status(unsafe {
        EKEventStore::authorizationStatusForEntityType(EKEntityType::Event)
    })
}

/// Run `work` on the main thread and block for its result.
///
/// The command itself runs on a Tauri worker thread, so this is the only
/// correct handoff. A panicking `work` drops the sender, which surfaces here as
/// a closed channel.
fn on_main_thread<F, T>(app: &AppHandle, work: F) -> Result<T, String>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(work());
    })
    .map_err(|_| "无法调度到主线程".to_string())?;
    rx.recv_timeout(MAIN_THREAD_TIMEOUT)
        .map_err(|_| "日历操作超时".to_string())
}

/// Read the current authorization without prompting.
#[tauri::command]
pub async fn calendar_permission() -> Result<String, String> {
    Ok(current_status().as_str().to_string())
}

/// Whether this build can offer the calendar channel at all.
///
/// The JS side calls it once at startup to decide whether the Settings row
/// exists, so it must never prompt. Only macOS registers these commands, so a
/// successful call already means "supported".
#[tauri::command]
pub async fn calendar_supported() -> Result<bool, String> {
    Ok(true)
}

/// Ask for FULL access and report the resulting state.
///
/// A user who dismisses the dialog leaves the status at `notDetermined`; the
/// block's `granted` flag is not trusted as the answer, because the store's
/// status also distinguishes restricted from denied.
#[tauri::command]
pub async fn calendar_request_permission(app: AppHandle) -> Result<String, String> {
    let (tx, rx) = mpsc::channel::<()>();

    // Only the REQUEST is dispatched to the main thread. The wait happens on
    // this command's own thread: EventKit delivers the completion handler on
    // the main queue, so blocking there would deadlock the app.
    app.run_on_main_thread(move || {
        let store = unsafe { EKEventStore::new() };
        // Pinning the store inside the block keeps the request alive while the
        // permission dialog is up; releasing it early can drop the callback.
        let pinned = store.clone();
        let handler = RcBlock::new(move |_granted: Bool, _error: *mut NSError| {
            let _store = &pinned;
            let _ = tx.send(());
        });

        unsafe {
            store.requestFullAccessToEventsWithCompletion(RcBlock::as_ptr(&handler));
        }
    })
    .map_err(|_| "无法调度到主线程".to_string())?;

    // A timeout is not fatal: the status read below reports whatever the user
    // has settled on, and the caller re-checks on its next reconcile pass.
    let _ = rx.recv_timeout(MAIN_THREAD_TIMEOUT);
    Ok(current_status().as_str().to_string())
}

/// One event to create or update, as sent by the sync engine.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertEventArgs {
    /// Existing OS event id — absent means "create a new event".
    pub event_id: Option<String>,
    pub title: String,
    pub notes: Option<String>,
    /// Absolute start instant, epoch MILLISECONDS (UTC) — the JS side already
    /// holds ISO strings, but milliseconds avoid any date-format guessing on
    /// this side of the boundary.
    pub starts_at: f64,
    pub duration_minutes: f64,
    /// Minutes BEFORE the start to fire the alarm; absent/0 = at the start.
    pub alarm_offset_minutes: Option<f64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertEventResult {
    pub event_id: String,
}

fn ns_string(value: &str) -> Retained<NSString> {
    NSString::from_str(value)
}

fn ns_date_from_epoch_ms(ms: f64) -> Retained<NSDate> {
    // `dateWithTimeIntervalSince1970:` takes SECONDS.
    NSDate::dateWithTimeIntervalSince1970(epoch_ms_to_seconds(ms))
}

/// Epoch milliseconds → the seconds `NSDate` wants.
fn epoch_ms_to_seconds(ms: f64) -> f64 {
    ms / 1000.0
}

/// The alarm offset EventKit wants: SECONDS relative to the start, negative
/// meaning "before". A 0-minute offset fires at the start, which is the
/// reminder moment itself.
fn alarm_offset_seconds(minutes: f64) -> f64 {
    -(minutes * 60.0)
}

/// The calendar we write into: the Nextdo one when it exists, else a newly
/// created one, else the user's default calendar for new events.
///
/// Creating a calendar is the only way to guarantee we can find our own events
/// again. The fallback matters because an account configured read-only (a
/// shared or subscribed calendar) refuses third-party calendars, and a reminder
/// on the default calendar still beats no reminder at all.
fn resolve_calendar(store: &EKEventStore) -> Result<Retained<EKCalendar>, String> {
    let calendars = unsafe { store.calendarsForEntityType(EKEntityType::Event) };

    for index in 0..calendars.count() {
        let calendar = calendars.objectAtIndex(index);
        if unsafe { calendar.title() }.to_string() == CALENDAR_TITLE {
            return Ok(calendar);
        }
    }

    let default_calendar = unsafe { store.defaultCalendarForNewEvents() };
    let created =
        unsafe { EKCalendar::calendarForEntityType_eventStore(EKEntityType::Event, store) };
    unsafe { created.setTitle(&ns_string(CALENDAR_TITLE)) };

    // A calendar without a source cannot be saved. Prefer the source behind the
    // user's default calendar (the account they actually use), else the first
    // source the store reports.
    let source = default_calendar
        .as_ref()
        .and_then(|calendar| unsafe { calendar.source() })
        .or_else(|| unsafe { store.sources() }.firstObject());

    let Some(source) = source else {
        return default_calendar.ok_or_else(|| "没有可写入的日历".to_string());
    };
    unsafe { created.setSource(Some(&source)) };

    match unsafe { store.saveCalendar_commit_error(&created, true) } {
        Ok(()) => Ok(created),
        // Creating a calendar failed — fall back to the default calendar so the
        // reminder still lands somewhere the user will see it.
        Err(_) => default_calendar.ok_or_else(|| "没有可写入的日历".to_string()),
    }
}

/// Create or update one event, returning its OS identifier.
///
/// Idempotent by `eventId`: an update that finds no matching event creates a
/// fresh one, so a stale mapping self-heals instead of failing every pass.
#[tauri::command]
pub async fn calendar_upsert_event(
    app: AppHandle,
    args: UpsertEventArgs,
) -> Result<UpsertEventResult, String> {
    on_main_thread(&app, move || {
        if current_status() != Access::Authorized {
            return Err("没有日历权限".to_string());
        }

        let store = unsafe { EKEventStore::new() };

        let event: Retained<EKEvent> = args
            .event_id
            .as_deref()
            .filter(|id| !id.is_empty())
            .and_then(|id| unsafe { store.eventWithIdentifier(&ns_string(id)) })
            // An event the user deleted in the Calendar app falls through to a
            // fresh one rather than failing the whole pass.
            .unwrap_or_else(|| unsafe { EKEvent::eventWithEventStore(&store) });

        let calendar = resolve_calendar(&store)?;

        let start = ns_date_from_epoch_ms(args.starts_at);
        let end = ns_date_from_epoch_ms(args.starts_at + args.duration_minutes * 60_000.0);
        let alarm_offset = args.alarm_offset_minutes.unwrap_or(0.0);

        unsafe {
            let item: &EKCalendarItem = &event;
            item.setTitle(Some(&ns_string(&args.title)));
            item.setNotes(Some(&ns_string(args.notes.as_deref().unwrap_or(EVENT_NOTE))));
            item.setCalendar(Some(&calendar));
            // Alarms accumulate across updates, so clear before re-adding.
            item.setAlarms(Some(&NSArray::from_retained_slice(&[])));
            event.setStartDate(Some(&start));
            event.setEndDate(Some(&end));

            // A relative offset is measured from the start; negative fires
            // before it, which is what "remind me N minutes early" means.
            let alarm = EKAlarm::alarmWithRelativeOffset(alarm_offset_seconds(alarm_offset));
            item.addAlarm(&alarm);
        }

        if let Err(error) = unsafe { store.saveEvent_span_error(&event, EKSpan::ThisEvent) } {
            return Err(save_error_message(&error));
        }

        let event_id = unsafe { event.eventIdentifier() }
            .map(|id| id.to_string())
            .ok_or_else(|| "事件已保存但未返回标识".to_string())?;

        Ok(UpsertEventResult { event_id })
    })
    .and_then(|result| result)
}

/// Delete one event.
///
/// An event the user already removed is not an error: the caller's mapping is
/// simply stale and gets dropped.
#[tauri::command]
pub async fn calendar_delete_event(app: AppHandle, event_id: String) -> Result<(), String> {
    on_main_thread(&app, move || {
        if current_status() != Access::Authorized {
            return Err("没有日历权限".to_string());
        }

        let store = unsafe { EKEventStore::new() };
        let Some(event) = (unsafe { store.eventWithIdentifier(&ns_string(&event_id)) }) else {
            return Ok(());
        };

        // `removeEvent:` reports "never saved" as a nil error, which is a
        // success for our purposes.
        match unsafe { store.removeEvent_span_error(&event, EKSpan::ThisEvent) } {
            Ok(()) => Ok(()),
            Err(error) => Err(save_error_message(&error)),
        }
    })
    .and_then(|result| result)
}

/// Open the Calendar privacy pane in System Settings.
///
/// `Linking.openSettings()` on the JS side is a no-op in a desktop webview, and
/// the pane is reachable only by URL scheme — so the shell runs `open` rather
/// than pulling in a URL-opening plugin for this one link. The permission state
/// is unchanged by this call, so failures are reported but never fatal.
#[tauri::command]
pub async fn calendar_open_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars")
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开系统设置：{error}"))
}

/// Describe a failed save without leaking event contents.
///
/// The OS's localized description names the category (no permission, read-only
/// calendar, …) and carries no user data, so it is safe to forward.
fn save_error_message(error: &NSError) -> String {
    format!("日历写入失败：{}", error.localizedDescription())
}

#[cfg(test)]
mod tests {
    use super::{alarm_offset_seconds, epoch_ms_to_seconds};

    // The boundary arithmetic is the only part of this module that can be
    // tested without a signed, TCC-approved app: everything else calls
    // EventKit. Both conversions are easy to get wrong in a way that is
    // invisible until an event lands at the wrong hour.

    #[test]
    fn epoch_milliseconds_become_nsdate_seconds() {
        // 2026-10-23T09:00:00Z
        assert_eq!(epoch_ms_to_seconds(1_793_082_000_000.0), 1_793_082_000.0);
    }

    #[test]
    fn a_zero_offset_fires_at_the_start() {
        assert_eq!(alarm_offset_seconds(0.0), 0.0);
    }

    #[test]
    fn a_positive_offset_fires_before_the_start() {
        // "remind 15 minutes early" → 900 s BEFORE the start.
        assert_eq!(alarm_offset_seconds(15.0), -900.0);
    }
}
