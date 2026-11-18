# 技术设计：表单字段常显标签

## 1. 问题与边界

字段名此前只存在于 `placeholder` 里。placeholder 是「提示」，不是「名称」：一旦填入内容（或被 picker 选入日期/时间）它就从界面上消失，框里只剩裸文本，用户无法回看这个框是干什么的 —— 项目详情「编辑项目」面板是最明显的例子（两个已填文本框，无任何标签）。

本次改动只动**表现层**：不改数据模型、hook、写路径、校验、a11y 角色与文本。因此风险集中在「视觉回归 + 测试查询契约」两处。

## 2. 方案

### 2.1 共享组件 `FormField`

`apps/mobile/components/form-field.tsx`：

```tsx
export interface FormFieldProps {
  label: string;            // 字段名，空态与已填态都渲染
  className?: string;       // 并排布局时传 flex-1
  children: ReactNode;
}
```

- 标签样式 `font-sans text-sm font-medium text-ink dark:text-ink-dark`，与同一张卡片里 `ValueChips` 的「价值（1–5）」标签同级同重，避免一张卡片出现两种字段名分量。
- 容器 `gap-1.5`，与卡片内既有标签块（如「场景（可选）」）一致。
- **为什么新建而不用澄清向导的私有 `Field`**：`Field`（`components/clarify-wizard.tsx:159`）除 `label` 外还带 `optional` / `rightAction` 变体，且属于向导模块；从屏幕里 import 向导会把整条澄清流程拖进依赖图。按 component-guidelines「第二次复制时提升为共享组件」的规则，新建一个最小形状的共享件，向导保持不动。
- **为什么 `className` 是必要的**：习惯表单的时间窗口是两个并排 picker（`flex-row`），标签必须跟着各自的列走 —— 用 `FormField className="flex-1"` 包裹，外层由 `items-center` 改为 `items-end` 以对齐两个框。

### 2.2 调用点（8 个文件）

| 文件 | 字段（新增标签） |
| :--- | :--- |
| `app/projects/[id].tsx` | 行动标题（添加/编辑行动）、项目标题、完成是什么样（结果）、截止日期 ×3、习惯名、每日行动 |
| `app/(tabs)/projects.tsx` | 项目标题、完成是什么样（结果）、截止日期 |
| `app/habits.tsx` | 习惯名、每日行动、预计分钟、开始时间、结束时间 |
| `components/edit-habit-form.tsx` | 同上（编辑态） |
| `app/waiting.tsx` | 事项名称、等待谁 |
| `app/contexts.tsx` | 场景名 |
| `app/(tabs)/settings.tsx` | 后端地址、同步流地址（高级设置） |
| `.trellis/spec/app/component-guidelines.md` | 新增「Forms (field labels)」小节，把决定写进规范 |

### 2.3 标签与 placeholder 文字重复（有意）

`项目标题` 这类字段现在标签与 placeholder 同文。这是刻意的：名称必须常驻，placeholder 必须继续为「框里该填什么」和既有测试（`getByPlaceholderText`）服务。仓库里已有先例：编辑行动弹窗的「截止日期」标签 + 「截止日期（可选）」placeholder。规范已记录该取舍。

### 2.4 有意不加标签的位置

收集箱「清空大脑」捕获框、快速捕获弹窗输入框、Now 屏的分钟内联编辑：它们是屏幕的主行为（有标题/按钮命名），不是被命名的表单字段，压一个标签只是噪音。澄清向导、编辑行动弹窗、新增场景弹窗此前已带标签。

## 3. 兼容性与风险

- **测试契约**：`placeholder` 与 `accessibilityLabel` 一律未改，现有 `getByPlaceholderText` / `getByLabelText` 查询不受影响；新增的可见文本可能与 `getByText` 精确匹配冲突 → 由全量 mobile 套件（41 套件 / 626 用例）验证。
- **视觉**：仅新增一行标签；卡片高度增加，无布局重构。
- **回滚**：改动是单层展示，整体 `git revert` 单条 commit 即回到原状；无数据迁移、无配置项。

## 4. 验证

1. `pnpm lint` / `pnpm typecheck` / `pnpm test`（root 脚本，含全部 workspace）。
2. `node scripts/verify-web.mjs`：门禁 + `expo export --platform web` + 静态服务器（SPA 回落）。
3. 浏览器实测：`.verify/form-field-labels/capture.mjs`（headless Chrome + CDP）走真实用户流程（建项目 → 详情页三个表单 → 习惯 → 等待 → 场景 → 设置高级设置），**在填好内容之后**截图，产物落 `.verify/form-field-labels/`，核验要点写入 `evidence.md`。
