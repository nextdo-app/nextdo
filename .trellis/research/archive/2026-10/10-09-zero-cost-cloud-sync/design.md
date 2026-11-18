# Technical Design: 零成本多端云同步与免源码极简接入

## 1. 架构总览

```
               ┌────────────────────────────────────────────────────────┐
               │         Nextdo 客户端 (macOS DMG / Android APK)         │
               └───────────┬────────────────────────────────┬───────────┘
                           │                                │
    /upload (写入事务) &    │                                │ /sync/stream (实时接收变更)
    /credentials (认证鉴权) │                                │
                           ▼                                ▼
               ┌───────────────────────┐        ┌───────────────────────┐
               │  Cloudflare Workers   │        │    PowerSync Cloud    │
               │ (边缘无服务器 Serverless)│        │      (免费套餐)       │
               └───────────┬───────────┘        └───────────┬───────────┘
                           │                                │
                           │ pg 直连写入                     │ 监听 WAL 逻辑复制
                           ▼                                ▼
               ┌────────────────────────────────────────────────────────┐
               │          Neon Serverless PostgreSQL (免费套餐)         │
               │               (自动初始化 14 张核心业务表)               │
               └────────────────────────────────────────────────────────┘
```

---

## 2. 服务端设计 (Cloudflare Workers + Hono)

### 2.1 运行时与入口 (`server/app/src/worker.ts`)
- 基于 Hono 边缘路由框架，导出标准 ES 模块 `export default { fetch: (req, env, ctx) => ... }`。
- 环境变量按需获取：`DATABASE_URL`（数据库连接串）、`JWT_SECRET`（PowerSync HS256 签名密钥）、`NEXTDO_SYNC_ENDPOINT`（PowerSync 实例端点）。
- 兼容 Cloudflare Hyperdrive 数据库连接加速池绑定（`env.HYPERDRIVE?.connectionString` 优先于 `env.DATABASE_URL`）。

### 2.2 全自动模式迁移 (`server/app/src/schema-init.ts`)
- 服务首次被访问时，使用单例 Promise 互斥执行建表 DDL：
  - 创建 14 张核心业务数据表与索引：`inbox_items`, `projects`, `next_actions`, `waiting_for_items`, `calendar_actions`, `someday_maybe_items`, `reference_items`, `contexts`, `habits`, `habit_days`, `reminders`, `focus_sessions`, `review_records`, `completion_records`。
  - 创建逻辑复制发布 publication：`powersync`。
  - 创建系统配置表：`system_settings` 用于持久化动态认领状态。
- 如果表已存在（`IF NOT EXISTS`），跳过创建；完全幂等。

### 2.3 免密自动认领 (Auto-Claim)
- `/claim/status`：检查是否已被认领。
- `/claim/claim`：在未认领状态下，自动生成基于高安全随机数的 32 字节 Owner Token，持久化写入数据库 `system_settings`，并返回给首次发起请求的客户端。
- `/credentials`：如果配置了 `NEXTDO_SYNC_ENDPOINT`，在响应中下发 `endpoint` 字段，客户端无需手动填写 PowerSync 地址。

---

## 3. 客户端适配设计 (`apps/mobile/app/(tabs)/settings.tsx`)

### 3.1 自适应地址探测
- 客户端在默认的「连接串配对」模式下，通过 `isPlainHttpUrl(token)` 智能探测输入内容。
- 如果用户直接粘贴了纯 HTTP/HTTPS 服务端网址（而非 `<base>|<token>` 或 `nextdo://` 协议串），系统自动将其视作自建服务端地址并附带空 Token 发起连接。
- 客户端自动触发 Auto-Claim 握手，无需用户手动切换 Tab 或寻找 Token。

### 3.2 教程与引导
- 引入 React Native `Linking.openURL`，在未连接卡片提供一键跳转至 GitHub README 零成本云同步教程的显式入口。
- 优化引导卡片文案，分清“首台设备免密绑定”与“多端扫码配对”的不同场景。

---

## 4. 构建与分发设计 (`release.yml` & `worker.js`)

### 4.1 单文件 Worker 打包
- 使用 Wrangler 与 esbuild 将 `server/app` 及其依赖全量打包为一个独立的 `worker.js` 文件（~310 KB）。
- 不依赖 node_modules，不依赖任何本地文件系统路径，可直接粘贴进 Cloudflare 在线网页编辑器。

### 4.2 CI/CD 发布流水线
- 在 `.github/workflows/release.yml` 中新增 `build-worker` 阶段。
- 产物 `worker.js` 通过 `upload-artifact` 传入 `bundles/` 目录，随 GitHub Release 一同发布，用户可在 Releases 页面直接下载。
- 在仓库中维护最新的 [`server/deploy/worker.js`](./server/deploy/worker.js)，供用户在网页上一键“Copy raw file”。
