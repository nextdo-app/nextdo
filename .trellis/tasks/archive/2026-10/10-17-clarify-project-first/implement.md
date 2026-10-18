# 执行计划：#44 澄清流程重排

> 复核门：本文件与 `prd.md` / `design.md` 经用户确认后才 `task.py start`，确认后再动代码。

## 步骤（按依赖顺序）

1. [x] **core：答复形状与决策表**
   - `packages/core/src/domain/clarify.ts`：`ClarifyAnswers` 换字段（`inProject` + `projectChoice`）、`classifyInboxItem` 新分支与严格校验（`clarify.project-required` / `clarify.incomplete`）。
   - 单测 `clarify.test.ts`：四组合 + 三种残缺抛错 + 常规链回归。
   - 门槛：`pnpm --filter @nextdo/core test`（241 通过）。
2. [x] **db：ReclarifyAnswers 对齐**
   - `packages/db/src/queries/inbox.ts`：类型与注释对齐；`applyClarify` / `reclarifyAction` 逻辑保持。
   - 测试：`queries.inbox.test.ts` 的 answers 工厂与全部用例改新答复对象。
   - 门槛：`pnpm --filter @nextdo/db test`（321 通过）。
3. [x] **mobile 状态机**：`lib/clarify-flow.ts`（QuestionId/TITLES/State/Action/reducer/buildFormSubmission/chains/PROGRESS_MAX）。
   - 门槛：`pnpm --filter @nextdo/mobile test clarify-flow`（72 通过）。
4. [x] **mobile UI**：`components/clarify-wizard.tsx` 三个新 case + 链更新 + q2c 空态；`hooks/use-option-keyboard-nav.ts` 高亮延后。
   - 门槛：`pnpm --filter @nextdo/mobile test clarify-wizard`（44 通过）+ 移动端全量 627 通过 + typecheck。
5. [x] **门禁**：root `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿。
6. [ ] **浏览器实测**：`node scripts/verify-web.mjs --port=4181 --skip-tests` → `.verify/clarify-project-first/capture.mjs`（截图 + `checks.json` + `evidence.md`，覆盖 AC-1/2/3；含「等权无高亮」与「不属于项目直达 q3」）。
7. [ ] **规范更新（Phase 3.3）**：`domain/domain-model.md`（问答顺序与答复字段）、`app/component-guidelines.md`（向导问答链 + 等权/不高亮约定）。
8. [ ] **Phase 3.4**：提交计划先发用户确认（按顺序 add + commit，不 amend、不 push），然后进入下一个子任务（#45）。

## 复核门（review gates）

- 每层改完先跑该层单测，最后跑 root 全量 ✓。
- 浏览器实测必须覆盖「默认无高亮」（AC-1）与「不属于项目直达」（AC-3）；outcome 断言不能只看截图。

## 回滚点

- 三层可独立 revert（core → db → mobile）；答复不落库，回滚不需要补偿脚本。
