# Agent Note: 手动「检查更新」与后台提醒共用同一个更新弹窗

Status: implemented

## Problem

设置页的「检查更新」和根布局里的后台更新提醒原本是两套界面：后台提醒弹出 `AutoUpdateDialog`（版本、渠道切换、ChangeLog、下载进度、安装按钮）；手动检查却把结果渲染成设置卡片里的一张内联区域，并且由 `useAppUpdate` 维护第二套下载 / 安装状态机。两套界面的文案、按钮和下载行为会逐渐漂移，用户从两个入口看到的是两种产品。反馈很直接：手动点「检查更新」时，要和自动更新弹出同一个弹窗。

## Decision

- `apps/mobile/components/auto-update-dialog.tsx` 新增 `UpdatePromptProvider` 与 `useUpdatePrompt()`。Provider 挂在 `apps/mobile/app/_layout.tsx` 的根布局里、包住整个 `<Stack>`，因此设置页可以读到同一个检查入口。
- 一个状态机同时服务两个入口：
  - **手动检查**：`checkForUpdates()` 立即把弹窗切到「正在检查更新…」并打开；请求结束后落到 `发现新版本` / `已是最新版本` / `检查失败` 三种结果。失败态提供「重试」，检查中可「取消」（取消会作废这次请求的结果）。
  - **后台检查**：启动 1.5 秒后检查一次、之后每 6 小时一次；只在「确实有更新版本」且该版本没有被「稍后再说 / 跳过此版本」静默时打开弹窗。弹窗已打开时后台检查不打扰。
  - 手动检查是用户的明确动作，**不**受「稍后再说 / 跳过此版本」影响：用户主动问了，就必须看到结果。后台提醒仍遵守静默记录。
- `AutoUpdateDialog` 继续作为「发现新版本」的卡片（渠道切换、ChangeLog、自动下载、应用内安装）。新增 `UpdateStatusDialog` 承载检查中 / 已是最新 / 检查失败，外壳与 `AutoUpdateDialog` 使用同一套卡片尺寸和样式；「已是最新」的结论使用**当前安装版本**，feed 里的版本只列在下方的渠道信息中（代理 feed 可能落后于本机）。两个状态各自由 `visible` 控制，下载状态在切换状态时仍保留在 `AutoUpdateDialog` 实例里。
- 原生桌面下载是**全局单任务**（`download_update` 在 downloading 时直接返回 Ok，`get_download_progress` 读同一个槽），因此下载 / 安装期间锁定发起任务的 release：手动入口重新打开的是这个任务，不显示新选中的渠道，也不允许发起第二个下载。任务期间读到的渠道偏好变化先记下，任务结束后才应用；**任务完成本身不重置**用户在弹窗里主动选择的渠道（默认 stable、用户选 beta 下载完成时仍显示并安装 beta）。目标 release 变化会停止旧轮询、清空下载状态，旧任务的进度 / 完成回调因 tag 不匹配被丢弃。「立即安装并重启」只使用当前任务的完成态，旧渠道安装包不得用于新渠道版本。
- `apps/mobile/hooks/use-app-update.ts` 收窄为设置卡片的偏好状态：当前版本、渠道、渠道偏好、自动检查、自动下载。下载、安装、版本选择、结果文案全部只存在于更新弹窗；设置页只保留开关和「检查更新」按钮，不再渲染内联结果、安装包按钮或下载进度。
- 检查失败的文案（network / http / payload）移到弹窗组件，避免界面层和逻辑层各存一份。

## Alternatives considered

- **保留内联结果卡片，另加一个「在弹窗中查看」按钮** — 改动小，设置页现有测试几乎不用动。否掉原因：两套结果界面仍然并存，下载按钮、版本选择、失败重试仍有两份实现，正是这次要消除的漂移源。
- **设置页再挂一个 `AutoUpdateDialog`，手动检查只负责 fetch** — 复用组件最直接。否掉原因：会出现两个弹窗实例、两套可见性状态和两个下载状态机；后台检查与手动检查可能同时打开，用户看到哪个不确定。
- **手动检查复用 `useAppUpdate` 的完整状态机** — 无需改 hook。否掉原因：`useAppUpdate` 为内联卡片维护了下载轮询、版本选择锁和安装状态；弹窗已经有一套更完整的同名逻辑，保留两份只会让「安装包属于哪个版本」这类边界状态继续分叉。
- **关闭「自动检查更新」时手动检查也保持安静** — 状态少。否掉原因：手动按钮是明确请求，静默失败或静默重定向不可接受；偏好只控制后台检查频率。
- **已是最新时只显示 toast，不打开弹窗** — 轻量。否掉原因：反馈要求手动与自动弹窗一致；检查中、已是最新、失败都放进同一个弹窗，交互才可预期。

## Consequences

- **收益**：手动检查和后台提醒使用同一个组件、同一套文案、同一套下载 / 安装逻辑；用户从两个入口看到的界面一致。设置卡片少了约 265 行内联结果 UI，`use-app-update.ts` 从 575 行降到 112 行，下载轮询和安装状态只剩一份。
- **代价与已知上限**：设置页不再内联提供「多个更新版本点选」和「下载并安装」按钮；这些操作只在更新弹窗里完成。手动检查被「稍后再说」过仍会再次弹出——这是有意行为，但会让用户需要再点一次关闭。`UpdatePromptProvider` 必须包住设置页所在的 `<Stack>`，否则 `useUpdatePrompt()` 会抛错。
- 后台检查的 6 小时间隔、启动延迟与静默记录规则保持不变；跳过 / 稍后语义仍按精确版本生效。

## Verification

- `apps/mobile/__tests__/auto-update-dialog.test.tsx`：后台定时检查、稍后提醒窗口、跳过版本、桌面与安卓的应用内下载 / 安装路径。
- 同文件的 `UpdatePromptProvider - manual recheck during an active download`：stable 下载中关闭弹窗、切渠道为 beta、再次手动检查；任务未结束时弹窗重新打开的是 stable 任务（不是 beta），不出现可点的「立即更新」，也不发起第二次下载；stable 完成后才切到 beta，且不出现「立即安装并重启」，安装路径保持为空。
- 同文件的 `AutoUpdateDialog - desktop in-app install` 新增用例：设置页偏好 stable，用户在弹窗里主动切到 beta 并下载；beta 下载完成时仍显示 beta，安装使用 beta 的安装包，不会被默认偏好切回 stable。
- `apps/mobile/__tests__/settings-screen.test.tsx`：手动检查立即进入同一弹窗的「检查中」态；成功后出现 `auto-update-dialog-card`；已是最新走 `update-check-status-dialog`；代理 feed 比安装版本旧时，结论仍写「当前版本 0.1.3」而不是旧 feed 版本；失败态可重试；iOS 退化为 release 页；macOS 自动下载对应架构安装包；ChangeLog 渲染；版本号数字比较；beta 渠道切换。
- `apps/mobile/__tests__/datetime-picker.test.tsx` 与 `settings-screen.test.tsx` 全绿：`pnpm verify:web --no-serve` 通过 lint、typecheck、Jest（mobile 90 suites / 1091 tests）与 web build；日志 `/tmp/nextdo-verify-2026-11-23-round3.log`。
- 浏览器实测（`/tmp/nextdo-browser-check/layout-update-flow.mjs`，Chrome headless，1280×900，拦截代理请求；本轮日志 `/tmp/nextdo-browser-check/2026-11-23-browser-round3.log`）：
  - 手动检查「已是最新」：出现 `update-check-status-dialog`，文案含「已是最新版本」。
  - 手动检查有新版本：出现 `auto-update-dialog-card`，含 `发现新版本`、`v9.9.9` 与 ChangeLog。
  - 点「稍后再说」后再次手动检查仍会打开同一弹窗。
  - 检查失败：弹窗显示「检查更新失败 / 连不上更新服务器」；点「重试」后回到「已是最新版本」。
  - 后台检查：应用启动后自动打开同一个 `auto-update-dialog-card`。
  - 所有 6 次 atom 请求都走 `https://proxyd.picpi.top/` 前缀，没有直连 GitHub API。
