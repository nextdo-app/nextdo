# 数据同步：触发时机、频率与失败处理

本文描述 Nextdo **实际**的同步行为，不是理想设计。每一节都标注了代码出处；如果代码变了，先改这里。

一句话结论：**同步是本地优先架构下的一根后台管道，连接期间一直在跑；没有"定时同步"这个概念，但设置页提供「立即同步」用于手动重连并冲刷上传队列，并显示上次同步时间。**

## 1. 什么时候开始同步

应用启动时（`apps/mobile/app/_layout.tsx` 的 `setSyncFromAuth`）读取两样本地保存的东西：

| 条件 | 结果 |
| --- | --- |
| 连接密钥（owner token）**和**后端地址都在 | 调用 `powersync.connect()`，同步管道开始运行 |
| 任意一样缺失 | 调用 `powersync.disconnect()`，应用仍然完全可用，只是数据留在本机 |

应用层只在**启动**和**登录 / 登出**（owner token 变化）时重新评估连接
（`apps/mobile/app/_layout.tsx:89-128` 的 `setSyncFromAuth`，
`:147-152` 的 `subscribeToOwnerTokenChange`）。连接建立后，网络中断的
重连由 PowerSync SDK 内部按退避策略处理，不是应用层在反复调用
`connect()`。用户点「立即同步」会主动重新 `connect()` 一次（见第 4 节）。

> 出处：`apps/mobile/app/_layout.tsx:89-128`（连接 / 断开决策）、
> `apps/mobile/app/_layout.tsx:147-152`（启动与 token 变化订阅）

## 2. 同步什么时候被触发

**没有定时任务，也没有"每 N 分钟跑一次"的批处理。** 连接期间，SDK 一直运行一个同步循环：

- **上传方向**：本机任何一次写入（新建 / 修改 / 删除项目、行动、习惯、日志…）落到本地 SQLite 的
  CRUD 队列后，SDK 就调用 `uploadData()` 把队列里的一批操作发到服务器。一次调用只处理一个
  CRUD 事务，拿到 2xx 才把这一批标记为完成。
- **下载方向**：客户端订阅的同步流保持长连接，别的设备产生的增量由服务端推送过来。

> 出处：`packages/db/src/powersync.ts:19-24`（`uploadData` 由 SDK 在循环中调用，
> 永远不要直接调用它）、`packages/db/src/powersync.ts:334`（连接器的上传实现）

## 3. 同步频率可以配置吗

**不可以。** 应用没有暴露任何同步间隔、定时器或节流开关；`connect()` 也没有传入任何自定义的
同步选项，完全使用 PowerSync SDK 的默认行为。

用户唯一能配置的是**服务器地址和连接凭据**（设置页 → 云同步）。

> 出处：`apps/mobile/app/_layout.tsx:121`（`connect(connector)` 无第二个参数）

## 4. 有没有手动触发同步

**有「立即同步」按钮**，位于设置页云同步卡片（`apps/mobile/app/(tabs)/settings.tsx:1248-1255`）。
PowerSync 没有真正的 "sync now" API，同步是长连接，所以按钮做的是**重新 `connect()`
并冲刷上传队列**：`syncNow()` 读取 owner token 与后端地址，再次调用
`powersync.connect(createPowerSyncConnector(config))`，然后等待状态回到
「已连接且没有下载/上传中」。等待上限 8 秒，超时或未连接会显示失败原因
（`apps/mobile/hooks/use-sync-status.ts:109-166`）。

按钮在同步中显示「正在同步…」并禁用；成功后显示「✓ 同步完成」。卡片还会显示
「上次同步时间：…」，数据来自 PowerSync `useStatus().lastSyncedAt`，从未完成过
同步时显示「尚未完成过同步」（`apps/mobile/app/(tabs)/settings.tsx:1243-1246`）。

设置页里其余可点操作属于**连接管理**，不是同步触发器：

- **断开连接** — 清除密钥，服务器地址保留
- **复制连接串 / 扫码配对** — 把同一套地址与密钥交给另一台设备
- **清除警告** — 清掉"操作被服务端拒绝"的提示

> 出处：`apps/mobile/app/(tabs)/settings.tsx:1224-1256`（同步卡片）、
> `apps/mobile/hooks/use-sync-status.ts:109-166`（立即同步实现）

## 5. 失败之后会怎样

| 情况 | 处理 | 用户能看到什么 |
| --- | --- | --- |
| 断网 / DNS / 连接失败 | 连接器抛错，SDK 按退避（backoff）自动重试；上传队列阻塞，**数据不丢** | 卡片显示「同步失败：…」+ 失败原因（`deriveSyncDisplay` 优先显示 `downloadError` / `uploadError`） |
| 服务器返回 5xx | 同上——瞬时故障会自愈，重试后继续上传 | 同上 |
| 数据本身不合法（校验级拒绝） | 服务端**仍返回 2xx**，但把该操作记为"被拒绝"并写进同步表 | 设置页云同步卡片显示「⚠️ 发现 N 条操作被服务端拒绝同步」+ 最近一条的代码与原因，可「清除警告」 |
| 未连接 / 已登出 | 不同步，数据留在本地；重新连接后由队列补传 | 未配置时显示「未连接 — 数据仅保存在这台设备上」；已配置但连接断开时显示「未连接 — 正在重试连接同步服务器」 |

> 出处：`packages/db/src/powersync.ts:22-26`（2xx-on-rejection 协议）、
> `packages/db/src/powersync.ts:316`（网络失败由 SDK 退避重试）、
> `packages/db/src/powersync.ts:371`（非 2xx 抛出，阻塞队列等待 SDK 重试）、
> `server/app/src/upload.ts:71`（不合法的数据不会自愈，所以拦截并记账）

## 6. 已知的不透明之处

**上次同步时间和待上传数量已经展示**（设置页 `lastSyncedAt` 与
「有 N 条改动待上传」），但同步的实时进度——正在上传哪一批、剩余多少
字节——没有界面；卡片只显示「已连接 / 同步中 / 待上传 / 同步失败」这类
派生状态。`lastSyncedAt` 在 PowerSync 服务重启后会重置，所以从未完成过
同步时卡片显示「尚未完成过同步」，而不是猜测一个时间。

如果以后要加更细的同步进度，入口仍在设置页的云同步卡片
（`settings.tsx:1224-1256`）。
