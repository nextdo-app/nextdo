# Now 与专注视图交互及按键优化 (Design)

## 1. Architecture & Boundaries

本优化聚焦于应用展示层与交互流转层（`apps/mobile`）：
- **Now 视图 (`app/(tabs)/now.tsx`)**:
  - 重构 `ActionRow` 结构与手势：整卡点击、右侧快捷完成打勾、右上角操作菜单（`ActionMenuModal`）。
  - 移除底部固定平铺的 4 个占位按钮（完成/稍后/编辑/删除）。
- **Focus 视图 (`app/focus/[id].tsx`)**:
  - `idle` 阶段：通过路由参数 `preset` 及行动上下文读取预计耗时；提供醒目的大主按钮 `[开始专注 · X 分钟]` 一键直启，下方胶囊切换时长。
  - `running` / `paused` 阶段：重构按键主次：主控键为 `[暂停 / 继续]`；次级按钮为 `[结束专注]`；弱化放置 `[放弃]`。
  - `completed` 阶段：强化 `[完成行动]` 为主视觉焦点，次级为 `[先不完成]`。
- **协议与契约保证 (`.trellis/spec/app/focus-island.md`)**:
  - 严格保持 `useFocusRuntime` 状态机与 Native IPC snapshot / command 格式不变。
  - 保证所有交互控件满足 44pt 最小点击区域标准。

---

## 2. Component Design & Interactions

### 2.1 Now 列表卡片 (`ActionRow`)

```
+-----------------------------------------------------------+
| (•) 行动标题内容文本                                [✓]  [...] |
|     备注内容（最多两行省略预览）                                |
|     [项目名标签]  [截止时间胶囊 / 随时]                          |
+-----------------------------------------------------------+
  ↑ 整卡点击 (Tap) -> router.push('/focus/{id}?kind={kind}&preset={estMinutes}')
  ↑ [✓] 右侧打勾 -> onComplete(action.kind, action.id)
  ↑ [...] 更多操作 -> 弹出 ActionMenuModal (编辑 / 稍后 / 删除)
  ↑ 左滑 (Swipe) -> 仍然支持滑出「✓ 完成」
```

- **视觉减负**:
  - 删除原卡片底部的 `border-t` 分隔线及 4 个按钮平铺区域（约释放 40pt 垂直高度）。
  - 右侧并排打勾圈（`Pressable` 44x44pt 触控靶）与「…」按钮（44x44pt），布局紧凑且留白充裕。
- **操作菜单 (`ActionMenuModal`)**:
  - 轻量模态/抽屉，包含：
    - `编辑行动` (Ionicons `create-outline`): 调用现有的 `onEdit(action)`
    - `稍后推迟` (Ionicons `time-outline`): 调用现有的 `onSnooze(action.kind, action.id)`
    - `删除行动` (Ionicons `trash-outline`, 红色高危色): 调用现有的 `onTrash(action.kind, action.id)`
    - `取消`

### 2.2 Focus 页面三段式流转 (`FocusScreen`)

#### 阶段 1：准备启动 (Idle)
- **初始时长推导**:
  `initialMinutes = (preset ? normalizeFocusMinutes(Number(preset)) : null) ?? lastMinutes ?? 25;`
- **主 CTA**:
  居中大按钮：`label={selectedMinutes ? `开始专注 (${selectedMinutes} 分钟)` : '开始自由专注'}`，点击立即调用 `startSession(selectedMinutes)`。
- **时长切换胶囊**:
  `[15 分钟] [25 分钟] [45 分钟] [60 分钟] [自由计时]`
  点击胶囊切换当前选中的时长，并保持在当前页一键可启；另外提供展开的自定义分钟数输入。

#### 阶段 2：计时进行中 (Running / Paused)
- **主控键**:
  `[暂停]` (运行时) 或 `[继续]` (暂停时)，采用醒目的主色大按钮（Primary），直观引导心流切换。
- **次级键**:
  `[结束专注]`，采用次级样式（Secondary），提前结算本次专注并进入 completed 状态。
- **防误触键**:
  `[放弃本次专注]`，作为低饱和度幽灵文字按钮（Ghost）居底放置，点击二次确认或明确提示放弃不计入专注时长。

#### 阶段 3：结算阶段 (Completed)
- **主行动**:
  `[完成行动]`，高亮主按钮，点击调用 `completeAction` 并返回 Now。
- **次级行动**:
  `[先不完成（保留待办）]`，次级按钮，直接退出专注返回 Now。
- **休息引导**:
  下方横排 `[休息 5 分钟]` `[休息 10 分钟]` 胶囊。

---

## 3. Data Flow & Contracts

1. **路由跳转参数增强**:
   - `now.tsx`: 点击整卡时生成 URL:
     `/focus/${action.id}?kind=${action.kind}${action.estMinutes ? `&preset=${action.estMinutes}` : ''}`
2. **状态传递不变**:
   - `useFocusController()` 提供 `start`, `run('pause')`, `run('resume')`, `run('complete')`, `run('abandon')`。
   - 所有数据库写入与 IPC 发布行为完全复用底层 hook，无任何侵入性改动。

---

## 4. Risks & Verification Strategy

| 风险点 | 应对措施 |
| --- | --- |
| 列表整卡可点击后，点击右侧打勾或「…」发生冒泡穿透 | `event.stopPropagation()` 或绝对定位隔离触控响应区域 |
| 既有单测 `now-screen.test.tsx` 依赖底部按钮文本（如 `完成` / `稍后` / `编辑`） | 更新单测试验用例，改为断言卡片整卡导航、打勾完成、及通过「…」呼出菜单项的交互契约 |
| 既有单测 `focus-screen.test.tsx` 依赖按键 label | 更新单测断言匹配新的主控键文本（「开始专注」「暂停/继续」等） |
| Web 端弹出层在不同屏幕尺寸下的兼容性 | 使用统一的 Modal 容器搭配 SafeArea 与半透明背景遮罩 |
