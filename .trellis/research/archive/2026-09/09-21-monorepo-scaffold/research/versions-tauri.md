# Tauri v2 版本与外部 Web Bundle 接线（2026-09-21 核实）

> 核实方式：crates.io API（`/api/v1/crates/tauri`）、npm registry、Tauri v2 官方配置参考（v2.tauri.app/reference/config/）。

## 结论速查

| 项 | 锁定值 | 状态 |
|---|---|---|
| `tauri`（Rust crate） | `2.11.6`（2026-09-19 发布） | v2 最新稳定；`3.0.0-alpha.1`（2026-09-15）是 alpha，**不用** |
| `@tauri-apps/cli`（npm devDep） | `2.11.5` | 与 crate 2.11.x 配套（npm CLI 发布略滞后属正常） |
| `@tauri-apps/api`（npm dep） | `2.11.1`（2026-06-17 发布） | 稳定 |
| `@tauri-apps/plugin-stronghold` | `2.3.2`（2026-08-31 发布） | 稳定；无 peerDependencies（自包含）；3.0.0-alpha.0 存在但不用 |
| Rust 工具链 | 当前 stable **1.98.1**（2026-09-01） | crate 元数据 MSRV = **1.77.2**（下限）；建议直接用当前 stable |

注意：`@tauri-apps/api 2.11.1` 早于 crate 2.11.6，但 JS/JS-API 与 Rust 端各自独立发版，同一 minor 线内混用无碍；scaffold 时保持三者同在 2.11.x 线即可。

## 指向外部已构建 web bundle（tauri.conf.json）

Tauri v2 的 `build` 段（BuildConfig，v2 字段名与 v1 不同：v1 的 `distDir` 已改名为 `frontendDist`）：

```jsonc
// apps/desktop/src-tauri/tauri.conf.json
{
  "identifier": "com.nextdo.desktop",
  "productName": "Nextdo",
  "version": "0.1.0",
  "build": {
    // 生产：先构建 Expo Web，再嵌入
    "beforeBuildCommand": "pnpm --filter @nextdo/mobile run export:web",
    // 生产 bundle 路径（相对 src-tauri/），指向 expo export --platform web 的 dist 输出
    "frontendDist": "../../mobile/dist",
    // 开发：Expo/Metro web dev server（expo start --web 默认 8081）
    "devUrl": "http://localhost:8081",
    "beforeDevCommand": "pnpm --filter @nextdo/mobile start:web"
  },
  "app": {
    "security": { "csp": null },
    "windows": [{ "title": "Nextdo", "width": 1200, "height": 800 }]
  },
  "bundle": { "active": true, "targets": "all" }
}
```

字段语义（来源：https://v2.tauri.app/reference/config/）：

- **`build.frontendDist`**：`string | string[]`。给相对/绝对路径时，Tauri 会**递归读入并嵌入进二进制**，并以其中的 `index.html` 为入口 —— 这正是"外部已构建的 Expo Web bundle"的接线方式。给 URL 时则改为加载远程地址（本项目不用）。
- **`build.devUrl`**：`string | null`，`tauri dev` 时加载的 dev server URL（HMR）。若不想跑 dev server，可留空让 Tauri 内置静态 dev server 提供 `frontendDist` 目录（简单 reload）。
- **`build.beforeBuildCommand` / `beforeDevCommand`**（HookCommand）：在 `tauri build` / `tauri dev` 前执行的 shell 命令，支持 `{ script, cwd, wait }` 对象或字符串；这就是"先 `expo export --platform web` 再打 Tauri"的挂载点。
- 其他相关：`app.security.csp`、`app.withGlobalTauri`；插件权限走 `src-tauri/capabilities/*.json`（v2 的 ACL capability 文件，stronghold 插件的命令需在 capability 的 `permissions` 里显式放行，如 `stronghold:default` 或具体命令）。

## Rust 工具链

- `tauri` 2.11.6 crate 元数据 `rust_version = "1.77.2"`（MSRV，2024 年水平；实际构建 2.11.x 建议 ≥1.77.2，直接用当前 stable 最稳）。
- 当前 Rust stable：**1.98.1**（2026-09-01 发布；来源 static.rust-lang.org/dist/channel-rust-stable.toml）。`rustup default stable` 即可。
- 平台依赖：macOS 需 Xcode CLT + webkit2gtk（Linux）/ WebView2（Windows 运行时）；本机（darwin）只需 CLT。

## 注意事项 / 风险

- **Tauri 3 已进入 alpha**（3.0.0-alpha.1，2026-09-15，edition 2024，rust_version 1.95）：v2 仍是唯一稳定线，scaffold 用 v2；后续升级 3.0 属独立任务。
- `@tauri-apps/cli` 是 npm devDependency（`pnpm dev -w` 之外要装 `@tauri-apps/cli` 到 apps/desktop，因为 `tauri` crate 只提供库不提供 CLI）。
- 本项目桌面端 = Tauri shell + Expo Web bundle（spec 已定），**不需要** `@powersync/tauri-plugin`（alpha 0.0.6）；桌面端 PowerSync 走 **`@powersync/web` 的 web 路径**（按平台实例化：web → `PowerSyncDatabaseWeb` + worker），`@powersync/react-native` 在 web 构建中被 Metro `resolveRequest` 桩为空——两个 SDK 都安装（见 versions-powersync.md RN-Web 核实节）。
- `frontendDist` 路径是**相对 `tauri.conf.json` 所在目录（src-tauri/）**的，`expo export` 输出默认在 `apps/mobile/dist`，故为 `../../mobile/dist`。

## 来源 URL

- https://crates.io/api/v1/crates/tauri （2.11.6 = max_stable_version，2026-09-19；3.0.0-alpha.1；rust_version 1.77.2）
- https://www.npmjs.com/package/@tauri-apps/cli （2.11.5）
- https://www.npmjs.com/package/@tauri-apps/api （2.11.1，2026-06-17）
- https://www.npmjs.com/package/@tauri-apps/plugin-stronghold （2.3.2，2026-08-31）
- https://static.rust-lang.org/dist/channel-rust-stable.toml （stable 1.98.1，2026-09-01）
- https://v2.tauri.app/reference/config/ （BuildConfig：devUrl / frontendDist / beforeBuildCommand / beforeDevCommand；Capability 结构）
