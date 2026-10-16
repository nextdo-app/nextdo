# 🚀 Nextdo 零成本私有云同步搭建指南

> **文档适用对象**：所有 Nextdo 用户（全流程纯网页图形化操作，零代码、免命令行、免自备服务器）。  
> **预计耗时**：5 ~ 8 分钟  
> **服务成本**：永久 0 元（采用国际主流三大云厂商永久免费额度）

---

## 📌 架构与免费额度概览

Nextdo 采用离线优先架构（Local-first）。数据在本地设备毫秒级存取，通过云端服务在多设备（iPhone、Android、Mac、Windows）之间实现实时秒级双向同步。

```
┌────────────────────────────────────────────────────────┐
│               Nextdo 客户端 (手机 / 电脑)              │
└───────────────┬────────────────────────┬───────────────┘
                │                        │
       POST /upload (写入数据)           │ GET /sync/stream (实时接收变更)
       GET /credentials (获取认证)       │
                ▼                        ▼
      ┌──────────────────┐     ┌──────────────────┐
      │Cloudflare Workers│     │ PowerSync Cloud  │
      │   (无服务器后端)  │     │   (同步流引擎)   │
      └─────────┬────────┘     └─────────┬────────┘
                │                        │
                │ 直接写入数据库          │ 监听 WAL 复制流
                ▼                        ▼
      ┌───────────────────────────────────────────┐
      │         PostgreSQL 免费云数据库           │
      │         (Neon Serverless Postgres)        │
      └───────────────────────────────────────────┘
```

### 💡 永久免费资源说明

| 云服务提供商 | 角色功能 | 永久免费套餐额度 |
| :--- | :--- | :--- |
| **Neon** | PostgreSQL 核心数据库 | 免费 500 MB 存储容量，支持逻辑复制 (WAL) |
| **PowerSync Cloud** | 数据实时双向流同步引擎 | 每月 2 GB 同步流传输，50 个并发连接数 |
| **Cloudflare Workers** | 业务接口与安全认证服务 | 每天 100,000 次 API 请求，全球边缘网络加速 |

> 💬 **日常使用评估**：个人及家庭日常记录任务、习惯与笔记，每月仅消耗几十兆流量，免费配额绰绰有余。

---

## 🛠️ 四步极简搭建流程

### 第一步：获取免费 PostgreSQL 数据库（1 分钟）

我们选用当前最简易的 Serverless Postgres 数据库 **Neon**，数据库表结构由程序自动创建，无需手动敲写任何 SQL。

1. 打开 [Neon 官网 (neon.tech)](https://neon.tech/)，注册并登录账号。
2. 点击 **Create Project**，输入项目名称（如 `nextdo`），选择离你较近的区域，点击创建。
3. 开启数据库逻辑复制（必须步骤，供同步流引擎监听）：
   - 在左侧菜单点击 **Settings** -> **Logical Replication**。
   - 点击 **Enable** 开启。
4. 复制数据库连接串：
   - 回到 Dashboard 首页，在 **Connection Details** 中复制连接字符串，格式形如：  
     `postgresql://alex:password@ep-cool-fog-123456.us-east-2.aws.neon.tech/neondb?sslmode=require`
   - 保存此连接串备用。

---

### 第二步：配置 PowerSync 同步流引擎（2 分钟）

PowerSync 负责监听数据库变动并将差异实时分发至各端设备。

1. 打开 [PowerSync 官网 (powersync.com)](https://powersync.com/)，注册免费账号。
2. 进入控制台，点击 **Create Instance**（选择 Free Plan）。
3. **连接数据库**：
   - 填写第一步中复制的 Neon 数据库连接串；
   - 点击 **Test Connection** 测试连通，通过后保存。
4. **配置 JWT 身份认证密钥**（三个字段都得对，缺一个同步就失败）：
   - 在左侧菜单点击 **Authentication**，在 **HS256 Authentication Tokens (ADVANCED)** 区域点 **+** 新增一个 token；
   - **KID 必须填 `nextdo-dev`** —— Nextdo 后端签发的 JWT 头里固定带这个 kid，对不上时同步服务会以 `PSYNC_S2101`（keystore 里找不到匹配的 key）拒绝**每一次**同步；
   - **Shared Secret 必须是 base64url 编码、不带 `=` 填充**的字符串，且与下一步 Cloudflare 的 `JWT_SECRET` **完全一致**（含大小写）。格式不对时后端直接报错；两边不一致时同步服务以 `PSYNC_S2102`（签名无法验证）拒绝。可直接用这个示例：
     `crHOgyjM6cvRfuko_8z9DbZcRWBO6Y7D-uqndYh8h9s`
     想自己生成：`openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`；
   - 点 **Save and Deploy**。**只点 Save 不生效** —— 没 Deploy 的话实例跑的还是旧的 keystore，改了 kid 也照样报 `PSYNC_S2101`。（自托管同理：改完 `service.yaml` 必须 **重启 PowerSync 服务**，否则容器里还是旧配置。）
   - 记下该密钥（下一步原样填进 Cloudflare 的 `JWT_SECRET`）。
   - **JWT Audience（同一页下方）**：这一栏默认是空的，含义是「只接受实例 URL 作为 `aud`」。而 **beta.7 之前** 的 `worker.js` 签发的 `aud` 是 `nextdo` —— 用旧 worker 就必须在这里 **+ Add** 一条 `nextdo`，否则即使 KID 与 Secret 都对，同步仍会 401。**beta.7 起** 后端改用 `NEXTDO_SYNC_ENDPOINT`（实例 URL）当 `aud`，这一栏可以留空。
   - **关于 KID 更省事的做法**：上面的 KID 要与后端签发的一致；但如果实例里的键已经被 PowerSync 自己命名（在同步报错的 `Known keys: <kid: …>` 里能看到，形如 `hs256-key-1`），与其去改实例，不如把这个名字填到 Cloudflare 的 `NEXTDO_JWT_KID` 环境变量里（见第三步）。
5. **部署同步规则 (Sync Rules)**：
   - 在左侧菜单进入 **Sync Rules**；
   - 清空输入框，复制粘贴以下完整规则：

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

   - 点击右上角 **Deploy** 部署生效。
6. **确认实例已完成部署**：如果控制台右上角还挂着 **Finish Setting Up PowerSync**，说明上述改动尚未落到运行中的实例上 —— 点它把流程走完（等同于点 Save and Deploy）。此时界面里 KID/Secret 看着都对，运行中的实例用的仍是旧 keystore，客户端会一直报 `PSYNC_S2101`（原文里的「The key is missing」就是这么来的）。
7. 记录同步网址：
   - 回到 Instance Overview，复制你的 **PowerSync Instance URL**（格式如 `https://xxxx.powersync.journeyapps.com`）。

---

### 第三步：部署 Cloudflare Workers 后端（2 分钟）

Cloudflare Workers 负责接收客户端写入的数据，并在首次启动时**全自动在数据库中建齐 14 张数据表**。

1. 登录 [Cloudflare 控制台 (dash.cloudflare.com)](https://dash.cloudflare.com/)。
2. 左侧菜单进入 **Compute (Workers) -> Workers & Pages**，点击 **Create application -> Create Worker**。
3. 设定 Worker 名称（如 `nextdo-server`），直接点击 **Deploy**。
4. **配置环境变量与密钥**：
   - 进入刚刚创建的 Worker 页面，选择 **Settings** -> **Variables and Secrets**；
   - 点击 **Add** 依次添加以下 3 个必填参数：

| 变量名称 | 变量类型 | 内容来源 |
| :--- | :--- | :--- |
| `DATABASE_URL` | **Secret** (加密密钥) | 第一步中复制的 Neon 数据库连接串 |
| `JWT_SECRET` | **Secret** (加密密钥) | 第二步中填写的 PowerSync JWT 认证密钥 |
| `NEXTDO_SYNC_ENDPOINT` | **Text** (文本) | 第二步中记录的 PowerSync Instance URL |
| `NEXTDO_JWT_KID` | **Text** (文本) | **选填**。当实例里那把 HS256 密钥的 kid 不是 `nextdo-dev` 时，填实例**实际持有**的那个。值直接看同步报错里的 `Known keys: <kid: …>` —— PowerSync Cloud 会自己给条目命名（如 `hs256-key-1`），你在界面上敲的 KID 不一定就是它。不填则保持 `nextdo-dev` |

5. **在线填入代码**：
   - 点击右上角 **Edit Code** 打开网页在线代码编辑器；
   - 打开代码文件：复制本项目 `server/deploy/worker.js` 中的**全部内容**；
   - 在 Cloudflare 代码编辑器中全选（`Ctrl+A` 或 `Cmd+A`），粘贴覆盖原代码；
   - 点击右上角 **Deploy** 部署发布。

6. **查看专属服务看板**：
   - 部署完成后，在浏览器中直接打开你的 Workers 网址（形如 `https://nextdo-server.yourname.workers.dev`）；
   - 网页将自动初始化数据库（14 张表自动就绪），并显示 **Nextdo 云同步服务就绪看板**！

---

### 第四步：在 Nextdo 客户端开启同步（30 秒）

Nextdo 支持极简配对，无需手敲任何复杂的配置项：

#### 方案 A：一键唤起配对（最推荐）
在手机或电脑浏览器中打开刚才的 Workers 网页，直接点击绿色按钮 **「🚀 在 Nextdo App 中打开」**：
- 系统将自动拉起 Nextdo 应用；
- 自动完成密钥配对并连接成功；
- 状态显示 **「已连接」**，即刻开启实时双向同步！

#### 方案 B：连接串快速粘贴
1. 在 Workers 网页的专属看板中，点击 **「复制」** 按钮（复制完整连接串，形如 `https://...workers.dev|abcdef...`）；
2. 打开 Nextdo App，进入 **「设置」 -> 「云同步」**；
3. 将复制的内容粘贴到输入框中，点击 **「连接」**。

#### 方案 C：多设备扫码加入
当有一台设备连接成功后，在设置页面点击 **「显示配对二维码」**，其余设备只需在设置中点击 **「扫码连接」**，秒级加入同步网络。

---

## ❓ 常见问题排查 (FAQ)

### 1. Workers 打开提示 500 错误？
- 请检查 Cloudflare Worker 的 `DATABASE_URL` 是否完整包含 `?sslmode=require`。
- 确认 Neon 控制台中的 **Logical Replication** 已成功设置为 Enabled。

### 2. 同步状态一直显示“正在连接”或“认证失败”？
- 检查 Cloudflare 中的 `JWT_SECRET` 是否与 PowerSync 中的 **HS256 密钥** 完全一致（包含大小写与空格）。
- 确认 PowerSync 的 Sync Rules 已点击 **Deploy** 部署生效。
- 若 App 的云同步卡片显示 **「同步凭据被同步服务拒绝」** 并带 `PSYNC_S2101`：说明这个实例的 keystore 里没有 kid 为 `nextdo-dev` 的密钥。按顺序核对：
  1. **实例是否真的部署了** —— 控制台右上角若还有 **Finish Setting Up PowerSync**，先把它走完；这一步没做时，界面里 KID/Secret 填得再对也不生效，报错原文的「The key is missing」指的就是这个。
  2. **KID 是否对得上** —— 注意不是看你填了什么，而是看实例**实际**持有什么：同步报错里会写 `Known keys: <kid: …>`（PowerSync Cloud 会自己给条目命名，形如 `hs256-key-1`）。两边字面不同就必然 `PSYNC_S2101`。最省事的做法是把这个名字填到 Cloudflare 的 `NEXTDO_JWT_KID`；也可以反过来把实例里的键改名成 `nextdo-dev`；
  3. **Secret 是不是 base64url、且与 Cloudflare 的 `JWT_SECRET` 完全一致**；
  4. **JWT Audience**：这一栏为空时只接受实例 URL。用 beta.7 之前的 `worker.js` 就在这里 **+ Add** 一条 `nextdo`；换了 beta.7 的 `worker.js` 则无需此项。

  四项都确认后回 App 点 **「立即同步」** 即可，不需要重新配对或重装。
- 若显示 `PSYNC_S2102`（签名无法验证）：KID 对上了但密钥内容不同，常见原因是末尾多了空格，或 Shared Secret 填的不是 base64url 形式的那份。
- 若两者都核对过仍报错：确认 App 里显示的 **同步流地址** 与你刚才改配置的实例是同一个（Cloudflare 的 `NEXTDO_SYNC_ENDPOINT` 要填 PowerSync 控制台 Connect 弹窗里那个 Instance URL）。改到了另一个实例上同样会一直 401。
- 若显示 `PSYNC_S2103`（凭据过期）：点一下 **「立即同步」** 重新取一次凭据即可。

### 3. 多台设备同步是否收费？
- 完全免费。免费额度支持多达 50 台设备同时在线实时同步，数据存储与传输额度足够个人常年使用。