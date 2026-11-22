# 外部日历：只读导入忙碌时间（issue #100）

状态：部分完成，2026-11-21。已交付系统日历只读导入；CalDAV、
双向同步与冲突确认流程未实现，保留在 `.trellis/backlog.md`。

## 背景

- issue #100：外部日历导入与双向互通。期望「支持从系统日历或 CalDAV
  读取忙碌时间，作为引擎的硬日程约束」，并「先做只读导入，再做双向」。
- 现状（实现前）：应用只会把日历行动、提醒与专注记录单向写入系统日历
  （issue #54/#63），引擎的 `calendar` 只包含打开状态的 CalendarAction
  自身时间块，外部日程完全不可见。
- 引擎规范把「manual time blocks + system-calendar import」标为 post-MVP；
  本任务先落地其中的系统日历只读导入。

## 决策与实现

### 读取（`apps/mobile/lib/calendar-sync/device.ts`、`index.ts`）

- 原生（iOS/Android）用 expo-calendar 的 `getCalendars()` +
  `calendar.listEvents(start, end)` 读取所有日历的重叠事件；只把普通数据
  （`ImportableCalendarEvent`）传出设备层，原生对象不进入纯逻辑。
- 读取窗口：`now − 24h` 到 `now + 7d`。向前覆盖进行中的长会议；向后覆盖
  今日与即将开始的 CalendarAction。
- macOS 桌面桥（Tauri/EventKit）只有写入命令，没有读取命令；Web 没有日历。
  两类平台返回 `null`，导入静默降级为「没有外部约束」。设置页另用
  `isCalendarImportSupported()`（仅 native 为 true）控制入口：桌面只显示
  「可以写入系统日历，但暂不支持读取外部日程」，不渲染开关（review R1）。
- 读取失败直接抛出（不做「空数组」降级）：调用方保留上一次成功快照，
  避免一次读失败被误当成「今天没有会议」。

### 哪些事件算忙碌（`apps/mobile/lib/calendar-sync/import.ts`，纯函数）

- 只取定时事件；**跳过全天事件**——生日/节假日/全天会议会把整天都判成
  忙碌，从而过滤掉当天所有固定时间行动。
- 跳过 `availability === 'free'` 与 `status === 'canceled'`。
- 跳过 Nextdo 自己写入的镜像事件，否则 CalendarAction 会与自己的日历事件
  冲突：
  - 本地保存的三类映射（行动 / 提醒 / 专注）里的 event id；
  - 每次写入都追加的来源标记 `由 Nextdo 自动同步`
    （`reconcile.ts` 的 `NEXTDO_EVENT_NOTE` / `nextdoEventNotes`）。用户备注
    保留在标记之前，导入按 `notes.includes(...)` 判断，因此另一台设备没有
    本地映射也能识别镜像（review R2）。
  - 签名包含标记：升级前的旧事件在下一次同步时会被更新一次，补上标记。
- 跳过时间戳不可用或结束不晚于开始的事件；输出按开始时间排序，保证引擎
  输入确定。

### 引擎接入（`apps/mobile/hooks/use-now.ts`）

- 外部忙碌块与 `queryEnginePool` 返回的 CalendarAction 时间块合并后交给
  `recommend()`；池查询本身保持「只读本地数据库」，不把设备日历塞进
  `packages/db`。
- 引擎现有 `calendar-conflict` 规则因此覆盖外部日程：与外部忙碌块重叠的
  CalendarAction 候选不进入推荐。NextAction / Habit 没有固定开始时间，
  引擎不对它们做时间冲突判断，行为不变。

### 开关、刷新与失败提示

- 开关 `calendarImportEnabled` 放在设备本地的通知设置存储
  （`lib/notification-settings.ts`，与「写入系统日历」同一处），默认关闭；
  开启时复用 `requestCalendarPermission()` 的授权弹窗。该设置不进入同步面
  （issue #97 也明确通知设置是设备本地偏好）。
- 刷新时机（`hooks/use-external-calendar-blocks.ts`）：
  - 挂载时与开关打开时；
  - 每 5 分钟（Now 屏挂载期间）；
  - 应用回到前台（用户可能刚在别的 App 改了日历）。
- 失败：保留上一次成功的忙碌块，`Now` 屏显示「系统日历读取失败，暂未更新
  忙碌时间」；成功刷新后清除提示。快照只放内存——重启后重新读取，避免磁盘
  上的旧日程在时区/日期变化后继续生效。
- 设置页日历区新增「导入系统日历忙碌时间」开关；入口只在该平台具备读取
  能力时显示（`isCalendarImportSupported()`，review R1）；权限被拒时给出
  说明。

## 验收对应

- 导入的日程阻止冲突推荐：外部忙碌块进入引擎 `calendar`，与 CalendarAction
  重叠即 `calendar-conflict`（`useNow` 集成测试 + 引擎既有规则测试）。
- 外部日程变更后约束更新：5 分钟轮询 + 回前台刷新 + 开关切换即时重读。
- 同步失败保留本地数据并提示：读取失败保留上次快照并显示中文提示；本地
  行动数据本就在 PowerSync 中，不受导入影响。

## 测试

- `lib/calendar-sync/import.test.ts`：定时忙碌事件映射；tentative /
  unavailable / 无 availability 都算忙碌；跳过全天、free、canceled、
  Nextdo 自身事件（按 id、纯标记备注、以及「用户备注 + 标记」）；非法时间
  与倒序时间；排序；窗口常量。
- `lib/calendar-sync/mirror-import.test.ts`：真实
  `buildCalendarSyncPlan → device.createCalendarEvent → busyBlocksFromEvents →
  recommend` 链路 —— 设备 A 导出带用户备注的事件，设备 B 无本地映射时仍不
  把它当外部忙碌，同一 CalendarAction 可被推荐（review R2 回归）。
- `lib/calendar-sync/reconcile.test.ts`：旧签名（无标记）的映射会被安排一次
  更新，使事件补上来源标记。
- `lib/calendar-sync/device.test.ts`：创建事件时写入「用户备注 + 标记」；
  多日历事件合并与字段归一化（Date 与字符串日期）；读取失败向上抛出。
- `lib/calendar-sync/desktop.test.ts`：桌面后端可写但不可读 ——
  `isCalendarImportSupported()` 为 false、`listEventsForImport()` 为 null；
  IPC 备注参数为「用户备注 + 标记」。
- `__tests__/external-calendar-blocks.test.tsx`：开关关闭不读日历；开启后
  生成忙碌块；按映射排除自身事件；刷新失败保留旧块并显示中文提示；关闭
  开关清空；无读取能力的平台不报错；挂载读取晚于开关事件时不回退状态。
- `__tests__/now-external-calendar.test.tsx`：真实 `recommend()` 下，外部
  忙碌事件把重叠的 CalendarAction 过滤为 `calendar-conflict`；开关关闭时
  同一行动仍可被推荐。
- `__tests__/settings-screen.test.tsx`：支持写入但不支持读取的主机不渲染
  导入开关并给出说明；支持读取时渲染开关（review R1 回归）。
- `lib/notification-settings.test.ts`：新字段默认关闭、解析与部分保存不丢失。

## 验证记录

- 门禁 r3（review R1/R2 修正后的最终代码，2026-11-21）：
  `pnpm verify:web --no-serve` 退出码 0，1668 项测试全部通过
  （core 275 / server 133 / db 370 / mobile 890），web 构建与 PWA 后处理完成。
- 浏览器冒烟 r3（headless Chrome + 静态服务器，1280×960）：
  - Web 平台：Now 屏正常渲染（空池态「执行池是空的」），没有出现「系统日历
    读取失败」提示；设置页「声音与日历」正常渲染，显示「当前平台不支持系统
    日历」，不渲染导入开关；刷新页面后应用正常。
  - 模拟 macOS Tauri 壳（注入 `calendar_supported=true` 与已授权）：设置页
    显示「写入系统日历」，同时显示「当前平台可以写入系统日历，但暂不支持读取
    外部日程。」，不渲染导入开关（review R1 的平台边界）。
  - 控制台没有与新代码相关的错误。
- 未验证：真实 iOS / Android 设备上的系统日历读取、权限弹窗与刷新时机 —
  没有可用真机；设备层与 hook 由 mock 测试覆盖。

## 未完成

- CalDAV / Google Calendar / Apple Calendar 账号级导入：需要网络、凭证与
  服务器或设备端的协议实现，本任务只做系统日历（系统账号已由 OS 同步）。
- 双向同步：应用内日程写回外部日历、外部修改回写应用、冲突规则与用户确认
  流程均未实现。当前写入仍是 issue #54 的单向镜像。
- 选择导入哪些日历：当前读取所有日历的非空闲定时事件；按日历/账号筛选
  未做。
- 跟踪项：`.trellis/backlog.md`「外部日历双向同步与 CalDAV」。

## 边界

- 未在真实 iOS / Android 设备上验证系统日历读取、权限弹窗与刷新时机；
  设备层与 hook 由 mock 测试覆盖。
- 跨设备镜像事件：新写入的事件都带来源标记，导入在没有本地映射时也能识别
  （review R2）。升级前写入、且用户备注覆盖了默认描述的事件没有标记：下一次
  日历同步会因签名变化更新一次并补上；若同步从未运行（开关关闭），这类历史
  事件仍可能被另一台设备当作外部忙碌。
- 全天事件不阻塞推荐；用户若把全天日程当作真实占用，当前不会生效。
- 外部忙碌块只影响 CalendarAction 候选（引擎的固定时间候选）；NextAction
  与 Habit 没有时间落点，不做「现在是否忙碌」过滤。
