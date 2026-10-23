//! Non-macOS stand-in for the EventKit bridge (task 10-23).
//!
//! Windows and Linux have no calendar API that a reminder can be written into,
//! so the calendar channel does not exist there. The JS bundle is identical on
//! every host, which means the shell must still ANSWER the probe instead of
//! leaving it to fail as "command not found": `calendar_supported` returns
//! false and the Settings row stays hidden, while the other commands reject so
//! a stray call fails loudly instead of silently doing nothing.
//!
//! `lib.rs` aliases this module to `calendar` on non-macOS targets, so
//! `generate_handler!` lists one set of paths for every platform.

const UNSUPPORTED: &str = "当前系统不支持日历通道";

#[tauri::command]
pub async fn calendar_supported() -> Result<bool, String> {
    Ok(false)
}

#[tauri::command]
pub async fn calendar_permission() -> Result<String, String> {
    Ok("denied".to_string())
}

#[tauri::command]
pub async fn calendar_request_permission() -> Result<String, String> {
    Ok("denied".to_string())
}

#[tauri::command]
pub async fn calendar_upsert_event() -> Result<(), String> {
    Err(UNSUPPORTED.to_string())
}

#[tauri::command]
pub async fn calendar_delete_event() -> Result<(), String> {
    Err(UNSUPPORTED.to_string())
}

#[tauri::command]
pub async fn calendar_open_settings() -> Result<(), String> {
    Err(UNSUPPORTED.to_string())
}
