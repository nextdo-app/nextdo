# Implement plan — Habit start date picker (issue #13)

## 顺序

1. **`packages/core`** — 新增 `src/domain/habit-start.ts`（纯校验）+ 同目录 `habit-start.test.ts`；从 `src/index.ts` 导出。
   - 校验：`pnpm --filter @nextdo/core test`
2. **`packages/db`** — `src/queries/habits.ts`：`seedTodayHabitDay` → `seedHabitDays`（补播种 + 幂等），两个调用点跟改。
   - 在 `src/test/queries.habits.test.ts` 补：过去起始日期播种多行、幂等、今天在周期外。
   - 校验：`pnpm --filter @nextdo/db test`
3. **`apps/mobile` 写路径** — `hooks/use-start-habit.ts` 接受 `startDate?: string`，写入所选日本地零点。
4. **`apps/mobile` 展示层** — `app/habits.tsx`：
   - 起始日期行 + `DateTimePicker mode="date"`；
   - 时间窗口两半换成只读回显 + `DateTimePicker mode="time"`；
   - `startCheck` 参与 `canSubmit`，问题映射成中文提示；
   - `reset()` 把起始日期恢复成今天。
5. **测试** — `__tests__/habits-screen.test.tsx` 补断言。
6. **门禁** — `pnpm verify:web`（lint → typecheck → test → web 构建）。
7. **浏览器实测** — 起 `http://localhost:4180`，走 `/habits`：选起始日期（今天 / 过去几天 / 未来）、选时间窗口两半、提交，截图存 `.verify/habit-start-date-picker/`。
8. **规范回写** — `.trellis/spec/app/component-guidelines.md` 补一句「习惯表单的时间窗口同样是 DateTimePicker，不得回退成文本框」；`.trellis/spec/domain/domain-model.md` 记录 `startedAt` = 用户所选起始日的本地零点 + 补播种规则。

## 回滚点

- 1–5 之间任何一步失败都可以单独回退，`startedAt` 的存储格式没变，没有数据迁移需要撤销。

## 不要做的事

- 不改 schema / sync 配置 / 服务端 DDL。
- 不加跨天补种任务。
- 不碰 `windowDays`、周期天数配置、习惯编辑。