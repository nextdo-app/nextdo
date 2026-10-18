# 桌面端 Reopen 事件平台编译错误

## Goal

Tauri RunEvent::Reopen 仅在 macOS 存在，Windows/Linux CI 编译 E0599 失败；用 cfg(target_os = "macos") 隔离，并重新发布 beta 包。

## Requirements

- 用 `#[cfg(target_os = "macos")]` 隔离 `RunEvent::Reopen` 分支，使 Windows / Linux 编译通过（保持 macOS 上 Dock 点击唤回窗口的行为不变）；
- 顺带消除非 macOS 平台 `event` 未使用的告警（参数改名为 `_event`）；
- 修复后重新发布 beta 包。

## Acceptance Criteria

- [ ] `cargo check` 在本机（macOS）通过；
- [ ] CI 中 Windows / Linux 的 `Build ... installer` 作业不再出现 `E0599: no variant named Reopen`；
- [ ] Release 工作流产出的新 beta 包可用。

## Root Cause

并发任务的桌面端改动在 `.run(...)` 回调里直接匹配 `tauri::RunEvent::Reopen`，该变体只在 macOS 的 Tauri 实现中存在。macOS 作业通过、Windows / Linux 作业在 `pnpm tauri build` 阶段编译失败，导致 `Create GitHub Release` 被跳过。

## Out of Scope

- 托盘 / 关闭最小化等其它桌面端行为（已在上一任务验证）。
