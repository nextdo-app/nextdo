# 技术设计：#44 澄清流程重排

## 1. 结论先行

只改「提问顺序 + 答复字段命名」，**决策结果集合、表单字段、数据库写入全部不变**：

- core 的 `ClarifyAnswers` 把 `multipleSteps: boolean` 换成 `inProject: boolean` + `projectChoice?: 'new' | 'existing'`；
- db 的 `ReclarifyAnswers` 同步换名（字段随答复走，不落库）；
- mobile 的向导加一步 `q2c`（选已有项目），q2/q2b 换文案与分支。

答复只存在于内存（提交后即留档为业务行），**无数据迁移**。

## 2. 新问答表

| id | 问题（标题） | 选项 → 去向 |
| :--- | :--- | :--- |
| q1 | 可以变成下一步行动吗？ | 可以，是行动 → **q2**；不行 → q1b |
| q1b | 那它更接近哪一类？ | 资料 / 有空再说 / 删除（表单，不变） |
| **q2** | **这件事属于某个项目吗？** | 属于某个项目 → **q2b**；不属于项目 → **q3** |
| **q2b** | **新建项目，还是加到已有项目？** | 新建项目 → 项目表单；添加到已有项目 → **q2c** |
| **q2c** | **加到哪个项目？** | 项目行（单选，带「当前」标记）→ 行动表单（挂接，价值默认跟随项目） |
| q3 | 大约 2 分钟内能完成吗？ | 是 → q3b；否 → q4（不变） |
| q3b | 现在就做掉吗？ | 是，现在就做完（do-now）；否，记成行动（两分钟表单）（不变） |
| q4 | 应该由你完成吗？ | 是 → q5；否 → 等待表单（不变） |
| q5 | 必须在固定日期/时间执行吗？ | 是 → 日历表单；否 → 行动表单（不变） |

链：`CLARIFY_CHAIN = [q1, q1b, q2, q2b, q2c, q3, q3b, q4, q5]`；`RECLARIFY_CHAIN = [q2, q2b, q2c, q3, q3b, q4, q5]`（再澄清仍从 q2 进入）。
`PROGRESS_MAX` 校准为 `{clarify: 6, reclarify: 5}`（最长链 = 不属于项目：clarify q1→q2→q3→q4→q5 + 表单；reclarify q2→q3→q4→q5 + 表单）。

## 3. core（`packages/core/src/domain/clarify.ts`）

```ts
export interface ClarifyAnswers {
  actionable: boolean;
  nonActionableKind?: 'reference' | 'someday' | 'trash';
  /** Q2：这件事属于某个项目吗？ */
  inProject: boolean;
  /** Q3（inProject 时）：新建项目还是加到已有项目？ */
  projectChoice?: 'new' | 'existing';
  /** projectChoice==='new' 时必填：项目 outcome。 */
  projectOutcome?: string;
  // twoMinutes / completedOnTheSpot / myResponsibility / fixedTime 不变
  /** projectChoice==='existing' 时必填：挂接的项目 id。 */
  projectId?: string | null;
}
```

`classifyInboxItem` 的分支顺序：

1. `!actionable` → reference / someday / trash（不变）；
2. `inProject === true`：
   - `projectChoice === 'existing'` → `projectId` 必须非空字符串，否则 `ValidationNextdoError('clarify.project-required')`；返回 `{kind:'next-action', source:'project-attach'}`；
   - `projectChoice === 'new'` → `projectOutcome` 非空（沿用 `project.needs-outcome`）→ `{kind:'project'}`（stray projectId 不覆盖新建选择）；
   - 两者都不是 → `clarify.incomplete`（不提供隐式分支）；
3. `inProject === false` → 常规链原样（`twoMinutes` → `myResponsibility` → `fixedTime`）；此分支下 stray `projectId` 被忽略（「不属于项目」= 不挂接）。

## 4. db（`packages/db/src/queries/inbox.ts`）

- `ReclarifyAnswers` 字段与 core 对齐：`inProject` / `projectChoice` / `projectOutcome?` / `projectId?`（三态语义保留：非空=挂接、`null`=显式解除、`undefined`=保持旧挂接，防御性）。
- `applyClarify` 与 `reclarifyAction` 的**判定逻辑不变**（都用 `classifyInboxItem` 得 outcome；`attachProject` 仍以 `outcome.source === 'project-attach'` + `projectId` 非空为条件）；`loadAttachableProject` 校验与错误码不变。

## 5. mobile

### `apps/mobile/lib/clarify-flow.ts`
- `QuestionId` 加 `'q2c'`；`QUESTION_TITLES` 三条改新文案（q2/q2b/q2c）。
- `WizardState`：`{step:'q2'} | {step:'q2b'} | {step:'q2c'}`（q2b 不再携带 multipleSteps）。
- `WizardAction`：`answer-q2 {inProject}` / `answer-q2b {choice:'new'|'existing'}` / `answer-q2c {projectId, projectValue, projectTitle}`。
- reducer：q2 → `inProject ? q2b : q3`；q2b → `new` 走 `toForm(..., 'project')`、`existing` → q2c；q2c → `toForm(..., 'action', attach)`。
- `buildFormSubmission`：project 表单 → `inProject:true, projectChoice:'new'`；action 表单 clarify → 有挂接 `inProject:true, projectChoice:'existing', projectId`、无挂接 `inProject:false`；re-clarify action → 无挂接 `inProject:false, projectId:null`；waiting / calendar / do-now → `inProject:false`。

### `apps/mobile/components/clarify-wizard.tsx`
- `QuestionCard` 新增 q2/q2b/q2c 三个 case（等权 `Button` / 项目行）；q2c 空项目列表时渲染说明（「还没有进行中的项目 —— 返回上一步选『新建项目』…」）并保留「← 上一步」。
- `CLARIFY_CHAIN` / `RECLARIFY_CHAIN` 加 `q2c`。

### `apps/mobile/hooks/use-option-keyboard-nav.ts`
- 新增 `keyboardEngaged`：`resetKey` 变化时归 false；首次方向键/Home/End 后归 true；`ringClass` 只在 engaged 时返回高亮类。Enter/Space 在未 engage 前不生效 —— 避免「看不见的选择被 Enter 确认」。
- 保留「进入步骤即把焦点拉到容器」（方向键即时可用）。

## 6. 验证

1. core 单测：四种 `inProject × projectChoice` 组合 + 缺字段的三种抛错 + 常规链回归。
2. db 单测：clarify 的 project / attach / detach / 常规链改用新答复对象；re-clarify 的 `projectId` 三态。
3. mobile 单测：reducer 新链路、submission 形状（含 re-clarify 的 `projectId: null`）、向导点击序列、ring 默认不出现（首次按键后出现、Enter 未 engage 不生效）、进度 1/6 与 6/6。
4. 浏览器实测：`.verify/clarify-project-first/capture.mjs`（`node scripts/verify-web.mjs --port=4181 --skip-tests` 起服务）覆盖 AC-1/2/3，产出截图 + `checks.json` + `evidence.md`。

## 7. 决策点（复核时可否决）

- **A. 「不属于项目」不再被强制归入项目**：旧链路里「多步骤 + 不属于任何项目」会被强制新建/挂接；新链路允许直接走常规链（issue 明确要求的直接路径）。
- **B. 键盘高亮改为「首次按键后出现」**：全向导共享行为（所有问题都变）；Enter 在未 engage 前不生效以免盲选。
- **C. 空项目列表不自动改问新建**：保持显式（空态说明 + 返回上一步）。
