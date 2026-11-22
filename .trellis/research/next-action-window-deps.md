# NextAction 时间窗口与依赖字段的输入入口（issue #98）

状态：已实现，2026-11-20。验证记录见下文。

## 背景

- `next_actions` 已有 `window_start` / `window_end` / `window_days` /
  `depends_on_id`，引擎的硬过滤也读取这些字段；缺口只在界面。
- issue 允许「澄清向导或行动编辑」二选一。本次选择**行动编辑弹窗**：
  Now 屏的主行动与备选行都能打开它，改动集中、回归面小；澄清向导保持不变。

## 决策与实现

### 编辑弹窗（`apps/mobile/components/edit-action-modal.tsx`）

- **适用日**：周一至周日芯片，默认全选（= `windowDays: undefined`，每天）。
  取消某天即写入掩码；至少保留一天，否则禁用保存并提示。
- **时间段**：可选开关；开启后用两个 `HH:mm` 选择器。开始必须早于结束，
  否则禁用保存并提示。关闭时写入 `undefined` 清除起止时间。
- **前置行动**：单选芯片「无依赖」+ 可选行动。只提供：
  - 未删除的行动（`listNextActions` 默认排除软删除）；
  - 排除被编辑行动自身；
  - 排除已直接或间接依赖被编辑行动的行动（避免成环，成环会让两条都永久
    被过滤）。
  - 已完成的依赖仍显示并可选（引擎把「依赖已完成」视为满足）；若当前依赖
    不在候选列表中（已完成的日历/习惯或已删除），界面提示「保持不变」，
    只有选「无依赖」才显式清除。
  - 候选读取失败时显示错误提示；保存时省略该字段，原依赖不变。
- **字段所有权**：只有用户实际改过的窗口/依赖字段进入 patch。未改动的键
  不发送，由写事务保留当前行值；这样旧快照或读取失败不会撤销另一处的写入。
- **单边窗口**：未改动的时间段不校验完整性，只有单边 `windowStart` 或
  `windowEnd` 的行动仍可只改标题；一旦修改时间段，仍要求完整起止且开始
  早于结束。
- 原有 Hooks 顺序问题：`useAppInsets` 曾在 `!visible || action === null`
  的提前返回之后调用，弹窗隐藏→显示会触发 React 警告。已移到提前返回之前。

### 数据层（`packages/db/src/queries/actions.ts`）

- `updateNextAction` 新增 `windowFields` 参数：只覆盖调用方显式拥有的键。
  未提供的键保留事务内读到的当前值；显式 `undefined` 仍写 NULL 清空。
  项目页表单不编辑这四项，因此旧快照只改标题时不会撤销另一处刚设置的
  窗口/依赖。
- 此前该函数只合并 title / est / value / deadline / note，编辑窗口或依赖
  会被静默丢弃；行映射（`nextActionToRow`）原本已覆盖这些列。
- `apps/mobile/hooks/use-update-next-action.ts` 按 patch 中实际存在的键
  生成 `windowFields`；项目页的 title-only 保存传空对象。
- 依赖成环：写事务内从新依赖沿 `dependsOnId` 链回溯；遇到被编辑行动自身
  或重复 id 时抛 `action.dependency-cycle`。两个已打开的编辑器各选对方时，
  后保存的一次得到可修正的错误，而不是两条都永久被过滤。
- 写事务对最终合并行执行 `assertValidNextAction`；第 4 参传入的窗口值同样
  受 `HH:mm` 校验，非法值不会落库。
- 错误展示：`use-update-next-action` 在 catch 中调用 `errorMessage(err)`，
  保留 `action.dependency-cycle` 等错误码对应的中文文案；弹窗保持打开，
  换一个前置后可重试。

### 被过滤行动仍可编辑（`apps/mobile/app/(tabs)/now.tsx`）

- 时间窗口或未完成依赖会把行动移出执行池；若它不挂在项目上，Now 是唯一
  编辑入口。为此：
  - 被过滤说明从「全部被过滤」的空态扩展为独立区块：只要存在被过滤项就
    显示（有可执行行动时也显示）。
  - `window-mismatch` 与 `dependency` 的 NextAction 行可点，直接打开编辑
    弹窗；其余规则、习惯与日历行只显示说明。

## 验收对应

- 设置窗口后，窗口外不推荐：浏览器中取消今天后，或设置当前时间在外的
  07:30–08:30 时间段后，行动进入「不在时间窗口内」。
- 设置依赖后，依赖未完成不推荐；依赖完成后仍需通过其他过滤：浏览器中
  依赖 B 时 A 被过滤，完成 B 后 A 回到可执行池。
- 编辑清空字段恢复无窗口/无依赖：补回全部适用日并选「无依赖」后 A 恢复；
  单测覆盖清空后的 `undefined` 补丁与数据库 NULL。

## 测试

- `packages/db/src/test/queries.actions.test.ts`：写窗口/依赖后读回一致；
  以显式 `undefined` 重写后四列为 NULL；项目页旧快照只改标题时，另一处
  写入的窗口/依赖保持；两节点、自身与三节点链的成环写入均被拒绝且不落库；
  第 4 参的非法 `HH:mm` 被拒绝且原行不变。
- `apps/mobile/__tests__/projects-screen.test.tsx`：项目页 title-only 保存
  传给数据层的 window 字段为空对象，证明 hook 没有转发未拥有的键。
- `apps/mobile/__tests__/now-screen.test.tsx`：
  - 弹窗选 09:00–10:00、选前置行动，保存的 patch 带正确值且不写 7 天掩码；
  - 有可选行动时，被依赖过滤的行动仍出现在「被过滤的事项」并可打开编辑；
  - 打开被过滤行动的编辑，关闭时间段、选「无依赖」、补回今天，保存后四个
    字段均为 `undefined`；
  - 依赖候选不包含自身与已依赖自身的行动；
  - 候选读取失败时只改标题，第 4 参不含 `dependsOnId`；
  - 候选列表外的日历/习惯依赖在未改动时省略，选「无依赖」才显式清除；
  - 单边时间窗口未改动时可只改标题，修改时间段后恢复完整性校验；
  - 成环错误经真实 hook 显示中文文案，弹窗保持，换前置后重试成功。

## 验证记录（2026-11-20）

- 门禁：`pnpm verify:web --no-serve` 退出码 0；lint、typecheck、测试与 web 构建
  全绿，共 1652 个测试（core 275 / server 133 / db 374 / mobile 870）；日志
  `gate-98-r4.log`。本工作树从 `main` 分出，未包含 #94–#97 的未合入改动。
- 浏览器实测（headless Chrome + 自建静态服务器，无截图）：
  1. 通过收件箱澄清创建两条下一步行动。
  2. 取消今天后，A 被过滤为「不在时间窗口内」，空态列表提供「编辑」入口。
  3. 创建 B 后（B 可执行），被过滤区块仍显示，A 仍可编辑。
  4. 补回全部适用日并把 B 设为前置：A 被过滤为「依赖的行动未完成」。
  4b. 注入一次候选读取拒绝：弹窗显示「无法读取可依赖的行动，现有依赖
     保持不变。」；直接保存（依赖未改动，patch 省略该键）后 A 仍被依赖
     过滤，证明原依赖未被清空。
  5. 清除依赖：B 尚未完成时 A 立即回到可执行池。
  5b. 时间段控件：开始 10:30 / 结束 09:00 时提示「开始早于结束」且保存
     不关闭弹窗；取消全部适用日时提示「至少选择一天。」且保存不关闭；
     设置一个当前时间在外的 preset 窗口（本次 21:00–22:30）保存后 A 被
     过滤；重新打开回填起止时间，刷新后窗口与过滤仍在；关闭时间段保存后
     A 恢复。
  6. 重新设置依赖并完成 B：A 回到可执行池。
  7. 注入一次 `update next_actions` 拒绝：弹窗保留、输入值保留、错误可见；
     重试成功后关闭，刷新后新标题仍在。
  8. 页面控制台无 React Hooks 顺序警告。
  结果见 `run-98-r4.log`：
  `{"ok":true,"window":{...,"editableWhileOtherEligible":true,"clearedDays":true},"dependency":{...,"clearedRestores":true,"completedPrerequisiteRestores":true},"failure":{"hits":1,"modalKept":true,"titleKept":"整理测试报告（失败）","persistedAfterReload":true},"optionsReadFailure":{"hits":1,"errorShown":true,"dependencyKept":true},"timeWindow":{"start":"21:00","end":"22:30","invalidRangeBlocked":true,"emptyDaysBlocked":true,"hiddenOutside":true,"refilled":true,"persistedAfterReload":true,"clearedRestores":true},"hooksWarnings":0}`。

## 边界

- 澄清向导未增加这两个字段；issue 允许「或」，本次只落在编辑入口。项目详情
  的内联编辑表单也未加字段，但同一行动可从 Now 的菜单/被过滤列表编辑。
- 引擎的窗口与依赖语义未改；依赖仍是最多一个直接前置，没有多级依赖编辑界面。
- 窗口时间按设备本地时区解释，与既有习惯窗口一致。
- 未验证：真实跨设备同步后的窗口/依赖值（同 issue #97 的边界）。
- 未验证：项目页与 Now 双标签页的浏览器级旧快照复现；同一事务语义由
  `packages/db` 回归测试覆盖（旧快照 title-only 保存保留窗口/依赖）。
- 未验证：两个已打开编辑器的浏览器级成环复现；同一写事务语义由 db 回归
  覆盖（后保存的成环写入被拒绝）。
