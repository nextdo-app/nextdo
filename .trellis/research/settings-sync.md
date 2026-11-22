# 设置项跨设备同步（issue #97）

状态：已决策并实现，2026-11-20。验证记录见下文。

## 背景与范围

- 缺口：PowerSync schema 没有 settings 表；主题、专注时长、引擎可用时间等偏好
  只存本机（SecureStore / localStorage），换设备后需要重新配置。
- 既有规范 `spec/app/state-management.md` 已要求「影响行为的设置放 settings 表」，
  实现一直未跟上；本 issue 先决定同步范围，再补表与客户端读写。

## 决策：同步范围

同步（账本级偏好；两台设备登录同一账本后自动一致）：

- 外观主题 `theme-preference`（`system` / `light` / `dark`）。
- 专注时长偏好 `focus`（最近一次选择的分钟数，1–180）。
- 引擎可用时间 `engine-context`（Now 页的可用分钟数，1–1440）。

保留本机（设备能力、安装状态或设备标识）：

- 通知与提醒 `notifications`：含提醒通道、日历开关、声音；提醒通道在
  `domain-model.md` 中已定为设备级偏好，日历授权与目标日历也属于本机。
- 习惯打卡提醒 `habit-reminders`：它驱动本机 OS 通知排程。
- 应用更新 `update-*`：安装渠道、跳过版本、snooze 描述本机这份安装。
- 日历同步状态与目标日历：事件 / 日历 id 只在本机系统数据库有意义。
- 同步服务地址与 owner token：设备接入凭据。
- iOS PWA 安装提示的关闭时间戳。

理由：主题、专注时长、可用时间是纯用户偏好，没有设备能力依赖；其余设置若跨设备
覆盖，会在另一台设备上产生无法兑现的状态（无权限的通知、不存在的日历、错误的
构建渠道）。本 issue 的方案与默认值属于实现选择，已提交 reviewer 复核。

## 表与读写

- 新表 `settings`：`id, created_at, updated_at, deleted_at, key, value`；
  `value` 存 JSON 文本。一行一个 key。
- `id = "setting:<key>"`（确定性 id）：两台设备写同一 key 落到同一行，由
  PowerSync 的 upsert / 行级 LWW 合并，不会产生重复行。settings 不是领域实体，
  id 不使用 ULID，这是对「同步表 id 为 ULID」的唯一偏离，已在行上注释。
- 读：`listAppSettings` / `getAppSetting`；`settingsWatchQuery` 供页面 watch。
- 写：`setAppSetting(db, { key, value }, now, { onlyIfMissing })`，先写本地 SQLite，
  联网后由 PowerSync 上传。`onlyIfMissing` 只用于播种，避免覆盖已下载的行。
- 服务端：`schema-init.ts` 与 `server/powersync/init/02-nextdo-schema.sql` 建表与
  key 索引；`server/app/src/db.ts` 的 `MUTABLE_TABLES` 加表（upsert）；
  `server/powersync/sync-config.yaml` 同步流加 SELECT。

## 客户端集成（local-first）

- `apps/mobile/hooks/use-synced-settings.ts` 挂成 `SyncedSettings`，位于
  PowerSync provider 内（与提醒投递、日历同步引擎并列）。它 watch `settings` 表：
  - 有行：解析并应用到 theme / focus / engine 模块——更新模块缓存、通知订阅者、
    回写设备本地缓存（保证下次启动首帧正确）。
  - 无行：若本机存过显式值，播种一行；未设置过则写默认值时跳过，避免默认值
    覆盖另一台设备的显式选择。
- 设备本地模块仍是启动首帧的缓存；DB 行是同步事实来源。DB 值到达后覆盖本地缓存；
  theme 的本地首次读取带守卫，不会反向覆盖已应用的同步值。
- 播种只认「本地存储里真实存在的值」，不认模块缓存：首读空存储会把 `system` /
  60 分钟放进缓存，但那不是用户选择。`readStoredThemePreference` /
  `readStoredEngineContext` / `readStoredFocusSettings` 直接读设备存储，空值返回
  `null`。
- 用户修改：三个模块的保存路径在本地写成功后，通过
  `apps/mobile/lib/synced-settings-bus.ts` 排队写入 settings 表。
- 写失败 / 未提交：最新值保留为 pending，并在尝试写库之前写入设备存储。每个 key
  一个独立存储项（`nextdo.settings.pending.<key>`），成功时只删除本 key 的项；两个
  打开的标签页共用存储，但提交不同设置时不会清掉对方的 pending。刷新或重启后由
  bridge 在应用任何下载行之前恢复；bridge 在 pending 期间忽略该 key 的下载行，避免
  后续全表 watch 用旧值覆盖用户选择。`SyncedSettingsBanner` 全局显示「设置未同步到
  账本」并提供「重试同步设置」。只有 settings 表写成功后才清除 pending 与提示；重启
  后未提交的写入仍显示提示并可重试。
- 解析容错：非法 JSON / 非法取值忽略该行；未知 key 忽略（旧客户端可安全跳过新键）。

## 冲突与迁移

- 首次同步：两台设备都有本地显式值时，同一确定性 id 的两次写入按 PowerSync 行级
  LWW 合并，一台胜出；之后修改正常同步。
- 未显式设置过的设备不播种默认值。
- 不提供删行入口：重置偏好应写入默认值。若删行，其他设备会把本地旧值重新播种。

## 加固记录（2026-11-20）

- 播种边界：模块缓存可能装着首读默认值（theme `system`、engine 60），播种只读设备
  存储，不把它当显式选择。覆盖「正常启动先加载、再挂桥不播种」与「新设备无本地值、
  账本偏好随后下载」。
- 部署路径：两份云部署文档的可复制 Sync Rules 已包含 `settings`，并说明已有部署需
  更新后端建表/上传目录并重新 Deploy；仓库直贴版 `server/deploy/worker.js` 已用当前
  源码重建，`server/app/test/upload.test.ts` 断言产物含 settings 建表与上传列。
- 写失败持久化：bus 保留 pending 意图并写入设备存储，bridge 在应用下载行前恢复并跳过
  pending key；全局重试横幅在重启后仍可见。覆盖「注入写失败 → 提示 → 旧行重发仍保留
  → 刷新后仍保留 → 重试恢复 → 再刷新仍为新值」。
- 多标签页持久化：早期实现把全部 pending 存成一个 JSON 快照，另一标签页提交其他设置时
  会用不含本 key 的快照覆盖存储，刷新后丢失意图。现改为每 key 一个存储项，持久化队列
  内读取本 key 当前值；成功时只删本 key 的项。覆盖两个独立 bus 实例共享存储、A 写
  engine 失败、B 成功写 focus、重启 A 后 engine 仍 pending 而 focus 不 pending。

## 测试

- `packages/db/src/test/queries.settings.test.ts`：
  - 空表；按 key 排序读取；
  - 同一 key 重复写只保留一行、更新 `updated_at`；
  - `onlyIfMissing` 不覆盖已有行；
  - 软删除行被读侧排除（直接写 `deleted_at`）；
  - `settingsWatchQuery` 编译并返回同样的行。
- `packages/db/src/test/schema-insertonly.test.ts`：表清单加 `settings`（15 张）。
- `server/app/test/upload.test.ts`：上传目录包含 `settings` 的列；仓库直贴版
  `server/deploy/worker.js` 含 settings 建表与上传列（产物漂移回归）。
- `apps/mobile/__tests__/synced-settings.test.tsx`：
  - DB 行应用到 focus/engine 模块（读取到同步值）；
  - 无行且本地有显式值时播种；无本地值时不写；
  - 正常启动先读默认值、再挂桥时不播种；新设备等账本偏好到达后应用；
  - 写失败后旧行重发仍保留用户值（pending 生效）；
  - 刷新后从设备存储恢复 pending，在应用旧行前保留用户值；
  - 用户保存 focus/engine/theme 后，writer 收到对应的 key 与 JSON 值；
  - 非法值被忽略。
- `apps/mobile/__tests__/synced-settings-bus.test.ts`：失败保留 pending、重试成功
  后清除、新保存取代旧失败意图；重启后恢复 pending，重试成功后再次重启为空；两个
  独立 bus 实例共享存储时，A 的 engine 失败意图不会被 B 成功提交的 focus 清除。
- `apps/mobile/__tests__/synced-settings-banner.test.tsx`：无失败不渲染；失败显示
  提示，重试成功后消失。
- `apps/mobile/__tests__/theme.test.tsx`：缓存的 `system` 默认值不算已存储偏好。

## 验证

- 门禁（最终代码）：`pnpm verify:web --no-serve` 通过，共 1665 个测试
  （core 275 / server 134 / db 376 / mobile 880），lint、typecheck、测试与 web
  构建全绿；日志 `gate-97-r3.log`。
- 浏览器实测（headless Chrome + 自建静态服务器，无截图）：
  - 主题：本机显式存 `dark`、DB 无行时，启动后写入 `theme-preference` 行；删除本机
    localStorage 键并刷新，页面仍为深色（值来自 DB 行，而不是本机缓存）。
  - 可用时间：在 Now 页点「15 分钟」写入 `engine-context` 行；删除本机键并刷新，
    15 分钟选项仍为选中态。
  - 专注时长：以 15 分钟预设开始一次专注后写入 `focus` 行（`{"lastMinutes":15}`）；
    结束后删除本机键并刷新，专注选择页的自定义时长输入框预填 15。
  - 跨标签页：标签页 B 把主题改为浅色，标签页 A 不刷新即切换为浅色（同一本地 DB
    的 watch 收到行变更）。
  - 写失败、刷新与恢复：拦截下一次 settings DML 并返回 Comlink THROW；点「30 分钟」
    后出现「设置未同步到账本」横幅，界面保留 30；随后一次成功的 focus 设置写入触发
    全表重发，旧 engine 行没有覆盖 30。
  - 多标签页持久化：标签页 B 在标签页 A 有失败 pending 时把主题改为深色（成功写入
    settings 表，A 的整表 watch 收到重发），A 不刷新即变深色；整页刷新后横幅仍在、
    30 仍保留；点「重试同步设置」后横幅消失，engine 行提交为 30；再次刷新后仍为 30
    且无横幅。结果见 `run-97-r3.log`：
    `{"ok":true,...,"writeFailure":{"failedWrites":1,"bannerVisible":true,"valueKept":true,"otherTabWrite":true,"survivedReload":true,"recovered":true,"persistedAfterReload":true}}`。
- 未验证：真实两台设备经服务器（PostgreSQL + PowerSync）同步；本次用同一浏览器的
  两个标签页（共享本地 DB 与 watch）模拟第二台设备。
- 未验证：原生端 SecureStore 与本地 SQLite 的组合（浏览器使用 localStorage +
  web worker）。
- 未验证：旧版本客户端遇到 additive `settings` 表的行为；本次只在当前构建上实测。

## 边界

- settings 表随所有同步表一起走单用户 `all` 流；多用户隔离仍是 post-MVP。
- 旧版本客户端不认识 `settings` 表：新表是 additive schema 变更，旧客户端忽略未知表；
  本次未在旧构建上实测。
- 通知、习惯提醒、更新偏好、日历目标继续本机存储，不进入 settings 表。
