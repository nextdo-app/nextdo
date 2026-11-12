# Now 与专注视图交互及按键优化 (Implement)

## 1. Ordered Implementation Checklist

### Step 1: Now 视图卡片与菜单重构
- [ ] 创建/抽取 `ActionMenuModal` 组件（支持编辑、稍后、删除三项操作）。
- [ ] 修改 `apps/mobile/app/(tabs)/now.tsx`:
  - 移除 `ActionRow` 底部平铺的 4 个占位按钮；
  - 调整卡片主体布局，右侧增加打勾完成圆圈按钮和「…」更多操作按钮，确保 44pt 触控靶；
  - 绑定整卡 `onPress` 导航到 `/focus/${action.id}?kind=${action.kind}&preset=${est}`；
  - 绑定「…」点击打开 `ActionMenuModal`，连接现有的 `onEdit`、`onSnooze`、`onTrash` 回调。

### Step 2: Focus 视图流转与按键重构
- [ ] 修改 `apps/mobile/app/focus/[id].tsx`:
  - 准备阶段 (Idle): 支持从 `preset` / `estMinutes` 推导默认时长，增加主 CTA `[开始专注 (X 分钟)]`；下方胶囊点选直接变更选中时长；
  - 计时中 (Running / Paused): 主按钮设为醒目的 `[暂停]` / `[继续]`；次按钮为 `[结束专注]`；最下方弱化为 `[放弃本次专注]`；
  - 结算阶段 (Completed): 突出主按钮 `[完成行动]`，次按钮 `[先不完成]`，保留休息时长胶囊。

### Step 3: 单测与门禁适配
- [ ] 更新 `apps/mobile/__tests__/now-screen.test.tsx`:
  - 适配列表卡片点击直达专注；
  - 适配右侧打勾完成与「…」菜单操作路径。
- [ ] 更新 `apps/mobile/__tests__/focus-screen.test.tsx`:
  - 适配主按钮「开始专注 (X 分钟)」及计时中主控键流转。
- [ ] 运行本地全量门禁：`pnpm verify:web`（包含 lint, typecheck, test, web export）。

### Step 4: 浏览器实测与截图
- [ ] 启动本地 Web 服务实测 Now 列表交互（整卡点击跳转、打勾完成、更多菜单操作）。
- [ ] 实测 Focus 视图（一键开始、暂停/继续切换、结束专注与行动结算）。
- [ ] 在 `.verify/now-focus-ux/` 保存相关界面实测截图。

---

## 2. Validation Commands

```bash
# 1. 局部单元测试
pnpm --filter @nextdo/mobile test now-screen.test.tsx
pnpm --filter @nextdo/mobile test focus-screen.test.tsx

# 2. 全量门禁校验
pnpm verify:web
```

---

## 3. Risky Files & Rollback Points

- `apps/mobile/app/(tabs)/now.tsx`: 核心执行列表入口，需保证手势滑动的 `useSwipeReveal` 与右侧按钮点击不冲突。
- `apps/mobile/app/focus/[id].tsx`: 专注主状态控制，需保证状态机转换与计时准确性不被侵入。
- 回滚策略：单文件 Git 回滚，所有底层 hooks（`useFocusRuntime`, `useNow`）保持零侵入。
