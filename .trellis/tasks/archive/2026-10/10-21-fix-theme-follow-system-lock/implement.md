# Implement — 修复跟随系统主题被桌面端窗口外观锁死

## 执行顺序

- [x] 1. `apps/desktop/src-tauri/src/lib.rs`：`set_window_theme` 接受 `system`（→ `None`，跟随系统），`light`/`dark` 仍固定外观；顺带修正被错放到命令上的 `mobile_entry_point` 属性。
- [x] 2. `apps/mobile/lib/theme.ts`：
  - `syncTauriWindowTheme(preference: ThemePreference)`：`invoke` 原样传 preference。
  - `syncPlatformTheme` 改传 `snapshot.preference`；原生 `Appearance` 分支保持不变。
  - `getLiveSystemScheme`：Web 下实时读取 `matchMedia`，避开 WKWebView 不补发 `change` 的竞态。
- [x] 3. `apps/mobile/__tests__/theme.test.tsx`：新增 Tauri 入参与 Web 竞态回归用例；`__tests__/mocks/theme-env.ts` 提供 IPC 记录桩。
- [x] 4. 单测：`pnpm --filter @nextdo/mobile exec jest __tests__/theme.test.tsx`（11/11）。
- [x] 5. 类型/门禁：`pnpm verify:web` 已跑通 lint → typecheck → test → build:web（最后停在常驻静态服务器，属预期）。
- [x] 6. 浏览器实测：对门禁产物模拟系统深浅切换，确认 IPC 收到 `system` 且界面正确；证据在 `.verify/10-21-fix-theme-follow-system-lock/`。
- [ ] 7. 真机确认：重建/安装 macOS 应用后切换系统外观（人工步骤，待确认是否执行）。
- [ ] 8. 提交计划报用户确认后再执行三阶段提交。

## 验证命令

```bash
pnpm --filter @nextdo/mobile test -- theme
pnpm typecheck
pnpm verify:web --no-serve
```

桌面构建（沿用上一轮流程）：

```bash
pnpm --filter @nextdo/mobile exec expo export --platform web
node apps/desktop/scripts/sync-frontend-dist.cjs
cd apps/desktop && pnpm tauri build --no-bundle
```

## 回滚点

- 本次仅改主题桥接函数与测试；回滚只需还原 `theme.ts` 与 `lib.rs` 两处改动，无需迁移数据。
