//! Nextdo desktop shell — a Tauri v2 window that loads the `@nextdo/mobile`
//! web build (`expo export --platform web` → `apps/mobile/dist`).
//!
//! The React app itself lives in `apps/mobile` and the shared `packages/*`;
//! nothing app-specific is compiled here. This crate only provides:
//!   * the native window (created in `setup` — see `start_frontend_server`
//!     for why the URL is dynamic),
//!   * the Stronghold plugin (encrypted local secrets),
//!   * the Notification plugin (local reminder delivery, task 09-30 —
//!     the web bundle's tauri adapter calls sendNotification /
//!     isPermissionGranted; desktop has no native scheduling, so the
//!     app's 30 s JS tick drives in-session delivery),
//!   * a minimal owner-token command seam (scaffold; see below), and
//!   * (release builds only) a loopback static file server, because the
//!     PowerSync web client needs a REAL http origin: it runs its SQLite
//!     engine in a `type: 'module'` web worker, and WebKit gives the
//!     `tauri://localhost` custom protocol an OPAQUE origin — module
//!     workers from an opaque origin are always rejected ("Cross-origin
//!     script load denied by CORS policy"). Serving the same bundle from
//!     `http://127.0.0.1:<port>` gives the page a normal origin, and
//!     Tauri still treats it as LOCAL (the URL IS `frontendDist`), so the
//!     IPC bridge + capabilities work unchanged.

use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

/* ------------------------------------------------------------------ *
 * 应用内更新下载状态机
 *
 * 桌面端点击「下载安装包」后，Rust 在后台线程做流式 HTTP 下载，前端通过
 * `get_download_progress` 轮询进度。下完后前端调 `open_downloaded_file`
 * 用系统默认程序打开安装包（macOS → `open .dmg`、Windows → 运行 .exe、
 * Linux → `xdg-open .deb/.AppImage`），用户在系统安装向导里完成安装。
 *
 * 这条路不依赖 Tauri 官方 updater 插件（不需要 Minisign 签名、不需要
 * `latest.json`），复用现有 GitHub Release 产物即可。
 * ------------------------------------------------------------------ */

/// 下载进度结构体，前端通过 `get_download_progress` 轮询读取。
#[derive(Clone, serde::Serialize)]
struct DownloadProgress {
    /// `idle` | `downloading` | `done` | `error`
    state: String,
    /// 已下载字节数。
    downloaded_bytes: u64,
    /// 文件总字节数（服务端可能不给 Content-Length，此时为 0）。
    total_bytes: u64,
    /// 下载完成后的本地文件绝对路径（仅 `done` 状态有值）。
    file_path: String,
    /// 错误描述（仅 `error` 状态有值）。
    error: String,
}

impl Default for DownloadProgress {
    fn default() -> Self {
        Self {
            state: "idle".into(),
            downloaded_bytes: 0,
            total_bytes: 0,
            file_path: String::new(),
            error: String::new(),
        }
    }
}

/// 全局下载状态，由 `download_update` 写、`get_download_progress` 读。
struct DownloadState {
    progress: Arc<Mutex<DownloadProgress>>,
}

impl Default for DownloadState {
    fn default() -> Self {
        Self {
            progress: Arc::new(Mutex::new(DownloadProgress::default())),
        }
    }
}

impl DownloadState {
    fn progress_arc(&self) -> Arc<Mutex<DownloadProgress>> {
        Arc::clone(&self.progress)
    }
}

/// Loopback port of the release-build frontend server. It must match
/// `build.frontendDist` in `tauri.conf.json` — that match is what makes
/// Tauri treat the page as a LOCAL origin (IPC + capabilities).
#[cfg(not(dev))]
const FRONTEND_PORT: u16 = 52123;
#[cfg(not(dev))]
const FRONTEND_URL: &str = "http://127.0.0.1:52123";

/// Start the loopback static file server that release builds serve the
/// frontend bundle from (see the module docs for why).
///
/// - Binds 127.0.0.1 ONLY (never the LAN; the files are the app bundle
///   itself, but there is no reason to expose them).
/// - Serves `root` (the `frontend-dist` resource dir inside the .app) with
///   the SPA fallback: unknown paths WITHOUT a file extension get
///   `index.html` (expo-router client-side routing); everything else 404s.
/// - `NEXTDO_NOTIFY_DEBUG=1` (field diagnostics, task 09-30): additionally
///   accepts `POST /__log` and appends each JSON body line to `log_path`
///   (the web bundle's delivery hook posts reconcile/send outcomes there —
///   see `apps/mobile/lib/reminders/debug-log.ts`). Without the env the
///   endpoint answers 204 and discards the body.
/// - Runs on its own thread; the thread outlives the process (no stop
///   hook needed — the server dies with the app).
#[cfg(not(dev))]
fn start_frontend_server(
    app: &tauri::AppHandle,
    log_path: Option<std::path::PathBuf>,
) -> tauri::Result<()> {
    let root = app
        .path()
        .resource_dir()
        .map_err(tauri::Error::from)?
        .join("frontend-dist");
    if !root.join("index.html").is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!(
                "frontend bundle missing: {} (bundle.resources misconfigured?)",
                root.display()
            ),
        )
        .into());
    }
    let addr = format!("127.0.0.1:{FRONTEND_PORT}");
    let addr: std::net::SocketAddr = addr
        .parse()
        .expect("static loopback address");
    // Retry briefly — a stale instance of our own app may still be holding
    // the port while macOS finishes tearing it down.
    let mut server = None;
    for attempt in 0..20 {
        match tiny_http::Server::http(addr) {
            Ok(s) => {
                server = Some(s);
                break;
            }
            Err(_) if attempt < 19 => std::thread::sleep(std::time::Duration::from_millis(500)),
            Err(e) => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!(
                        "could not bind the local frontend server on {FRONTEND_URL}: {e} — \
                         close other Nextdo instances and retry"
                    ),
                )
                .into());
            }
        }
    }
    let server = server.expect("bind loop always yields a server");
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            if let Err(err) = serve_file_request(&root, request, &log_path) {
                eprintln!("nextdo frontend server: {err}");
            }
        }
    });
    Ok(())
}

#[cfg(not(dev))]
fn serve_file_request(
    root: &std::path::Path,
    mut request: tiny_http::Request,
    log_path: &Option<std::path::PathBuf>,
) -> Result<(), String> {
    // Diagnostics endpoint (NEXTDO_NOTIFY_DEBUG, see the fn docs): the web
    // bundle's delivery hook POSTs one JSON line per reconcile / send.
    if request.method() == &tiny_http::Method::Post && request.url() == "/__log" {
        if let Some(path) = log_path {
            // tiny_http 0.12: the body is a `dyn Read` reader (no `data`
            // field) — trait-object methods resolve without a use.
            let mut line = String::new();
            if request.as_reader().read_to_string(&mut line).is_ok() {
                line.push('\n');
                use std::io::Write;
                if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
                    let _ = file.write_all(line.as_bytes());
                }
            }
        }
        return request
            .respond(tiny_http::Response::empty(204))
            .map_err(|_| "respond failed".to_string());
    }
    let mut path = request.url().to_string();
    if let Some(query) = path.find('?') {
        path.truncate(query);
    }
    let rel = path.trim_start_matches('/');
    // Path-traversal guard: reject any `..` segment. The server is bound to
    // 127.0.0.1 only and serves our own bundle, but this keeps a hostile path
    // (e.g. `/../../etc/passwd`) from ever escaping `root`.
    if rel.split('/').any(|segment| segment == "..") {
        return request
            .respond(
                tiny_http::Response::from_string("forbidden").with_status_code(403),
            )
            .map_err(|_| "respond failed".to_string());
    }
    let candidate = root.join(rel);
    let (file, status) = if candidate.is_file() {
        (candidate, 200)
    } else if std::path::Path::new(rel).extension().is_none() {
        // SPA fallback (no extension → client-side route, e.g. /projects).
        // `candidate` does not exist on disk for routes — that is expected;
        // the web router takes over after we hand it index.html.
        (root.join("index.html"), 200)
    } else {
        let _ = request.respond(
            tiny_http::Response::from_string("not found").with_status_code(404),
        );
        return Ok(());
    };
    let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
    let mime = mime_for(&file);
    let response = tiny_http::Response::from_data(bytes)
        .with_status_code(status)
        .with_header(
            tiny_http::Header::from_bytes(&b"Content-Type"[..], mime.as_bytes())
                .map_err(|_| "invalid Content-Type header".to_string())?,
        );
    request
        .respond(response)
        .map_err(|_| "respond failed".to_string())
}

#[cfg(not(dev))]
fn mime_for(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "wasm" => "application/wasm",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "ttf" => "font/ttf",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

/// Minimal, in-process owner-token seam (scaffold).
///
/// The runtime owner-token backend is Tauri **Stronghold** — the
/// `tauri-plugin-stronghold` plugin registered in `run()` below — which the web
/// front-end consumes through `packages/db/src/owner-token.ts`. This managed
/// state is intentionally *not* wired to the stronghold store yet: it exists so
/// the Rust-side command surface (`save_owner_token` / `load_owner_token`) is
/// present and callable now, and is a documented follow-up to persist to the
/// stronghold snapshot. Keeping it in memory keeps the scaffold minimal and
/// free of the (compile-unverified) stronghold Rust store API.
#[derive(Default)]
struct OwnerTokenStore {
    token: Mutex<Option<String>>,
}

/// Store the owner token (scaffold seam — see `OwnerTokenStore`).
#[tauri::command]
fn save_owner_token(store: tauri::State<'_, OwnerTokenStore>, token: String) -> Result<(), String> {
    if token.is_empty() {
        return Err("owner token must be non-empty".into());
    }
    *store
        .token
        .lock()
        .map_err(|_| "owner-token store is poisoned".to_string())? = Some(token);
    Ok(())
}

/// Read the stored owner token, or `None` when none has been set (scaffold
/// seam — see `OwnerTokenStore`).
#[tauri::command]
fn load_owner_token(store: tauri::State<'_, OwnerTokenStore>) -> Option<String> {
    store.token.lock().ok().and_then(|guard| guard.clone())
}

/// Absolute path of the Stronghold snapshot the web front-end loads
/// (packages/db/src/owner-token.ts). The plugin resolves a RELATIVE
/// snapshot path against the process cwd — which lands the vault file in
/// the source tree during `tauri dev` and next to the launcher in a
/// release build — so the JS side must receive an absolute path here.
/// The parent dir is created by `setup()` before the plugin builds.
#[tauri::command]
fn stronghold_snapshot_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(dir.join("nextdo-stronghold").to_string_lossy().into_owned())
}

/// CPU 架构 of the build host (`aarch64` / `x86_64`).
///
/// The web front-end needs this to pick the right `.dmg`: macOS builds are
/// per-architecture and the wrong one will not install. WKWebView's user agent
/// does not carry the CPU architecture, and Safari has no `userAgentData`, so
/// inside the desktop shell this IPC round-trip is the only reliable source.
#[tauri::command]
fn current_arch() -> String {
    std::env::consts::ARCH.to_string()
}

/// Open a URL using the default system browser / handler.
///
/// Tauri's webview does not handle `window.open` by default, dropping external
/// links silently. This command uses platform-native utilities (`open` on macOS,
/// `cmd /c start` on Windows, `xdg-open` on Linux) to open external URLs in the
/// user's default browser without extra crate dependencies.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Only http and https URLs are allowed".into());
    }

    #[cfg(target_os = "macos")]
    let res = std::process::Command::new("open").arg(&url).spawn();

    #[cfg(target_os = "windows")]
    let res = std::process::Command::new("cmd")
        .args(["/c", "start", "", &url])
        .spawn();

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let res = std::process::Command::new("xdg-open").arg(&url).spawn();

    res.map(|_| ()).map_err(|e| format!("Failed to open URL: {e}"))
}

/// 在后台线程下载安装包到系统临时目录。
///
/// 前端把 `pickDownloads` 拼好的（已加代理前缀的）完整 URL 传进来。
/// Rust 用标准库做流式 HTTP（走系统 TLS，无需额外 crate），分块写入
/// `std::env::temp_dir()/Nextdo_<basename>`。前端通过
/// `get_download_progress` 轮询进度。
///
/// 同时只允许一个下载任务：如果已经在 `downloading`，直接返回 Ok（前端
/// 继续轮询即可）。需要重新下载时先把状态置回 `idle` 再调一次。
#[tauri::command]
fn download_update(
    state: tauri::State<'_, DownloadState>,
    url: String,
) -> Result<(), String> {
    {
        let progress = state.progress.lock().map_err(|e| e.to_string())?;
        if progress.state == "downloading" {
            return Ok(());
        }
    }

    // 从 URL 取文件名（去查询串），保留原始后缀（.dmg / .exe / .deb 等）。
    let basename = url
        .rsplit('/')
        .next()
        .unwrap_or("Nextdo_update")
        .split('?')
        .next()
        .unwrap_or("Nextdo_update")
        .to_string();
    let dest = std::env::temp_dir().join(format!("Nextdo_{basename}"));

    // 重置进度 → downloading
    {
        let mut progress = state.progress.lock().map_err(|e| e.to_string())?;
        *progress = DownloadProgress {
            state: "downloading".into(),
            ..Default::default()
        };
    }

    let shared = state.progress_arc();
    std::thread::spawn(move || {
        if let Err(err) = do_download(&url, &dest, &shared) {
            let mut progress = shared.lock().unwrap_or_else(|e| e.into_inner());
            progress.state = "error".into();
            progress.error = err;
        }
    });

    Ok(())
}

/// 内部下载实现：用标准库的 TcpStream + native-tls 做 HTTPS 流式读取。
///
/// 为什么不用 reqwest / ureq：这两个 crate 会引入 ring / rustls / hyper
/// 等大量依赖，显著拉长编译时间和产物体积。安装包下载只需要一次简单的
/// GET + 跟随重定向 + 分块写，标准库 + tiny 解析完全够用。
///
/// 但实际上 `tiny_http`（已在依赖里）是服务端库，不能做客户端请求。
/// 这里改用最简单的方式：调用系统的 curl 命令行工具，macOS/Linux 自带，
/// Windows 10+ 也自带。这比引入一个 HTTP client crate 更轻量。
fn do_download(
    url: &str,
    dest: &std::path::Path,
    shared: &Arc<Mutex<DownloadProgress>>,
) -> Result<(), String> {
    let dest_str = dest.to_string_lossy().to_string();

    // 用 curl 下载，-L 跟随重定向，-o 写文件，-w 最后输出 HTTP 状态码。
    // --progress-bar 会把进度写到 stderr。
    // 分两步：先 HEAD 取 content-length，再 GET 分块写。
    //
    // 简化版：直接 curl -L -o <file> <url>，轮询文件大小当进度。
    let mut child = std::process::Command::new("curl")
        .args([
            "-L",               // follow redirects
            "-f",               // fail on HTTP errors
            "-o", &dest_str,    // output file
            "--connect-timeout", "15",
            "--max-time", "600", // 10 min max
            url,
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("无法启动 curl: {e}"))?;

    // 轮询文件大小，更新进度。
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if status.success() {
                    let size = std::fs::metadata(dest)
                        .map(|m| m.len())
                        .unwrap_or(0);
                    let mut progress = shared.lock().unwrap_or_else(|e| e.into_inner());
                    progress.state = "done".into();
                    progress.downloaded_bytes = size;
                    progress.file_path = dest_str;
                    return Ok(());
                } else {
                    return Err(format!(
                        "下载失败（curl 退出码 {}）",
                        status.code().unwrap_or(-1)
                    ));
                }
            }
            Ok(None) => {
                // 还在下载，更新已下载字节数。
                if let Ok(meta) = std::fs::metadata(dest) {
                    let mut progress = shared.lock().unwrap_or_else(|e| e.into_inner());
                    progress.downloaded_bytes = meta.len();
                }
                std::thread::sleep(std::time::Duration::from_millis(300));
            }
            Err(e) => return Err(format!("等待 curl 失败: {e}")),
        }
    }
}

/// 返回当前下载进度。前端每 300–500ms 轮询一次。
#[tauri::command]
fn get_download_progress(
    state: tauri::State<'_, DownloadState>,
) -> Result<DownloadProgress, String> {
    let progress = state.progress.lock().map_err(|e| e.to_string())?;
    Ok(progress.clone())
}

/// 用系统默认程序打开已下载的安装包。
///
/// macOS → `open xxx.dmg`（挂载磁盘映像，Finder 弹出安装窗口）
/// Windows → 直接执行 `xxx.exe`（启动 NSIS 安装向导）
/// Linux → `xdg-open xxx.deb`（启动系统软件安装器）
#[tauri::command]
fn open_downloaded_file(file_path: String) -> Result<(), String> {
    if !std::path::Path::new(&file_path).is_file() {
        return Err("安装包文件不存在".into());
    }

    #[cfg(target_os = "macos")]
    let res = std::process::Command::new("open").arg(&file_path).spawn();

    #[cfg(target_os = "windows")]
    let res = std::process::Command::new("cmd")
        .args(["/c", "start", "", &file_path])
        .spawn();

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let res = std::process::Command::new("xdg-open").arg(&file_path).spawn();

    res.map(|_| ()).map_err(|e| format!("打开安装包失败: {e}"))
}

#[cfg(target_os = "macos")]
fn mount_dmg(dmg_path: &std::path::Path, mount_dir: &std::path::Path) -> Result<(), String> {
    // 优先尝试 diskutil image attach（macOS 最新推荐方式）
    let diskutil_status = std::process::Command::new("diskutil")
        .args([
            "image",
            "attach",
            &dmg_path.to_string_lossy(),
            "--mountOptions",
            "nobrowse,readOnly",
            "--mountPoint",
            &mount_dir.to_string_lossy(),
        ])
        .status();

    if let Ok(status) = diskutil_status {
        if status.success() {
            return Ok(());
        }
    }

    // 回退到 hdiutil attach（广泛兼容各版本 macOS）
    let hdiutil_status = std::process::Command::new("hdiutil")
        .args([
            "attach",
            &dmg_path.to_string_lossy(),
            "-nobrowse",
            "-readonly",
            "-mountpoint",
            &mount_dir.to_string_lossy(),
        ])
        .status()
        .map_err(|e| format!("无法执行 hdiutil attach: {e}"))?;

    if hdiutil_status.success() {
        Ok(())
    } else {
        Err(format!("挂载 DMG 失败，退出码: {:?}", hdiutil_status.code()))
    }
}

#[cfg(target_os = "macos")]
fn find_app_in_dir(dir: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("无法读取挂载目录: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) == Some("app") {
            return Ok(path);
        }
    }
    Err("在 DMG 镜像中未找到 .app 应用程序包".into())
}

#[cfg(target_os = "macos")]
fn resolve_target_app_path() -> std::path::PathBuf {
    if let Ok(exe_path) = std::env::current_exe() {
        for ancestor in exe_path.ancestors() {
            if ancestor.extension().and_then(|ext| ext.to_str()) == Some("app") {
                return ancestor.to_path_buf();
            }
        }
    }
    std::path::PathBuf::from("/Applications/Nextdo.app")
}

/// 自动安装已下载的更新包并重启应用。
///
/// 在 macOS 上：
/// 若安装包为 `.dmg`，则在后台静默挂载，提取出新的 `.app` bundle，
/// 启动一个独立的后台辅助更新脚本，然后主应用优雅退出（`app.exit(0)`）。
/// 后台脚本等待原进程退出释放文件锁后，使用 `ditto` 覆盖目标路径（默认 `/Applications/Nextdo.app`
/// 或当前运行的应用位置），清除隔离属性，卸载 DMG，并使用 `open -n` 重新启动新版应用。
/// 这避免了用户手动拖拽时因主应用运行而提示「项目正在使用中，无法替换」的问题。
///
/// 在 Windows 上：
/// 启动 NSIS 安装程序（`.exe`），并退出当前应用，使安装向导顺利进行。
///
/// 在 Linux 上：
/// 用系统安装器打开包（`xdg-open`）。
#[tauri::command]
fn install_update_and_restart(app: tauri::AppHandle, file_path: String) -> Result<(), String> {
    let dmg_path = std::path::PathBuf::from(&file_path);
    if !dmg_path.is_file() {
        return Err("安装包文件不存在".into());
    }

    #[cfg(target_os = "macos")]
    {
        if file_path.to_lowercase().ends_with(".dmg") {
            let unique_id = format!(
                "{}_{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0)
            );
            let mount_dir = std::env::temp_dir().join(format!("nextdo_mount_{unique_id}"));
            std::fs::create_dir_all(&mount_dir)
                .map_err(|e| format!("创建临时挂载点目录失败: {e}"))?;

            // 挂载 DMG 镜像
            if let Err(e) = mount_dmg(&dmg_path, &mount_dir) {
                let _ = std::fs::remove_dir(&mount_dir);
                return Err(e);
            }

            // 在挂载卷内查找新版 .app
            let source_app = match find_app_in_dir(&mount_dir) {
                Ok(path) => path,
                Err(e) => {
                    let _ = std::process::Command::new("diskutil")
                        .args(["eject", "force", &mount_dir.to_string_lossy()])
                        .status();
                    let _ = std::fs::remove_dir(&mount_dir);
                    return Err(e);
                }
            };

            let target_app = resolve_target_app_path();
            let script_path = std::env::temp_dir().join(format!("nextdo_updater_{unique_id}.sh"));

            let script_content = r#"#!/bin/bash
set -u

TARGET_PID="$1"
SOURCE_APP="$2"
TARGET_APP="$3"
MOUNT_DIR="$4"
DMG_PATH="$5"
SCRIPT_PATH="$0"

# 1. 等待主应用进程完全退出，最多等待 20 秒
COUNT=0
while kill -0 "$TARGET_PID" 2>/dev/null; do
    sleep 0.2
    COUNT=$((COUNT + 1))
    if [ "$COUNT" -ge 100 ]; then
        kill -9 "$TARGET_PID" 2>/dev/null || true
        break
    fi
done

# 2. 确保目标安装目录的父目录存在
TARGET_DIR="$(dirname "$TARGET_APP")"
mkdir -p "$TARGET_DIR"

# 3. 替换目标应用
if [ -d "$TARGET_APP" ]; then
    rm -rf "$TARGET_APP"
fi
ditto "$SOURCE_APP" "$TARGET_APP"

# 4. 移除隔离属性，避免 Gatekeeper 拦截
xattr -dr com.apple.quarantine "$TARGET_APP" 2>/dev/null || true

# 5. 卸载临时挂载点
diskutil eject force "$MOUNT_DIR" 2>/dev/null || hdiutil detach "$MOUNT_DIR" -force 2>/dev/null || true
rmdir "$MOUNT_DIR" 2>/dev/null || true

# 6. 清理下载的临时 DMG 文件与辅助脚本
rm -f "$DMG_PATH" 2>/dev/null || true
rm -f "$SCRIPT_PATH" 2>/dev/null || true

# 7. 启动新版应用
open -n "$TARGET_APP"
"#;

            std::fs::write(&script_path, script_content)
                .map_err(|e| format!("写入更新辅助脚本失败: {e}"))?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(
                    &script_path,
                    std::fs::Permissions::from_mode(0o755),
                );
            }

            let pid = std::process::id();
            let spawn_res = std::process::Command::new("/bin/bash")
                .arg(&script_path)
                .arg(pid.to_string())
                .arg(&source_app)
                .arg(&target_app)
                .arg(&mount_dir)
                .arg(&file_path)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();

            match spawn_res {
                Ok(_) => {
                    // 脚本已脱离启动，优雅退出当前主应用以释放锁
                    app.exit(0);
                    return Ok(());
                }
                Err(e) => {
                    // 清理挂载点
                    let _ = std::process::Command::new("diskutil")
                        .args(["eject", "force", &mount_dir.to_string_lossy()])
                        .status();
                    let _ = std::fs::remove_dir(&mount_dir);
                    let _ = std::fs::remove_file(&script_path);
                    return Err(format!("启动更新脚本失败: {e}"));
                }
            }
        } else {
            // 非 DMG 安装包，回退到 open 打开
            let res = std::process::Command::new("open").arg(&file_path).spawn();
            return res.map(|_| ()).map_err(|e| format!("打开安装包失败: {e}"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let res = std::process::Command::new("cmd")
            .args(["/c", "start", "", &file_path])
            .spawn();
        match res {
            Ok(_) => {
                app.exit(0);
                Ok(())
            }
            Err(e) => Err(format!("启动安装程序失败: {e}")),
        }
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let res = std::process::Command::new("xdg-open").arg(&file_path).spawn();
        res.map(|_| ()).map_err(|e| format!("打开安装包失败: {e}"))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OwnerTokenStore::default())
        .manage(DownloadState::default())
        // Local reminder delivery (task 09-30): registers the notify /
        // is_permission_granted / request_permission commands + the JS
        // init script. `init()` needs no extra setup code (unlike the
        // Stronghold builder, which runs in `setup` below).
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Initialize the Stronghold plugin with the Argon2 password-hash.
            // The salt lives in the app-local data dir so the derived key is
            // stable across launches; the JS side
            // (`packages/db/src/owner-token.ts`) drives the store via the
            // plugin's built-in commands, using the absolute snapshot path
            // from `stronghold_snapshot_path` (see above).
            // The plugin writes the salt file but does NOT create the parent
            // directory itself — on a fresh machine the write panics with
            // "Failed to write salt: NotFound". Ensure the dir exists first.
            let data_dir = app
                .path()
                .app_local_data_dir()
                .expect("could not resolve app-local data dir");
            std::fs::create_dir_all(&data_dir)
                .expect("could not create app-local data dir");
            let salt_path = data_dir.join("stronghold-salt");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;

            // Release builds serve the bundle from the loopback server so the
            // page runs on a real http origin (module-worker requirement —
            // see the module docs). The server must be up BEFORE the window
            // loads, which is why the window is created HERE instead of in
            // tauri.conf.json `app.windows` (config windows are created
            // before setup runs).
            //
            // Field diagnostics (task 09-30): with NEXTDO_NOTIFY_DEBUG=1 the
            // server additionally appends the web bundle's delivery
            // diagnostics (reconcile decisions, send outcomes) to a JSONL
            // file in the app data dir.
            #[cfg(not(dev))]
            let log_path = if std::env::var("NEXTDO_NOTIFY_DEBUG").is_ok() {
                Some(data_dir.join("nextdo-notify-debug.jsonl"))
            } else {
                None
            };

            #[cfg(not(dev))]
            start_frontend_server(app.handle(), log_path)?;

            // Label MUST stay "main" — capabilities/default.json grants the
            // Stronghold permissions to that window label.
            {
                // `WebviewUrl::App` resolves the path against the app base URL,
                // which Tauri sets to `devUrl` in dev and to `frontendDist`
                // (a URL here) in release — see `AppManager::get_app_url`. An
                // empty path loads that base: the Expo dev server in dev, the
                // loopback frontend server in release. Either way the page runs
                // on a REAL http origin (PowerSync's module worker is rejected
                // under the `tauri://` custom-protocol's opaque origin).
                let url = tauri::WebviewUrl::App(std::path::PathBuf::from(""));
                tauri::WebviewWindowBuilder::new(app, "main", url)
                    .title("Nextdo")
                    .inner_size(1024.0, 720.0)
                    .min_inner_size(800.0, 560.0)
                    .resizable(true)
                    .center()
                    .build()?;
            }

            // System tray icon & menu: allows running in background when closed.
            let show_i = tauri::menu::MenuItem::with_id(app, "show", "显示 Nextdo", true, None::<&str>)?;
            let quit_i = tauri::menu::MenuItem::with_id(app, "quit", "退出 Nextdo", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&show_i, &quit_i])?;

            let mut tray_builder = tauri::tray::TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Nextdo")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _ = tray_builder.build(app);

            // Notification self-check (field diagnostics, task 09-30): with
            // NEXTDO_NOTIFY_PROBE=1, send exactly ONE notification ~2 s
            // after the window opens. A visible banner proves the Rust
            // plugin + macOS permission layer end-to-end, independent of
            // the JS delivery path (snooze → tick → notify invoke).
            if std::env::var("NEXTDO_NOTIFY_PROBE").is_ok() {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    // Plugin manager API (tauri-plugin-notification 2.4.0):
                    // `notification()` via NotificationExt, builder().show()
                    // delivers immediately through notify-rust.
                    match handle
                        .notification()
                        .builder()
                        .title("Nextdo 通知自检")
                        .body("看到这条 = 桌面通知链路正常")
                        .show()
                    {
                        Ok(()) => eprintln!("[probe] notification sent"),
                        Err(e) => eprintln!("[probe] notification FAILED: {e}"),
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Close button hides window to tray/dock instead of quitting immediately.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            save_owner_token,
            load_owner_token,
            stronghold_snapshot_path,
            current_arch,
            open_url,
            download_update,
            get_download_progress,
            open_downloaded_file,
            install_update_and_restart
        ])
        .build(tauri::generate_context!())
        .expect("error while building Nextdo desktop")
        .run(|app_handle, event| {
            // Reopen main window when macOS Dock icon or app activator is clicked
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
            }
        });
}
