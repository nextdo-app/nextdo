# 外部提醒通道（飞书 / 个人微信）

## Goal

为有 DDL 的任务增加 IM 提醒投递通道：飞书自定义机器人与个人微信（经 Server 酱 Turbo 中转），由 Cloudflare Workers Cron 在到点时刻发出，与现有 app / 日历通道叠加。

## Background

用户反馈：有 DDL 的任务靠日历提醒「不太靠谱」，希望增加微信与飞书的提醒。日历通道（`10-23-macos-calendar-channel`）解决的是「应用关闭时桌面端仍能到点」，但通知本身仍淹没在系统日历里；IM 消息的注意力权重更高，这是本次要补的缺口。

DDL 语义现成：`NextAction.deadline` / `CalendarAction.deadline` / `Project.deadline`（`packages/core/src/domain/types.ts`），提醒规格由 `deadlineReminderSpec`（`packages/core/src/domain/invariants.ts:457`）与 `calendarActionReminderSpec`（同文件 :420，开始前 15 分钟）生成，落在 `reminders` 表（`fires_at` / `intensity` / `state`，读查询见 `packages/db/src/queries/reminders.ts`）。

### 已核实的通道能力（官方文档）

飞书自定义机器人（《自定义机器人使用指南》，文档更新 2025-03-27）：

- `POST https://open.feishu.cn/open-apis/bot/v2/hook/<key>`，JSON body，≤ 20 KB；
- 支持文本 / 富文本 / 群名片 / 图片 / 飞书卡片；
- 频率：单租户单机器人 100 次/分钟、5 次/秒（官方建议避开整点，否则可能 11232 限流）；
- 安全：自定义关键词 / IP 白名单 / 签名校验（`timestamp + "\n" + secret` 做 HmacSHA256 再 base64）三者可叠加；
- 约束：只能在当前群使用（可为只有自己的群）；**不能响应用户消息**——卡片按钮回调需要「应用机器人」（app_id/app_secret + 事件订阅）。

企业微信消息推送（原「群机器人」，《消息推送配置说明》，文档更新 2025-08-07）：

- `POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<key>`；
- 八种消息类型：text / markdown / markdown_v2 / image / news / file / voice / template_card；
- 频率：每个机器人 ≤ 20 条/分钟；支持 `<@userid>` / `mentioned_mobile_list`；
- 无签名机制，安全性完全依赖 key 保密。

个人微信：无官方自助推送 API，需经第三方中转。已核实 Server 酱 Turbo（`sct.ftqq.com`）：`POST https://sctapi.ftqq.com/<SendKey>.send`，注册即可获得免费会员，**每天最多发送 5 条**；订阅会员不限条数。待核实：企业微信「微信插件」当前是否仍提供；Push Plus 等其他中转的配额。

## Requirements

### R1 投递执行者：Cloudflare Workers Cron（已定）

已决定：调度放在 Cloudflare Workers 的 Cron Trigger 上，数据库为公网可达的 Postgres（Supabase / Neon 这类部署形态）。

DDL 提醒是「未来某一精确时刻的一次 HTTP 请求」，必须有一个在那一刻仍然存活的执行者。已确认的能力边界：

- 手机（Expo）：只排 OS 本地通知，未装 `expo-task-manager` / `expo-background-task`，无法定时发 HTTP；
- 桌面（Tauri）：`apps/desktop/src-tauri/src/lib.rs:920-924` 关窗时 `hide() + prevent_close()`，进程在托盘常驻，JS tick 可继续投递；但隐藏 webview 的定时器会被节流（分钟级延迟），退出即停；
- 服务端（可选）：现有 Hono 后端（`server/app/src/app.ts`，仅 `GET /credentials` + `POST /upload`）可承载调度；Cloudflare Worker 入口 `server/app/src/worker.ts` 目前只有 `fetch`，无 `scheduled`。

由此确定的功能边界：外部提醒通道**依赖服务端部署**，纯本地、不跑服务端的用户拿不到该通道（其 app / 日历通道行为不变）。

#### Cloudflare Workers 作为执行者（已核实）

- Cron Triggers 是 Workers 官方能力（文档 `/workers/configuration/cron-triggers/`，同页 Runtime APIs → Handlers 另有 `Scheduled Handler`）：以 cron 表达式声明在 `wrangler` 配置的 `triggers.crons` 中，代码侧导出 `async scheduled(controller, env, ctx)`；最小粒度为分钟级；
- 本仓库已具备这条路径：`server/app/src/worker.ts`（当前只有 `fetch`）、`server/app/src/wrangler.jsonc`（尚无 `triggers` 块）、`server/deploy/worker.js`（打包产物）与 `FREE_CLOUD_DEPLOY.md` 的 Cloudflare 部署说明——加调度是小改动，不是新栈；
- `compatibility_flags: ["nodejs_compat"]` 已开启，Worker 可经 Hyperdrive 或直连 TCP 访问 Postgres，因此能读 `reminders` 并写入投递去重状态；
- 飞书 / 企业微信 webhook 从 Cloudflare 全球网络可达。

未采用：EdgeOne（腾讯云）Edge Functions 的定时触发能力本次未能确认，且同样要求数据库公网可达；已选 Cloudflare。

### R2 通道范围与配置

通道范围（已定）：

- 飞书自定义机器人 webhook；
- 个人微信——无官方自助推送 API，需经第三方中转。已核实 Server 酱 Turbo（`sct.ftqq.com`）：端点 `POST https://sctapi.ftqq.com/<SendKey>.send`；免费会员注册即可获得，**每天最多发送 5 条**；订阅会员不限条数（每日 API 请求次数另有上限）。

配置存放（已定：服务端 secret）：

- 飞书 webhook URL、签名 secret、Server 酱 SendKey 均存于部署侧 secret（`wrangler secret put` / `.env`），与现有 `NEXTDO_OWNER_TOKEN` 同一模式；
- 不动同步 schema，密钥不进入 Postgres；App 设置页不提供录入入口，变更需重新部署；
- 凭证按密钥对待：不得明文散落在可公开查阅处。

### R3 与既有投递层的关系

- 与现有 `reminderChannel: 'app' | 'calendar' | 'both'`（`apps/mobile/lib/notification-settings.ts`，设置页「提醒与通知」→「提醒方式」，`apps/mobile/app/(tabs)/settings.tsx:947`）语义对齐，不破坏现有通道行为；
- 叠加语义（已定）：外部通道是额外保险，app / 日历通知照旧发出；任何一条路径失败时另一条仍能到达；
- 投递幂等：不得重复投递同一条提醒（现有 v1 客户端不写 `fired` 标记，服务端调度需要自己的去重机制）。

### R4 失败与降级

- webhook 失败（网络／限流／凭证失效）不得静默丢失：需可观测（日志／状态）并按策略重试；
- 外部通道不可用时，既有 app / 日历通道行为不变。

## Acceptance Criteria

- [ ] 飞书自定义机器人与 Server 酱个人微信通道均能在 DDL 到点时送达；
- [ ] 到点的 DDL 提醒能通过飞书群机器人送达，内容含行动标题与截止时间；
- [ ] 同一条提醒不重复投递；
- [ ] webhook 失败可观测且不吞掉提醒；
- [ ] 既有 app / 日历通道行为不变；
- [ ] `pnpm lint`、`pnpm typecheck` 通过；
- [ ] 实测证据存于 `.verify/10-24-external-reminder-channels/`（含 `evidence.md` 与截图）。

## Out of scope

- 交互式回调（消息内「完成／推迟」按钮）——需飞书应用机器人或企微自建应用，另议；
- 平台原生日程通道（飞书日历 / 企微日程 API 建带提醒的日程）；
- 移动端后台 HTTP 投递（平台能力不允许）。

## Notes

- 关联任务：`10-23-macos-calendar-channel`（桌面日历通道）、`10-21-reminder-calendar-channel-and-action-notes`。
- 技术设计见 `design.md`，执行计划见 `implement.md`。
