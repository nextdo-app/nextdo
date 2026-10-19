# Implementation Plan: issues #58–#62

## 步骤

- [x] 1. `lib/focus-settings.ts` + `lib/focus-settings.test.ts`：设备偏好存取（1–180 分钟整数、默认 null）。
- [x] 2. `hooks/use-focus-settings.ts`：读取/写入/订阅的 UI hook。
- [x] 3. `app/focus/[id].tsx`：
  - 档位 `[15, 25, 45, 60]` + 上次值默认态 + 自定义输入；
  - 用户主动选择后写 `lastMinutes`；
  - 底部常驻「速记一笔」坞 + `QuickCaptureModal`（保存即关闭并轻提示，不导航）。
- [x] 4. `components/quick-capture-modal.tsx`：`onCaptured` 语义调整 + `onCapturedAndClarify` 次要按钮。
- [x] 5. `app/(tabs)/inbox.tsx`：内联「记录 / 记录并澄清」、弹窗回调调整、「待澄清」计数、「开始澄清」入口。
- [x] 6. `app/clarify/[inboxId].tsx` + `components/clarify-wizard.tsx`：批量模式（`batch=1`）透传下一 id / 剩余数，done 步骤「澄清下一条」。
- [x] 7. 测试：更新 `focus-screen` / `inbox-screen` / `quick-capture-modal` / `clarify-wizard`，新增 `focus-settings`。
- [x] 8. 门禁：`pnpm verify:web --no-serve` 全绿；浏览器实测并截图到 `.verify/issues-58-59/`，写 `evidence.md`。
- [x] 9. 输出提交/PR/关 issue/发 beta 计划，等待用户确认后执行。
- [x] 10. #60：`lib/focus-notification.ts` + `lib/notification-channels.ts` + 原生适配器扩展；专注页权限引导/到时收尾/5·10 分钟休息。
- [x] 11. #61：Now 顶部「今日习惯待打卡」卡片（最多 3 条 + 「快速打卡」+ 多余计数）。
- [x] 12. #62：`Task.actionKind` + DB `action_kind`；等待清单查询/页面/`use-waiting-for`；行动类型选择器；项目「先挂着」可选首行动。
- [x] 13. 第二批门禁：`pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build:web` 全绿；浏览器实测截图到 `.verify/issues-60-62/` 并写 `evidence.md`。

## 验证命令

```bash
pnpm --filter @nextdo/mobile test -- focus-screen inbox-screen quick-capture-modal clarify-wizard focus-settings now-screen
pnpm lint && pnpm typecheck && pnpm test
pnpm build:web
node .verify/issues-60-62/capture.mjs
```

## 完成定义

- #62 验收：项目可「先挂着」且无需首个行动；行动类型（下一步/等待/委派）可选；等待事项进入等待清单并带类型标签，不进 Now 执行池。
- #61 验收：Now 顶部待打卡卡片可见、可单步打卡、全部完成即消失。
- #60 验收：未授权有权限引导；专注/休息到时调度系统通知；到时提供 5/10 分钟休息。
- #58 验收：记录可跳过澄清并进入待澄清列表；有待澄清列表与批量澄清入口；专注页可速记且不打断计时。
- 门禁全绿 + 浏览器截图证据。
