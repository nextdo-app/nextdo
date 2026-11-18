# Design — 捕获后即时澄清 + 问题链内置项目归属

## 1. 新问题链（完整形态）

```text
Q1 可以行动吗？
├─ 否 → Q1b（reference / someday / trash）            [不变]
└─ 是
    ├─ Q2 需要多个步骤吗？
    │   ├─ 是 → 新建项目表单（项目+首个行动原子创建）  [不变]
    │   └─ 否
    │       └─ Q2b 它属于哪个项目？                    [新增]
    │           ├─ <active 项目列表> → 行动表单
    │           │    （projectId 固定；value 预填项目 value；无 Q3–Q5）
    │           ├─ 新建项目 → 新建项目表单             [同 Q2=是 的表单]
    │           └─ 不属于项目
    │               ├─ Q3 约 2 分钟？ → (Q3b)          [不变]
    │               └─ Q4 我的责任？ → Q5 固定时间？    [不变]
```

- re-clarify 从 Q2 重入 → 自动经过 Q2b；当前项目行标"当前"（可保持/改挂/解除）。
- 挂项目路径跳过 Q3–Q5 的依据见 PRD D3（`CalendarAction` 无 `projectId`，互斥）。

## 2. core（`packages/core/src/domain/clarify.ts`）

- `ClarifyAnswers` 新增 `projectId?: string`（注释：Q2b 挂到已有项目；非空字符串
  时优先于 Q3–Q5 分支）。
- `ClarifyOutcome` 新增变体 `{ kind: 'next-action'; source: 'project-attach' }`。
- `classifyInboxItem` 判定顺序（关键：**在 `multipleSteps` 之后、`twoMinutes` 之前**）：

  ```text
  !actionable → reference/someday/trash          [不变]
  multipleSteps → 'project'                      [不变]
  typeof projectId === 'string' && projectId !== '' → { next-action, project-attach }  [新]
  twoMinutes → do-now-completed | two-minute      [不变]
  !myResponsibility → waiting-for                 [不变]
  fixedTime → calendar-action | next-action       [不变]
  ```

- `projectId === null`（re-clarify 显式"不属于项目"）按"未挂接"处理，走常规链。
- 纯函数，无 IO；`clarify.test.ts` 补：挂接命中、优先级（projectId + twoMinutes
  → project-attach；multipleSteps + projectId → project）、null/undefined 回归。

## 3. db（`packages/db/src/queries/inbox.ts`）

- `ReclarifyAnswers` 新增 `projectId?: string | null`（null = 显式解除；undefined =
  未问（防御性，保留旧值））。
- 新共享 helper（同文件）：

  ```ts
  async function loadAttachableProject(db, projectId): Promise<Project>
  // 行不存在或 deleted_at ≠ null → StorageNextdoError('clarify.project-not-found')
  // status ≠ 'active'           → ValidationNextdoError('clarify.project-not-active')
  ```

- `applyClarify` 的 `case 'next-action'`：`source === 'project-attach'` 时
  `loadAttachableProject` 后
  `buildNextAction(now, { ...base, projectId: project.id, keptValue: project.value }, target)`
  （`buildNextAction` 的 value 链 `target.value ?? keptValue ?? 3` 自动实现
  "表单值优先、缺省继承项目价值"）；其余 source 不变。
- `reclarifyAction` 的 `case 'next-action'`：

  ```text
  answers.projectId 为非空 string → loadAttachableProject →
      base = { ...replacementBase, projectId, keptValue: project.value }
  answers.projectId === null     → base = replacementBase（projectId 保持 undefined = 解除）
  answers.projectId === undefined（防御）→ 保留旧行 project_id
  ```

  旧行动行软删逻辑不变（替换行带 `replacesActionId`）。
- 所有校验在事务**之前**或事务内首个语句执行，失败即抛错回滚，无脏写。
- 测试（`packages/db/src/test/queries.inbox.test.ts`）：挂接成功（projectId/
  sourceInboxId/value 继承与覆盖）、project-not-found、project-not-active、
  re-clarify 改挂/解除/保持、原有分支回归。

## 4. app 纯状态机（`apps/mobile/lib/clarify-flow.ts`）

- `WizardState` 步骤联合新增 `{ step: 'q2b' }`；`'form'` 步骤新增
  `projectId?: string; projectTitle?: string`（仅 action 表单挂接路径携带）。
- `WizardAction` 新增：

  ```ts
  | { type: 'answer-q2b'; choice: 'none' }
  | { type: 'answer-q2b'; choice: 'new-project' }
  | { type: 'answer-q2b'; choice: 'attach'; projectId: string; projectValue: Value; projectTitle: string }
  ```

  （数据走 action payload，reducer 保持纯。）
- `clarifyReducer`：
  - `q2` + `answer-q2(false)` → `q2b`（原来是直接 `q3`）；
  - `q2b`：none → `q3`；new-project → `toForm('project')`；
    attach → `toForm('action', …)` 且 `fields.value = projectValue`、
    form 携带 `projectId/projectTitle`；
  - re-clarify 入口仍是 `q2`（`createWizardState` 不变）。
- `buildFormSubmission`（action 表单）：
  - 携带 `projectId` → `answers.projectId = projectId`（clarify 与 reclarify 同）；
  - reclarify 且无 `projectId` → `answers.projectId = null`（显式解除）；
  - clarify 且无 `projectId` → 不带该字段（undefined，走 Q3–Q5 语义）。
- `FormFields`/`emptyFields` 不变（value 预填经 `toForm` 特例设置）。
- `lib/clarify-flow.test.ts` 补：q2b 三向转移、attach 表单 value 预填、
  三种 submission 的 projectId 语义（string / null / undefined）。

## 5. app 组件（`apps/mobile/components/clarify-wizard.tsx`）

- `WizardBody` 用 `useProjects()` 取项目列表，渲染时过滤 `status === 'active'`
  （hook-guidelines：数据经 hook，组件不碰 SQL）。
- 新 `QuestionCard` 分支 `q2b`：标题"它属于哪个项目？"；每个 active 项目一行
  Pressable（"项目名（价值 N）"，re-clarify 且为当前项目加"当前"标记）；底部
  两按钮"新建项目"（secondary）/"不属于项目"（secondary）。项目为空 → 只有两按钮。
- 行动表单（`FormCard` form='action'）：携带 `projectId` 时顶部展示只读行
  "所属项目：X"（不可在表单内改挂——改挂走 Q2b 返回）。
- re-clarify 当前项目：`use-action-title.ts` 扩展为同时返回 `projectId`
  （已查询同一行，零额外成本；保持 hook 单查询职责）。
- **完成步改造（R1）**：删除 1.5s 自动 `router.back()` 计时器，改为两个显式按钮：
  - "完成" → `router.back()`；
  - "再记一条" → `router.navigate('/(tabs)/inbox', { recapture: '1' })`。
  两种 mode（clarify / reclarify）同构。

## 6. app 捕获交接（R1）

- `hooks/use-add-inbox-item.ts`：`add` 返回 `Promise<InboxItem | null>`
  （成功返回含 `id` 的条目，失败 null；`error` 字段语义不变）。
- `components/quick-capture-modal.tsx`：
  - `onAdd` prop 类型改 `Promise<InboxItem | null>`；
  - 新增 prop `onCaptured?: (item: InboxItem) => void`：保存成功后重置
    draft/savedCount 并回调（交接给父级导航）；
  - "稍后再说/完成"关闭行为不变。
- `app/(tabs)/inbox.tsx`：
  - 弹窗 `onCaptured` 与内联条 `capture()` 成功后统一：
    `setShowQuickCapture(false); router.push(\`/clarify/${item.id}\`)`；
  - 读路由参数 `recapture`：为 `'1'` 时 `setShowQuickCapture(true)` 并
    `router.setParams({ recapture: undefined })`（useEffect 一次性消费）；
  - InboxRow 点行进向导的入口保留。
- 导航语义：向导是 push 出来的，"完成"回到来源界面（收件箱 tab 或 Now）；
  "再记一条"用 `navigate` 回到收件箱 tab 并开弹窗（Expo Router tab 参数惯用法）。

## 7. 错误文案（`apps/mobile/lib/error-messages.ts`）

新增映射：

| code | 中文 |
|---|---|
| `clarify.project-not-found` | 这个项目不存在了 |
| `clarify.project-not-active` | 这个项目当前不是进行中状态，无法挂接 |

## 8. 兼容与回滚

- 全部为**增量**：core 新 outcome 变体（穷举 switch 处补 `never` 检查）、
  db 新 case 分支、向导新步骤。无 schema 变更（`project_id` 列已存在）、
  无同步层变更、无引擎变更。
- 旧客户端写入的数据不受影响（`projectId` 列本就是可空）。
- 回滚 = 分支回退，无数据迁移。

## 9. 风险

- **穷举 switch**：`ClarifyOutcome` 加变体后，`apps/mobile/lib/clarify-flow.ts`
  `outcomeLabel` 与 db 两个 switch 必须同步补分支（typecheck 会强制）。
- **re-clarify 的 null/undefined 区分**（§3）是本次最易错的语义点，测试必须覆盖
  三态。
- **快速捕获弹窗与内联条同时存在**：两条捕获路径的交接逻辑必须走同一处理
  （inbox.tsx 内一个 `handoffToClarify(item)`），避免行为分叉。
- `router.navigate('/(tabs)/inbox', …)` 的路由串与参数清理：web 与 iOS 均需手测
  （web 为 `expo export --platform web` 同一套代码）。
