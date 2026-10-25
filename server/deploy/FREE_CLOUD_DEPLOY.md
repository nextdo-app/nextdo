# Nextdo 零成本免费云同步部署指南 (纯网页·零代码极简版)

> 💡 **在线飞书版本**：如果你更喜欢在线阅读或在手机端查看，可直接访问 [飞书文档：Nextdo 零成本私有云同步搭建指南](https://my.feishu.cn/wiki/FDWJwoCHsiBgltk0sW4cKs47nKb?from=from_copylink)。

本指南介绍如何利用三大主流云平台的**永久免费套餐**搭建 Nextdo 云同步服务，**无需自备服务器、无需公网 IP、无需在本地下载源代码或安装任何编程环境**，全程在浏览器网页中即可完成搭建！

> **✨ 极简设计核心优势**：
> 1. **无需下载源代码**：全程在 Neon、PowerSync 和 Cloudflare 的网页控制台中点选操作，不碰本地终端。
> 2. **数据库全自动建表**：无需打开 SQL Editor 复制执行任何 SQL，后端服务首次被访问时会自动创建所有 14 张数据表与索引。
> 3. **客户端只需填写 Workers 网址**：首台设备**只需填写 Workers 网址**，无需手动配置 PowerSync 地址，无需寻找 Token，自动免密认领绑定！
> 4. **多端秒级配对**：第二台设备直接扫码或粘贴连接串即可一键加入同步。

```
                    ┌────────────────────────┐
                    │ Nextdo 客户端 (手机/电脑)│
                    └────┬──────────────┬────┘
                         │              │
    /upload (写入) &     │              │ /sync/stream (读取变更)
    /credentials (认证)  │              │
                         ▼              ▼
             ┌───────────────┐   ┌───────────────────────┐
             │  Cloudflare   │   │    PowerSync Cloud    │
             │    Workers    │   │      (免费套餐)        │
             └───────┬───────┘   └──────────┬────────────┘
                     │                      │
                     │ 直接写入              │ 实时监听 WAL 复制
                     ▼                      ▼
             ┌───────────────────────────────────────────┐
             │       PostgreSQL 数据库 (Neon / Supabase)  │
             └───────────────────────────────────────────┘
```

---

## 免费额度说明

| 服务 | 角色 | 免费套餐额度 |
| :--- | :--- | :--- |
| **Cloudflare Workers** | API 后端 (`server/app`) | 每天 100,000 次请求，全球 Edge CDN 加速 |
| **Neon / Supabase** | PostgreSQL 存储数据库 | 免费 500MB+ 存储空间，支持逻辑复制 (WAL) |
| **PowerSync Cloud** | 数据实时同步流引擎 | 每月 2GB 同步流量，500MB 存储，50 个并发连接 |

> 对于个人或家庭使用，上述免费额度已完全充裕。

---

## 步骤一：创建免费 PostgreSQL 数据库（1 分钟，无需建表）

推荐使用 **Neon**（最简，无需在数据库控制台跑任何 SQL 脚本）：

1. 访问 [Neon 官网](https://neon.tech/) 注册并创建免费项目。
2. 在左侧进入 **Project Settings**，找到 **Logical Replication** 并点击开启（开启逻辑复制供 PowerSync 监听）。
3. 复制连接字符串，形如：
   `postgresql://user:password@ep-xyz.aws.neon.tech/neondb?sslmode=require`。

> 💡 **无需手动建表**：Nextdo 后端会在后续步骤被访问时**全自动创建全部 14 张表及所有索引**，你完全不需要打开 SQL Editor。

---

## 步骤二：配置 PowerSync Cloud 同步引擎（2 分钟）

1. 访问 [PowerSync 官网](https://powersync.com/) 注册免费账号并创建 **Instance**（选择 Free Plan）。
2. **连接数据库**：填写步骤一中获取的 Neon 连接字符串，完成连接测试。
3. **部署同步规则 (Sync Rules)**：
   在 PowerSync 控制台左侧进入 **Sync Rules**，复制并粘贴以下规则，点击 **Deploy**：

   ```yaml
   config:
     edition: 3

   streams:
     all:
       auto_subscribe: true
       queries:
         - SELECT id, created_at, updated_at, deleted_at, title, captured_at FROM inbox_items WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, title, outcome, value, status FROM projects WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, title, project_id, context_ids, est_minutes, value, category, due_date, deadline, depends_on_id, window_start, window_end, window_days, snoozed_until, last_snoozed_at, consecutive_skips, last_skipped_at, status, source_inbox_id, replaces_action_id FROM next_actions WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, title, waiting_on, expected_by, follow_up_at FROM waiting_for_items WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, title, starts_at, context_ids, est_minutes, value, category, deadline, snoozed_until, last_snoozed_at, consecutive_skips, last_skipped_at, status, source_inbox_id, replaces_action_id FROM calendar_actions WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, title, note FROM someday_maybe_items WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, title, url, note FROM reference_items WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, name FROM contexts WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, title, action_title, est_minutes, value, category, project_id, window_start, window_end, window_days, cycle_days, started_at, status FROM habits WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, habit_id, local_date, status, snoozed_until, last_snoozed_at, consecutive_skips, last_skipped_at FROM habit_days WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, action_kind, action_id, fires_at, intensity, state FROM reminders WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, action_id, action_kind, mode, planned_minutes, started_at, paused_sec, ended_at, status FROM focus_sessions WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, kind, at, snapshot, answers FROM review_records WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, action_kind, action_id, completed_at, est_minutes FROM completion_records WHERE deleted_at IS NULL
   ```

4. **配置 JWT 密钥**：
   在 PowerSync 控制台的 **Authentication** 设置中：
   - 选择 **HS256** 算法；
   - 填入一串自定义的 32 字符密钥（例如随便一段随机英文字符或通过密码生成器生成，复制备用）；
   - 保存。
5. **记录同步端点**：复制你的 **PowerSync Instance URL**（例如 `https://xxxx.powersync.journeyapps.com`）。

---

## 步骤三：部署后端至 Cloudflare Workers（2 分钟）

你可以选择 **方式 A（纯网页操作，推荐小白）** 或 **方式 B（命令行开发者）**：

### 方式 A：纯网页操作（无需下载源码与终端）

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)，在左侧菜单进入 **Workers & Pages**。
2. 点击 **Create application** -> **Create Worker**，输入名称（如 `nextdo-server`），点击 **Deploy**。
3. 进入刚刚创建的 Worker 详情页：
   - 点击 **Settings** -> **Variables and Secrets**；
   - 添加以下 3 个变量（点击 **Add**，类型选择 **Secret** 或 **Text**）：
     - `DATABASE_URL`：步骤一中获取的 Neon 数据库连接串（类型选 **Secret**）
     - `JWT_SECRET`：步骤二中填写的 JWT 密钥（类型选 **Secret**）
     - `NEXTDO_SYNC_ENDPOINT`：步骤二中记录的 PowerSync Instance URL（类型选 **Text**）
     - （可选安全项）`NEXTDO_CLAIM_SECRET` 或 `NEXTDO_OWNER_TOKEN`：
       - `NEXTDO_CLAIM_SECRET`：首次设备绑定配对密钥（Secret），防止公网 Worker 被陌生人扫描抢占绑定。
       - 或直接设置 `NEXTDO_OWNER_TOKEN`：预先设定的固定主令牌，部署完成后即为已认领状态。
4. 在 Worker 详情页面右上角点击 **Edit Code**（在线代码编辑器）：
   - 点击打开 [👉 **server/deploy/worker.js**](https://github.com/printsdf/Nextdo/blob/main/server/deploy/worker.js)（点击 GitHub 页面右上角的 **Copy raw file** 按钮即可一键复制全部代码），或从 [GitHub Releases](https://github.com/printsdf/Nextdo/releases) 附件中直接下载 `worker.js`；
   - 全选复制代码并粘贴覆盖编辑器的所有内容，点击右上角 **Deploy**！
5. 复制你部署好的 Worker 网址，例如：
   `https://nextdo-server.<your-subdomain>.workers.dev`

> 💡 **自检与自动建表确认**：在浏览器中直接打开该网址，页面将显示漂亮的 Nextdo 就绪面板并提示：“服务正常运行 · 数据库已自动就绪（14张表已创建）”！

---

### 方式 B：开发者命令行一键部署（适合有 Node.js 环境的用户）

如果你本地有 Node.js / pnpm 环境并克隆了仓库：

```bash
cd server/app
npx wrangler login

# 配置 3 个必要环境变量
npx wrangler secret put DATABASE_URL
npx wrangler secret put JWT_SECRET
npx wrangler secret put NEXTDO_SYNC_ENDPOINT

# 一键部署
pnpm deploy:worker
```

> ⚠️ **外部提醒通道需要从源码部署（方式 B）**：方式 A 使用的 `server/deploy/worker.js` 是发布时从源码打包的产物，只有包含 Cron 调度代码的版本才会投递外部提醒。

---

### 可选：开启外部提醒通道（飞书 / 个人微信）

有 DDL 的任务除了 app / 日历提醒之外，还可以额外推送到飞书或个人微信。这条通道由 Worker 的 **Cron 触发器**（`wrangler.jsonc` 的 `triggers.crons`，每分钟一次）驱动：它扫描到点的提醒并推送到下面配置的通道，与既有提醒方式**叠加**（原有行为不变）。

**1. 飞书自定义机器人**

在飞书群里添加「自定义机器人」，拿到 webhook 地址（形如 `https://open.feishu.cn/open-apis/bot/v2/hook/<hook-token>`）：

```bash
npx wrangler secret put NEXTDO_FEISHU_WEBHOOK   # 粘贴上面整条 webhook 地址
npx wrangler secret put NEXTDO_FEISHU_SECRET    # 仅当机器人安全设置为「签名校验」时需要
```

**2. 个人微信（经 Server 酱 Turbo 中转）**

个人微信没有官方自助推送 API，需要第三方中转。到 <https://sct.ftqq.com> 用微信扫码注册，拿到 SendKey：

```bash
npx wrangler secret put NEXTDO_SERVERCHAN_SENDKEY
```

> 免费会员每天最多 5 条；超出后推送失败，失败会记录在 `reminder_deliveries`（`status='failed'` 与 `last_error`）并写进 Worker 日志。

**3.（可选）时间显示时区**

```bash
npx wrangler secret put NEXTDO_TIME_ZONE   # 例如 Asia/Shanghai，默认 UTC
```

配置完成后重新部署一次（`pnpm deploy:worker`）。**一个通道都没配置时，Cron 触发器直接跳过，不产生任何投递。**

**去重与失败**：每条 (提醒, 通道) 只在 `reminder_deliveries` 里成功占位一次，因此同一条提醒不会重复推送；推送失败会在一次调度内重试（上限 3 次），仍然失败则记录状态并打日志，不会静默丢弃。

---

## 步骤四：在客户端开启同步（仅需填写 Workers 网址！）

打开 Nextdo 应用（iOS / Android / macOS / Windows / Web）：

### 1. 首台设备绑定（只需填入 Workers 网址）
1. 打开应用，进入底部导航的 **设置** 页面。
2. 找到 **云同步** 卡片：
   - 直接在输入框填入步骤三得到的 **Worker 网址**（例如 `https://nextdo-server.<your-subdomain>.workers.dev`）。
3. 点击 **连接**。
   - 客户端将自动向 Worker 发起握手；
   - 自动免密认领（Claim）绑定此服务器并保存密钥；
   - 自动获取 PowerSync 流端点并开启多端双向实时同步！
   - 连接成功后，界面将显示 **已连接**。

### 2. 后续设备配对（扫码或一键粘贴）
- 在已连接的首台设备上，点击 **扫码配对** 或 **复制连接串**；
- 在第二台设备（如手机）的设置中直接扫码或粘贴连接串，点击 **连接** 即可瞬间加入同一数据账本！

---

## 进阶技巧 (可选)

- **自定义域名**：在 Cloudflare Workers 控制台的 **Custom Domains** 中直接绑定自己的二级域名（如 `sync.yourdomain.com`），客户端直接填入该域名即可。
- **Cloudflare Hyperdrive 加速**：在 Cloudflare 控制台创建 Hyperdrive 连接池并绑定，可显著降低跨国访问 PostgreSQL 数据库的延迟。
