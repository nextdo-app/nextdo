# Research findings: issues #54 / #56 集成

## 1. #50 / #51 复核结论（关闭依据）

- **#50（手机端习惯时间列表无法打开）**：`apps/mobile/components/datetime-picker.tsx:432` 已使用 `className="shrink"`（替代导致 Yoga 坍缩的 `flex-1`），并在 362 / 1177 行对顶栏、底栏使用 `flex-shrink-0`。当前分支 `release/0.1.8-beta.1` 包含该修复（PR #52 / commit 81ac1b1 已合入）。
- **#51（2 分钟内完成行动消失）**：`apps/mobile/lib/clarify-flow.ts` 中的 2 分钟路径会创建真实 `NextAction` 并跳转专注；专注结束后的「专注已完成 → 完成行动 / 先不完成」解耦确认已在 `app/focus/[id].tsx` 实现，完成可回收到 `/completed`。`.verify/issues-50-51/` 有完整浏览器实测记录（含倒计时归零到完成列表的复核轮次）。
- 结论：两个 issue 均可附复核说明关闭，不需要再改代码。

## 2. 并行拆分与冲突面

| 子任务 | 文件面 | 冲突 |
| --- | --- | --- |
| #56 | `app/focus/[id].tsx` 的「时间到」区块、`__tests__/focus-screen.test.tsx` | 与 #54 在 `focus/[id].tsx` 有交集（#54 需要播放提示音）：#56 先落布局，#54 再接入播放调用 |
| #54 | `lib/notification-settings.ts`、`lib/reminders/*`、`lib/calendar-sync/*`（新增）、`hooks/*`、`settings.tsx`、`_layout.tsx`、`package.json` / `app.json` | 无其他文件重叠 |

## 3. 验证门禁

- `pnpm verify:web` = lint → typecheck → test → build:web → 静态服务器（`:4180`），浏览器实测在服务器存活期间通过 CDP 驱动真实 Chrome 完成。
- 浏览器实测须覆盖：专注页倒计时归零的「时间到」区块与音效触发、设置页「声音与日历」区块（三个开关 / 音色（点击试听）/ Web 日历降级说明）、既有提醒投递回归。
- 截图与 `checks.json` 存 `.verify/issues-54-56/`，`evidence.md` 记录逐项结论。

## 4. 发布

- 当前版本 `0.1.9-beta.2`，六处版本号一致（`node scripts/check-release-version.mjs` 校验）。
- 本次发版 bump 到下一个 beta（六处同步），tag 与渠道必须匹配（prerelease 版本配 `-beta` tag）。
- 提交顺序：业务代码 → 任务归档 → journal；提交前先提交「提交计划」给用户确认。
