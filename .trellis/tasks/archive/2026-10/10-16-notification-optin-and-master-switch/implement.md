# 执行计划：通知主动授权 + App 内总开关

## 顺序清单

1. `apps/mobile/lib/notification-settings.ts`（新）— 偏好存储、默认值、订阅、测试钩子。
2. `apps/mobile/lib/reminders/reminder-scheduler.ts` — `ReconcileInput.enabled` 必填 + `enabled === false` 短路分支。
3. `apps/mobile/hooks/use-reminder-delivery.ts` — 读偏好、订阅变化、传入 `enabled`、关闭时 tick 早退。
4. `apps/mobile/components/notification-optin-dialog.tsx`（新）— 一次性引导弹窗。
5. `apps/mobile/app/_layout.tsx` — 挂载引导弹窗。
6. `apps/mobile/app/(tabs)/settings.tsx` — 总开关 + native `undetermined` 的「开启通知」按钮。
7. 测试：新增 `apps/mobile/__tests__/notification-optin-dialog.test.tsx` 与偏好存储单测；补 `reminder-scheduler` 的 `enabled: false` 分支；`settings-screen.test.tsx` 补总开关断言。

## 验证命令

```bash
pnpm --filter @nextdo/mobile test -- notification reminder-scheduler settings-screen
pnpm lint
pnpm typecheck
pnpm verify:web        # 交付前全量门禁；跑完打印 http://localhost:4180
```

浏览器实测：打开 `http://localhost:4180/settings`，走一遍通知卡片与总开关，截图到 `.verify/notification-optin/`。

## 风险点 / 回滚点

- **回滚**：不新增依赖、不改 schema；`git revert` 单个提交即可复原。
- `reminder-scheduler.ts` 是既有投递逻辑的核心，`enabled` 改必填会波及调用点与单测 —— 一次改完，避免半改状态。
- 引导弹窗挂在根布局：必须状态未就绪时渲染 `null`，否则会闪一下或挡住首屏（仿 `AutoUpdateNotifier`）。
- `expo-secure-store` 在 native 上存偏好略重，但沿用 `habit-reminders.ts` 的既有模式，一致性优先。

## `task.py start` 前复查

- [ ] `prd.md` / `design.md` / `implement.md` 齐全
- [ ] `implement.jsonl` / `check.jsonl` 有真实条目
- [ ] 无阻塞性 open question
