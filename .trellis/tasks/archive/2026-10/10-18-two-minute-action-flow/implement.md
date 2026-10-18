# Implementation Plan: 修复两分钟行动完成与流转逻辑（Issue #51）

## 1. 实施步骤

- [ ] 1. 数据库与领域逻辑适配（`packages/db/src/queries/inbox.ts`）：
  - 当 Q3b 选择「现在就做完」时，将事项物化为 `NextAction`（estMinutes=2, value=3, status=open），并在 `ClarifyResult` / `ReclarifyResult` 中返回该 `createdIds[0]`。
- [ ] 2. Focus 页面支持预设参数与自动启动（`apps/mobile/app/focus/[id].tsx`）：
  - 支持 `preset` 与 `autoStart` search params；
  - 校验有效后自动调用 `focus.start(actionId, preset)` 开启 2 分钟倒计时。
- [ ] 3. 澄清向导前台流转对接（`apps/mobile/components/clarify-wizard.tsx` 与 `lib/clarify-flow.ts`）：
  - 点击「是，现在就做完」时，完成物化创建并直接导航进入 Focus 专注页面。
- [ ] 4. 单元测试与端到端测试：
  - 更新 `packages/db/src/test/queries.inbox.test.ts`；
  - 更新 `apps/mobile/__tests__/clarify-wizard.test.tsx`；
  - 更新 `apps/mobile/__tests__/focus-screen.test.tsx`。
- [ ] 5. 浏览器实测验证：
  - 在浏览器中完整走通：澄清 -> 选 2 分钟 -> 选现在做完 -> 自动进入 2 分钟倒计时 -> 结束专注 -> 确认完成 -> 查看「已完成行动」列表 -> 恢复为未完成。
