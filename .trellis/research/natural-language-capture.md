# 自然语言快速捕获解析（issue #101）

状态：部分完成，2026-11-22。已交付日期/时间识别、捕获预览与 Clarify
预填；重复规则、项目/标签识别未实现，保留在 `.trellis/backlog.md`。

## 背景

- issue #101：捕获时识别日期、时间、重复规则、项目/标签；解析结果保存
  前可预览和修改；解析失败保留原文；优先本地解析。
- 实现前现状：快速捕获（弹窗与收件箱内联卡片）只保存标题，
  `inbox_items` 只有 `title` 与 `capturedAt`，没有结构化时间字段。
- 本增量只做「日期/时间 + 截止或日程」的解析与预览，不改数据库 schema。

## 决策与实现

### 解析器（`packages/core/src/capture/parse.ts`，纯函数）

- 本地解析，不联网。`parseCaptureSchedule(text, now)` 返回
  `CaptureSchedule | null`；无可用日期/时间时返回 `null`，原文不动。
- 识别规则：
  - 绝对日期：`2026-11-22`、`11/22`、`11月22日`；显式日期非法
    （如 `2月30日`、`2026-02-30`）时整体返回 `null`，不回退到今天；
  - 相对日期：`今天/明天/后天`、`N天后`、`下周/下下周`、`周三/星期三`；
  - 自然周语义：`下周三` 取下一个周一所在周的周三（周一得到 9 天后，
    周四得到 6 天后）；`下下周` 再顺延一周；`本周/这周` 取本周对应
    星期几，已过去也按本周；裸 `周三` 仍取下一次出现（含今天）；
  - 时段：`上午/下午/中午/晚上/凌晨`，以及合并词 `今晚/明早/明晚`；
  - 时间：`15:30`、`下午3点`、`3点半`、`3点30分`、`三点二十分`、
    `三点零五分`（含中文数字与中文分钟，含零前缀）；显式 24 小时值保持
    字面（`03:00` 是凌晨三点，`晚上20:00` 是 20:00），裸 `1点–6点` 仍按
    下午处理；
  - 非法时钟（`25点`、`99:99`）整体返回 `null`，不生成 23:59 替代日程；
  - 分类：有钟点、含 `开会/会议/见面/预约` 等日历词、且没有明确截止表达
    时判为日程（`calendar`）；其余判为截止（`deadline`）。明确截止表达
    指 `之前/以前/截至/截止`，或紧跟在时间之后的 `前`（排除 `前往`、
    `前端`、`前台`、`前方`，以及不作 `面试` 用的 `前面`）。只有日期
    没有钟点时一律截止（23:59）。
- 默认值：预览中切换为日程且没有钟点时按当天 09:00、时长 30 分钟
  （`CAPTURE_CALENDAR_MINUTES`）；截止无时刻按 23:59。23:59 在后续
  预填时折叠为「仅日期」，避免用户没选时刻却被赋予一个时刻。
- `captureScheduleFromParts(kind, date, time, matchedText)` 供预览的
  类型切换与时间修改复用，保证同一套默认值。
- `describeCaptureSchedule(schedule, now)` 生成预览标签：今天/明天/后天
  或「M月D日」，有时间时附 `HH:mm`。

### 预览与撤销

- `apps/mobile/hooks/use-capture-schedule.ts`：每次输入重新解析；显式
  修改或「撤销」以文本为键保存覆盖值（`override.text === text`），因此
  继续输入会恢复实时解析，不会冻结旧提示。捕获成功、关闭弹窗或清空
  草稿时重置覆盖值，所以下一次相同文本会重新解析。
- `apps/mobile/components/capture-schedule-preview.tsx`：Tag 显示识别
  结果，`截止/日程` 切换类型，`修改` 打开 `DateTimePicker`，`撤销` 丢弃
  解析。原文（输入框内容）在任何操作下都不变。
- 两个捕获入口都挂预览：快速捕获弹窗
  （`components/quick-capture-modal.tsx`）与收件箱内联卡片
  （`app/(tabs)/inbox.tsx`）。「记录」只用标题保存；「记录并澄清」还会
  把提示带到 Clarify。

### 传给 Clarify（不改 schema）

- `apps/mobile/lib/capture-link.ts` 的 `clarifyHrefWithSchedule` 生成
  `/clarify/<id>?deadline=&startsAt=&estMinutes=`；只输出 ISO 值。
- `apps/mobile/app/clarify/[inboxId].tsx` 读取路由参数，
  `clarifyPrefillFromParams`（`lib/clarify-flow.ts`）把 ISO 转成表单值，
  非法参数忽略；23:59 折叠为仅日期。
- `components/clarify-wizard.tsx` 的 prefill effect 按**字段**记录是否
  已应用（`deadline`、`startsAtDate`、`startsAtTime`、`estMinutes`），
  只在字段为空时填充，不替用户回答问题，也不覆盖已填内容。用户清空后
  即使来回切换表单也不会复活。
- 解析提示不持久化：收件箱条目仍只有原始标题；关闭 Clarify 后再次打开，
  提示不再出现（可重新从收件箱输入框解析，或手动选择）。

## 测试

- `packages/core/src/capture/parse.test.ts`：29 项，覆盖绝对/相对日期、
  自然周前缀（下/下下/本周）、ISO 与斜线日期、周几、时段、中文数字与
  中文分钟、默认时刻、显式 24 小时值、非法日期/时钟返回 `null`、
  截止表达优先（含 前往/前端/目前 反例与 前+面试 正例）与日历词判定。
- `apps/mobile/lib/capture-link.test.ts`：URL 参数生成、缺省 30 分钟、
  空提示不产生 query。
- `apps/mobile/lib/clarify-flow.test.ts`：`clarifyPrefillFromParams`
  的 ISO 转换、23:59 折叠、非法/越界参数忽略、数组参数取首个。
- `apps/mobile/__tests__/use-capture-schedule.test.ts`：解析、撤销、
  覆盖值按文本失效后恢复解析。
- `apps/mobile/__tests__/capture-schedule-preview.test.tsx`：标签渲染、
  类型切换、修改时间后回调、撤销。
- `apps/mobile/__tests__/quick-capture-modal.test.tsx`：预览出现、
  `onAdd`/`onCaptured`/`onCapturedAndClarify` 第二参数携带解析结果、
  撤销后按无提示保存、撤销不泄漏到下一次相同文本。
- `apps/mobile/__tests__/inbox-screen.test.tsx`：内联卡片识别「日程」，
  记录并澄清的路由参数含 `startsAt`/`estMinutes`。
- `apps/mobile/__tests__/clarify-wizard.test.tsx`：action 表单预填
  deadline、用户清除后不复活（含来回切换表单）、calendar 表单预填开始
  时间与时长。
- `apps/mobile/__tests__/clarify-route-prefill.test.tsx`：路由参数到
  `ClarifyPrefill` 的转换与非法参数降级。

## 历史与跨设备边界

- 解析只发生在输入当时；历史条目没有保存过的提示，不会回填。
- 设备时钟与本地时区决定相对日期和 ISO 值；跨设备同步的仍是纯标题，
  因此另一台设备看不到原设备生成的提示。
- 重复规则、项目/标签识别未实现；输入中的这些信息仍保留在标题原文中，
  不会丢失，但也不会自动结构化。

## 验证记录

- 门禁（2026-11-22）：`pnpm verify:web --no-serve` 全绿 — lint、
  typecheck、四个工作区测试（server 133、core 304、db 370、mobile 894，
  共 1701 项）与 web 构建均通过。日志：
  `/Users/printsdf/.claude/jobs/df844aba/tmp/verify-101-gate-final.log`。
- 浏览器实测（headless Chrome + CDP，静态产物端口 4197）：
  - 速记弹窗「明天03:00开会」→「明天 03:00」；
    「今晚9:30开会」→「今天 21:30」；
    「明天下午三点二十分开会」→「明天 15:20」。
  - 「2月30日下午3点开会」「明天25点开会」均无预览，原文保留。
  - 周日 now=2026-11-22 时「本周三交报告」→「11月18日」。
  - 「明天下午3点前提交会议纪要」显示截止预览「明天 15:00」；
    「明天下午3点前面试结束」也判为截止，而「明天下午3点开前端会议」
    「明天下午3点前往医院就诊」显示日程预览，截止没有被误判。
  - 「明天下午三点零五分开会」→「明天 15:05」。
  - 撤销 → 记录成功 → 再输入同一句，预览重新出现。
  - 「记录并澄清」跳到
    `/clarify/<id>?startsAt=2026-11-23T07:00:00.000Z&estMinutes=30`；
    calendar 表单显示 2026-11-23 / 15:00。
  - 证据：`/Users/printsdf/.claude/jobs/df844aba/tmp/browser-101c-evidence.json`、
    `browser-101d-evidence.json`、`browser-101e-evidence.json`；脚本：
    `browser-101.mjs`、`browser-101b.mjs`、`browser-101c.mjs`、
    `browser-101d.mjs`、`browser-101e.mjs`（同目录）。
