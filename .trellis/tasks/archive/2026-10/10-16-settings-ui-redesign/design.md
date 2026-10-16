# 设置页面 UI 重构技术设计

## 1. 结构与组件设计

### 1.1 分组容器与 SectionHeader
在 `apps/mobile/app/(tabs)/settings.tsx` 中定义轻量化的 `SectionHeader`：
- 小字号（`text-xs font-semibold tracking-wider text-muted dark:text-muted-dark uppercase`）配有适当的上间距（`mt-6 mb-2`），与卡片内部的标题拉开层级。

### 1.2 页面四大区域模块划分
1. **Section 1: 通用与偏好 (`GeneralSection`)**
   - 外观主题 (`ThemePreferenceCard`)：
     - 保留原本 `useAppTheme` 的 `setPreference` 行为；
     - 选项渲染为 3 列分段卡片，每列包含 Ionicons 图标（跟随系统：`phone-portrait-outline`，浅色：`sunny-outline`，深色：`moon-outline`）与标签；选中态使用 `border-accent bg-accent/10 text-accent font-semibold`，未选中态使用 `border-border/70 bg-surface text-ink`。
     - 保持现有 `accessibilityLabel`（如 `跟随系统`、`浅色模式`、`深色模式`）和 `accessibilityRole="button"`，保证测试兼容。
   - 场景管理 (`ContextsRow`)：
     - 作为卡片内的行式入口，左侧带场景图标（`shapes-outline`）和副标题，右侧带跳转按钮（`管理 →` 或 `chevron-forward`），保持点击调用 `router.push('/contexts')`。

2. **Section 2: 提醒与通知 (`NotificationsSection`)**
   - 整合 `useReminderPermission` 和 `useNotificationSettings`；
   - 保持所有的 `Switch` 属性与 `accessibilityLabel="应用内通知"`、`accessibilityLabel="习惯打卡提醒"`；
   - 两个功能以卡片内优雅分割线（`border-t border-border/50 dark:border-border-dark/50`）分隔，形成一个紧凑统揽的通知中枢。

3. **Section 3: 数据与同步 (`CloudSyncSection`)**
   - 保留所有 `useSyncStatus` 导出的方法和状态；
   - 将飞书文档外链包装为 `TutorialBanner`，带 `book-outline`、`text-accent` 与圆角微底色；
   - 未连接状态：优化 Tab 切换（连接串配对 / 自建服务器）与各输入框的布局留白；
   - 已连接状态：加入带颜色的状态小圆点（在线/离线/已同步），字段化呈现后端地址；
   - 断开连接操作：样式统一为带警示倾向的次级按钮，保留确认对话框逻辑。

4. **Section 4: 关于与更新 (`AboutSection`)**
   - 保留 `useAppUpdate`；
   - 自动检查更新开关替换为原生 `<Switch trackColor={SWITCH_TRACK_COLOR} />`，保留 `accessibilityLabel="自动检查更新"`；
   - 渠道选择按钮增加图标与选中状态高亮；
   - 保持版本号文本 `0.1.6-beta.8` 与现有测试查找模式匹配。

### 1.3 容器与响应式适配
- 根级 `ScrollView` 内部容器由 `w-full max-w-5xl self-center` 优化为 `w-full max-w-2xl self-center px-4 md:px-6`，在宽屏下呈现舒适的阅读视宽，移动端自适应。

## 2. 状态与契约兼容性
- 所有的 `testID`、`accessibilityLabel`、`accessibilityRole` 与用户可见文案均保持向后兼容，确保现有 70 个单元测试直接通过。
