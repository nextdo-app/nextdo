# 现状调研：澄清向导的问答链与提交契约（2026-10-17）

基线 = worktree `feat/issues-44-45-46`（f398147）。所有行号都核对过。

## 1. 现行问答链（issue #44 的问题所在）

`apps/mobile/lib/clarify-flow.ts` 的状态机 + `packages/core/src/domain/clarify.ts` 的决策表：

```
q1  可以变成下一步行动吗？        [可以，是行动] [不行]
q2  需要多个步骤才能完成吗？      [是，拆成项目] [否，一步能完成]     ← issue 指出的「引导性提问」
q2b 它属于哪个项目？              [项目行(价值 n)] [新建项目] [不属于项目(仅单步分支)]
q3  大约 2 分钟内能完成吗？        [是，2 分钟内] [否]
q3b 现在就做掉吗？                [是，现在就做完] [否，记成行动]
q4  应该由你完成吗？              [是，我的事] [否，在等别人]
q5  必须在固定日期/时间执行吗？    [是，固定时间] [否，普通行动]
```

- 问题文案与 id：`clarify-flow.ts:32`（QuestionId）、`:191`（QUESTION_TITLES）、`components/clarify-wizard.tsx:771`（QuestionCard 的渲染）。
- 决策摘要卡片的两条链：`clarify-wizard.tsx:93-94`（`CLARIFY_CHAIN` 8 项 / `RECLARIFY_CHAIN` 6 项，从 q2 起）。
- 进度：`clarify-flow.ts:180`（`PROGRESS_MAX = {clarify: 7, reclarify: 6}`）。
- 再澄清（re-clarify）从 **q2** 重新进入（`createWizardState` `:240`；`app/reclarify/[id].tsx` 只传 kind）。

## 2. 提交契约（改了答复形状就必须同步的地方）

- core：`ClarifyAnswers`（`packages/core/src/domain/clarify.ts:14`，`multipleSteps` 在 :23）+ `classifyInboxItem`（:71）——`multipleSteps=true` → 需要 `projectOutcome` → outcome `project`；`projectId` 非空 → `next-action/project-attach`（**注意**：现行的判断顺序是 multipleSteps 先、projectId 次、twoMinutes 再往后）。
- db：`packages/db/src/queries/inbox.ts:203` 的 `ReclarifyAnswers`（q2 起的同一张表）；`applyClarify`（:348）在事务前校验 attach 项目（`loadAttachableProject` :88，必须 live + active）；`reclarifyAction`（:507）用 `classifyInboxItem({actionable:true, ...answers})` 重走决策表，`projectId` 三态（非空=挂接 / null=显式不挂 / undefined=保旧）。
- mobile：`buildFormSubmission`（`clarify-flow.ts:620`）产 answers；project form → `multipleSteps: true`；action form 带 `projectId`（clarify：有则带；re-clarify：`projectId ?? null`）；waiting / calendar 恒 `multipleSteps: false`。
- reducer：`clarify-flow.ts:298` 起（q2 的 `answer-q2` 把 `multipleSteps` 装进 `q2b` 步骤状态，UI 据此隐藏「不属于项目」）。

## 3. 相关测试面

| 文件 | 命中 | 说明 |
| :--- | ---: | :--- |
| `apps/mobile/lib/clarify-flow.test.ts` | 27 | reducer 全链路 + submission 形状（`multipleSteps` 断言密集） |
| `apps/mobile/__tests__/clarify-wizard.test.tsx` | 多处 | 点击序列（`是，拆成项目` / `不属于项目`）、ring 断言（:932） |
| `packages/core/src/domain/clarify.test.ts` | 整文件 | 决策表（`base` 答复对象 + 分支） |
| `packages/db/src/test/queries.inbox.test.ts` | 部分 | `answers()` 工厂 + attach / project / detach 事务 |
| `packages/db/src/test/queries.actions.test.ts` 等 | 少量 | 依赖 core 类型 |

## 4. 视觉权重

`components/clarify-wizard.tsx:708` 的 `Choices` 用**同一**组件渲染全部选项（`Button size="lg" variant="secondary"`，样式等权）。
唯一的「默认高亮」来自键盘导航：`hooks/use-option-keyboard-nav.ts`（web-only）在**进入每一步时把选中项重置为第 0 项并涂 ring**（`:67` 起，RING_CLASS 是 `!border-2 !border-accent`）——即第一个选项（现行是「是，拆成项目」）默认带一圈强调边框。issue #44 的「视觉上更突出 / 默认高亮」落在这一点上。

## 5. 新流程的映射（结果集合不变）

| 旧路径（答复） | 新路径（答复） | outcome |
| :--- | :--- | :--- |
| q2 是（多步骤）→ q2b 新建项目 | q2 属于项目 → q2b 新建项目 | `project`（项目 + 首个行动，原子） |
| q2 是/否 → q2b 挂到已有项目 | q2 属于项目 → q2b 添加到已有项目 → q2c 选项目 | `next-action/project-attach` |
| q2 否 → q2b 不属于项目 → q3… | q2 不属于项目 → q3… | 常规链（two-minute / waiting / calendar / next） |

唯一的信息损失：旧链路里「多步骤 + 不属于任何项目」会被强制新建项目或挂接；新链路允许「不属于项目」直接走常规链（issue 明确要求「为『不属于项目』的场景提供直接、清晰的创建路径」）。
