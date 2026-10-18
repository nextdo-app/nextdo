# UI 体验与交互全栈优化技术设计

## 1. 设计令牌与组件规范

### 1.1 品牌色与状态色统一
- 依赖 `@nextdo/ui` 导出的 `colors` 统一管理：
  - 品牌陶土色：`colors.accent`（浅色 `#c85a17`）、`colors.accentDark`（深色 `#e0703a`）；
  - 中性墨色与暗色：`colors.ink` / `colors.inkDark`；
  - 次级辅助色：`colors.muted` / `colors.mutedDark`；
  - 危险与警告色：统一采用 `danger` / `warning` 相关令牌类。
- 在所有图标（`Ionicons`）上使用 `isDark ? colors.accentDark : colors.accent` 动态适配深色模式。

### 1.2 几何与圆角阶梯
- 统一层级体系：
  - 外层大卡片与页面容器：`rounded-2xl` (16px) 或 `rounded-3xl` (24px)；
  - 卡片内嵌输入框与表单项：`rounded-xl` (12px)；
  - 按钮与动作单元：`rounded-md` (8px) / `rounded-lg` (12px)；
  - 标签与胶囊：`rounded-full`。
- 时长 Chip 重构为 `h-8 min-w-[36px] px-2.5 items-center justify-center rounded-full`。

## 2. 界面排版与心智模型

### 2.1 「现在」Tab 层级调整
```text
TopHeader（标题 + 模式徽标 + 快速操作）
  ↓
FilterContextCard（可用时间条件导轨）
  ↓
Re-clarify Banner（若有连续跳过任务）
  ↓
Recommendation Hero Card（推荐任务英雄卡片）
  ↓
Action Toolbar（开始 / 换一个 / 稍后）
  ↓
Pool Stats Row（可执行数 / 预估耗时 / 认知负荷）
  ↓
Eligible List（可执行备选清单）
  ↓
Today Habits（今日习惯）
```

### 2.2 专注模式氛围提升
- 容器在宽屏下使用 `max-w-md mx-auto` 居中，避免大屏拉伸；
- 倒计时时钟应用 `font-mono text-6xl sm:text-7xl font-bold`；
- 增加当前状态胶囊（「专注进行中」/「已暂停」）；
- 优化操作按键权重，主按键强化「暂停」/「继续」。

### 2.3 桌面自适应视宽统一
各 Tab 与二级子页面统一使用 `max-w-4xl mx-auto` 容器，消除跨路由跳转时的宽度跳跃。
