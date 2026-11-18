# Design — 生产部署与客户端连接

## 架构总览

```
手机 (Expo 原生)                电脑 (Tauri v2 壳)
  @powersync/react-native        同一个 apps/mobile/dist web 构建
  token → SecureStore            token → stronghold (Ristretto vault)
  原生 fetch（无 CORS）           webview fetch（有 CORS）
        \                            /
         ▼                          ▼
   https://<用户域名>/…（反向代理，用户侧）
     ├── /api/*      → api:8787        (Hono: /credentials, /upload)  ← 本任务加 CORS
     └── /sync/*     → powersync:8080  (PowerSync service，自带 ACAO:*)
                          ↕ WAL 复制
                       postgres:5432  (source of truth)
```

- 客户端两个 URL 是独立常量（`NextdoPowerSyncConfig { backendUrl, endpoint }`，`packages/db/src/powersync.ts:47`）→ 用户域名下的具体路径/子域布局**不影响客户端代码**。
- PowerSync service 自带 `access-control-allow-origin: *`（实测，2026-09-24）→ **CORS 只需加在 Hono 后端**。

## R5 — Hono 后端 CORS（server/app/src/app.ts）

- `createApp` 内加 hono 内置中间件：`app.use('*', cors({ origin: '*', allowHeaders: ['authorization', 'content-type'], allowMethods: ['GET', 'POST', 'OPTIONS'] }))`。
- 为什么 `origin: '*'` 可行：token 走 `Authorization` 头（不是 cookie），`*` 下无凭证暴露面；v1 单用户 + Bearer 鉴权，错误请求仍 401。
- 边界不变：鉴权中间件顺序在 CORS 之后；`/credentials`、`/upload` 行为不变。
- 验证：单测覆盖 OPTIONS preflight（带 Origin + Access-Control-Request-Header: authorization）与带 Origin 的 GET/POST 响应头。

## R4 — stronghold 存储重写（packages/db/src/owner-token.ts）

安装的 `@tauri-apps/plugin-stronghold@2.3.2` 真实 API（读自 `dist-js/index.d.ts`）：

```ts
const sh = await Stronghold.load(snapshotPath: string, password: string): Promise<Stronghold>
const client = await sh.createClient('nextdo')      // 已存在时 create 会报错 → 改 loadClient + fallback
const store = client.getStore()                     // 默认 store
store.get(key): Promise<Uint8Array | null>
store.insert(key, value: number[]): Promise<void>   // value 是字节数组
store.remove(key): Promise<Uint8Array | null>
await sh.save()                                     // insert/remove 后必须持久化
```

重写要点：

- `createStrongholdStore()` 内部：懒 `Stronghold.load`（模块级缓存实例）→ `loadClient('nextdo')`，失败回退 `createClient('nextdo')`（首次运行）→ `getStore()`。
- 快照路径与密码用**固定常量**（如 `nextdo-stronghold` / 密码 `nextdo-desktop-v1`）：Rust 侧已用 Argon2 + app 数据目录 salt 初始化插件（`apps/desktop/src-tauri/src/lib.rs`），JS 侧密码是 vault 解锁口令；v1 单用户，安全边界 = 本机加密文件（与其他本地桌面 App 同档），不是跨用户保密。此取舍写入 spec。
- 字符串 ↔ 字节：`TextEncoder`/`TextDecoder` 转换（web 运行时两者可用）。
- `setItem`/`removeItem` 成功后 `await sh.save()`；`getItem` 对空 vault/未创建记录返回 null（`store.get` 本身返回 null，无需吞错）。
- 保持现有契约：只存 `OWNER_TOKEN_KEY` 一个 key（与现实现一致，multi-key 仍抛 `storage.multi-key`）。
- 测试：jest 中 mock `@tauri-apps/plugin-stronghold`（Node 分支不会真加载插件，mock require 即可），覆盖 get/set/remove/多 key 拒绝/save 调用。
- Rust 侧脚手架命令（`save_owner_token`/`load_owner_token` 内存版）不动——JS 直接走插件命令，Rust 命令是死代码，移除属可选清理（deferred）。
- 已知风险点：`capabilities/default.json` 的 ACL 若缺某命令（如 save），运行时报权限错 → 单行 ACL 修复；在桌面实机验证步骤中确认。

## R3 — 首次启动门槛页（apps/mobile）

> **（已被 R6 取代：门槛页移除；本节保留为历史记录。`fetchCredentialsOnce` 纯函数与"启动预校验"机制仍有效，见 R6。）**

**为什么必须做「启动预校验」**：错误 token 时 `fetchCredentials` 抛 `credentials.rejected`，但 PowerSync v2 SDK **内部重试、不上抛**（`_layout.tsx:84-89` 的 catch 只兜底）——App 无法靠 SDK 错误感知 401。因此 token 有效性在**连接前**主动校验。

状态机（RootLayout 层，非路由）：

```
启动 → getOwnerToken()
  null        → Gate（未连接）
  有 token    → validate(config, token)   ← 新增纯函数（见下）
      200      → 主界面 + provider.connect()（现有机制）
      401      → clearOwnerToken() → Gate（显示「token 无效」）
      网络错误 → 主界面照常（离线可用，SDK 后台重试；v1 不做会话内 401 感知）
```

- **纯函数抽取**（packages/db/src/powersync.ts）：把 `fetchCredentials` 里的「Bearer GET {backendUrl}/credentials + 校验响应 token」抽成导出的 `fetchCredentialsOnce(config, ownerToken)`（返回 `{ ok: true, token } | { ok: false, kind: 'rejected', status } | { ok: false, kind: 'network' }`）；connector 内部改调它（行为不变，现有测试兜底）。Gate 与启动校验都调它——DRY，且协议只有一份。
- **Gate UI**（新组件 `apps/mobile/components/connect-gate.tsx`）：全屏，标题 + 单个 TextInput（token）+ Button（连接）+ 内联错误区。提交：`fetchCredentialsOnce` → ok → `setOwnerToken`（现有通知机制驱动 provider connect，Gate 自动消失）；401 → 「token 不正确」；网络错 → 「连不上服务器」。遵循 `app/component-guidelines.md` 的样式/token 约定（Paper Serenity 基线）。
- **渲染切换**：`RootLayout` 读 token 状态（async → loading/signed-out/signed-in），signed-out 时渲染 Gate 替代子树。不进 expo-router 路由（无状态机成本）。
- 会话内 token 轮换（重新部署换了 token）：v1 不感知，用户重启 App 即恢复（启动预校验覆盖）。Deferred，写入 spec。
- 测试（apps/mobile jest）：Gate 三态（成功/401/网络错）、RootLayout 切换逻辑（mock `@nextdo/db` 导出）。

## R6 — 云同步可选项（apps/mobile；取代 R3 的门槛页 UX）

**背景**：部署验证时用户拍板——云同步是可选项，部分用户只想本地用，不该被全屏门槛页挡住。底层已具备无 token 本地运行能力（`_layout.tsx` 的 provider：无 token → `disconnect()`，本地 SQLite 照常读写），所以 R6 是纯 UI/状态层改动，不动 `packages/db` 协议。

**改动面**：

- `app/_layout.tsx`：删除 `AuthGateState` 状态机、`gateError`、`handleConnect`、`ConnectGate` 渲染分支（含两处 auth useEffect）。启动预校验保留但降级：一个非阻塞 useEffect——`getOwnerToken()` 有值 → `fetchCredentialsOnce` → 仅当 401 时 `clearOwnerToken()` + `logger.warn`；200/网络错不做事。**渲染路径从此只有一条：字体 gate → `PowerSyncProvider` + `<Stack>`**（字体 gate 是 design §1.3 的防白屏机制，与 auth 无关，保留）。
- `app/(tabs)/settings.tsx`（新）：第 5 个 tab「设置」。云同步区块（`Card`）：
  - 状态来源：`getOwnerToken()`（挂载时读一次）+ `subscribeToOwnerTokenChange`（跟随变化）——与 provider 的 connect/disconnect 用同一事实源，UI 不会与同步状态分叉。
  - 未连接：说明文案（本地使用、数据不出本机；输入 owner token 开启同步）+ TextInput + 「连接」按钮 + 内联错误。提交：`fetchCredentialsOnce(getBackendConfig(), token)` → 200 → `setOwnerToken`（清空输入）；401 → 「token 不正确」；网络/其他 → 「连不上服务器，请稍后重试」。
  - 已连接：已连接说明（数据在这台设备与服务器之间同步）+ 「断开」按钮（`clearOwnerToken`）。断开为轻量操作，v1 不加二次确认（token 忘了可重输，数据留在本地 DB，无破坏性）。
  - 屏幕本身调 `packages/db` 函数（app 层，component-guidelines 允许；组件文件里不放网络调用——提交逻辑留在屏幕组件内，与 R3 的 RootLayout `handleConnect` 同档）。
- `app/(tabs)/_layout.tsx`：tab 栏追加 `<Tabs.Screen name="settings" options={{ title: '设置' }} />`（纯文本 tab，无图标，与现有四个一致）。
- 删除 `components/connect-gate.tsx` + `__tests__/connect-gate.test.tsx`；新增 `__tests__/settings-screen.test.tsx`。9 个屏幕测试文件里 `@nextdo/db` mock 的 auth 面（`getOwnerToken` 等）**仍被启动预校验与 provider 使用，保留**，仅更新过期注释（"so the screen (not the ConnectGate) renders"）。

**测试策略**（settings-screen.test.tsx）：沿用 connect-gate.test.tsx 的 mock 形态（`renderRouter` + 可变 `mockAuth`，set/clear 触发同一 change 通知）：
1. 未连接态：区块文案 + 输入 + 连接按钮（空输入禁用）；
2. 提交成功：`setOwnerToken` 被调（存的是 owner token 非 JWT）→ UI 切已连接（断开按钮出现）；
3. 401：内联「token 不正确」，保持未连接，可重试；
4. 网络错：内联「连不上服务器，请稍后重试」；
5. 已连接态（mock 预存 token）：显示已连接 + 断开按钮 → 点断开 → `clearOwnerToken` → 回未连接；
6. 根级：无 token 启动直接渲染 Inbox（无门槛文案）；预存 token + 401 → token 被清 + 主界面照常。

**不做**：同步实时状态指示（PowerSync SDK 的 status 事件订阅——v1 显示"已连接"= token 已验证并存储；会话内 401 感知仍是 deferred）；设置页的其他内容（URL 不进 UI，版本页等 deferred）；断开的二次确认。

## R2 — 客户端配置点（apps/mobile/lib/env.ts）

- `DEV_BACKEND` 替换为显式生产常量，两个 URL + 醒目的「部署后在此填写」注释块：

```ts
// 生产配置 — 部署后填一次（手机/桌面共用；本地 e2e 用 e2e/run.ts 自有常量，不受影响）
const BACKEND: NextdoPowerSyncConfig = {
  backendUrl: 'https://REPLACE-WITH-YOUR-DOMAIN/api',
  endpoint: 'https://REPLACE-WITH-YOUR-DOMAIN/sync',
};
```

- 本地开发循环（tauri dev / simulator）在验证阶段把常量临时指 localhost，交付前切回生产 URL。
- `configureBackend()` 保留为测试接缝（不动）。
- web 构建（`expo export --platform web`）即桌面构建，同一常量，无分叉。

## R1 — 生产部署（server/deploy/，新增）

- `server/deploy/docker-compose.yml`：三容器，**全部只监听 127.0.0.1**（给同机反代用，不直接暴露公网）：
  - `postgres`：postgres:16-alpine + `wal_level=logical`（复用 dev compose 的 command/healthcheck/init 挂载——`server/powersync/init` 与 `service.yaml`/`sync-config.yaml` 以相对路径引用）。
  - `powersync`：journeyapps/powersync-service:1.26.1（同 dev）。
  - `api`：`build: { context: ../.., dockerfile: server/app/Dockerfile }`（Dockerfile 约定 context=repo root），env 指向 `postgres:5432`。
- 密钥：`server/deploy/.env`（gitignore）+ `.env.example`（POSTGRES_*、NEXTDO_OWNER_TOKEN、JWT_SECRET——后两者要求同一 JWT_SECRET，与 dev 约定一致）。
- `server/deploy/README.md`：干净机器部署步骤 + **反向代理示例（Caddyfile）**：

```caddy
your.domain {
    handle /api/* {  uri strip_prefix /api;  reverse_proxy 127.0.0.1:8787 }
    handle /sync/* { uri strip_prefix /sync; reverse_proxy 127.0.0.1:8080 }  # Caddy 自动 WebSocket upgrade
}
```

  （nginx 等价片段注释说明；路径布局可按用户实际调整——客户端只需把最终 URL 填进 R2 常量。）

## 兼容性 / 回滚

- 全部改动向后兼容本地 e2e 与现有单测（e2e 常量独立；connector 抽取不改行为）。
- 回滚 = revert 单个 feature 分支 merge；无数据迁移、无协议变更。
- 服务器侧：compose 独立目录，不动 dev 的 `server/powersync/`。

## 关键取舍

| 取舍 | 选择 | 理由 |
|---|---|---|
| 鉴权模型 | owner token（Home Assistant 模式） | 用户拍板；账号体系 spec 定为 post-MVP |
| CORS 范围 | Hono 加 `origin: *` | 无 cookie 凭证；PowerSync 侧已自带 `*` |
| stronghold 密码 | 固定常量 | v1 单用户本机加密，非跨用户保密；换 per-machine 派生属 post-MVP |
| 401 感知 | 启动预校验 + 连接前校验 | SDK 不上抛 401；会话内轮换 deferred |
| Gate 位置 | RootLayout 条件渲染 | 无新路由、无状态机 |
