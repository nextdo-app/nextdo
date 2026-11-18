# Node.js / Hono / pg / pnpm（2026-09-21 核实）

> 核实方式：nodejs.org 官方 dist 索引 + nodejs/Release 官方 schedule.json + npm registry。

## ⚠️ 头号风险：spec 写死的 Node 20 已 EOL，且低于 Expo SDK 57 最低要求

官方 release schedule（https://raw.githubusercontent.com/nodejs/Release/main/schedule.json）：

| Node 版本 | 状态（2026-09-21） | 关键日期 | 最新小版本 |
|---|---|---|---|
| **20 "Iron"** | **已 EOL** | EOL **2026-04-30**（已过去 5 个月） | v20.20.2（终版，无后续安全更新） |
| 22 "Jod" | Active LTS（维护期） | lts 2024-10-29 → maintenance 2025-10-21 → EOL 2027-04-30 | **v22.23.2** |
| **24 "Krypton"** | **Active LTS（推荐）** | lts 2025-10-28 → EOL **2028-04-30** | **v24.21.0** |
| 26 | Current | 2026-05-05 发布，2026-10-28 转 LTS | v26.9.0 |

- **Expo SDK 57 的官方最低 Node 版本 = 22.13.x**（docs.expo.dev/versions/latest/ 版本表）→ spec 的 Node 20 **连 Expo 57 的门槛都不满足**，不只是"过期"问题。
- **建议：Node 24（v24.21.0，Krypton Active LTS，支持到 2028-04）**。理由：满足 Expo 最低要求、剩余支持期最长、2026-10 后 Node 26 转 LTS 时 24 仍是 Active LTS。Node 22 也合规但 2027-04 就 EOL。
- 落地：根 `package.json` 加 `"engines": { "node": ">=22.13" }`（或 `>=24`），`.nvmrc` / `volta` 指向 24.x；**同步修改 spec 中 "Node 20" 的表述**（spec 变更属于本任务的显式决策点，需在 implement 前确认）。
- `@types/node` 配套：**Node 24 → `@types/node@24.13.6`**（24.x 线最新；npm overall latest 是 26.6.2 对应 Node 26，不要用）。Node 22 → 22.20.4。

## Hono

- `hono`：current major = **4**，latest = **4.13.8**（https://www.npmjs.com/package/hono）。
- Node 适配层包名：**`@hono/node-server`**（不是 `hono/node`），latest = **2.1.1**（v2 线），peerDependency `hono ^4` —— 与 4.13.8 匹配。
- 用法：`import { serve } from '@hono/node-server'; serve(app)`（`serve({ port })` 或拿回 httpServer 供测试/嵌入）。

## pg (node-postgres)

- latest = **8.23.0**（https://www.npmjs.com/package/pg），v8 线内无 breaking。
- 配套 `@types/pg`（如严格模式需要；pg 8 自带较完整类型，按需 pin）。
- 注意：spec 要求所有 server 侧 SQL 收敛在 `server/app/src/db.ts` 的 pool 中——与版本无关，但 scaffold 时 `pg.Pool` 的 `max`/`idleTimeoutMillis` 建议显式配置。

## pnpm

- current major = **12**，latest = **12.5.1**（https://www.npmjs.com/package/pnpm）。
- 根 `pnpm-workspace.yaml` 的 `packages` 字段 = **glob 列表**（官方 v12 文档 https://pnpm.io/pnpm-workspace_yaml）：

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'server/*'
```

- v11+ 新增能力（可选）：`catalogs`（集中版本目录）、`packageConfigs`（按项目覆盖 saveExact 等）。
- 注意事项：
  - **pnpm 12.4.1 起**：根 `package.json` 里声明非空 `workspaces` 数组而没有 `pnpm-workspace.yaml` 会告警（静默不 link 任何项目）——本项目以 `pnpm-workspace.yaml` 为唯一 workspace 声明，根 package.json **不要**写 `workspaces` 字段。
  - 跨 workspace 引用用 `workspace:*` 协议（如 `"@nextdo/core": "workspace:*"`）。
  - 原生模块（`@op-engineering/op-sqlite`、expo 相关）的 postinstall 构建在 pnpm 10+ 默认被拦截，需在 `pnpm-workspace.yaml` 里配 `onlyBuiltDependencies` / `neverBuiltDependencies`（pnpm 10/11/12 的构建审批机制）；scaffold 装 op-sqlite 时留意安装日志里的 "Ignored build scripts" 提示。

## 来源 URL

- https://raw.githubusercontent.com/nodejs/Release/main/schedule.json （v20 EOL 2026-04-30；v22/v24/v26 时间线）
- https://nodejs.org/dist/index.json （v20.20.2 / v22.23.2 / v24.21.0 / v26.9.0）
- https://docs.expo.dev/versions/latest/ （Expo 57 最低 Node 22.13.x）
- https://www.npmjs.com/package/hono （4.13.8）
- https://www.npmjs.com/package/@hono/node-server （2.1.1，peer hono ^4）
- https://www.npmjs.com/package/pg （8.23.0）
- https://www.npmjs.com/package/pnpm （12.5.1）
- https://pnpm.io/pnpm-workspace_yaml （packages glob、catalogs、12.4.1 workspaces 告警）
