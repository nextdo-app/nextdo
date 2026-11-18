# Research: #56 相关代码与设计系统

## 定位

- 专注页：`apps/mobile/app/focus/[id].tsx`
  - `timeUp` 计算：`isTimeUp(...)`（`lib/focus-timer.ts`）
  - 提示区块：约第 285 行 `<Card className="w-full border-warning bg-warning/10 p-3.5 rounded-2xl">`
  - 外层卡片：`<Card className="gap-6 p-6 rounded-3xl …">`
- 组件库：`packages/ui/src/components/card.tsx`（`elevated` = border + bgSurface + shadow）
- 色板：`packages/ui/tokens/colors.json`（`warning` / `warning-dark` / `muted` / `muted-dark` / `ink` / `ink-dark`）

## 设计系统约束

- 圆角：卡片统一 `rounded-2xl`（`component-guidelines.md` 的 Settings 部分与 issue #56 的建议一致）。
- warning 色只做小面积强调，不铺大面积背景（`component-guidelines.md` Tag 部分）。
- 按钮：`variant="primary"` 无边框；`variant="secondary"` 自带 `border + bg-surface`，横排时视觉权重相近易混；纵向排列 + 全宽可消除对齐问题。
- 文本样式必须放在 `<Text>` 上，不能放 `<View>`（NativeWind/RN 不级联）。

## 现有测试

`apps/mobile/__tests__/focus-screen.test.tsx` 覆盖：选时长、倒计时、暂停 / 继续、时间到横幅、结束专注、后续行动、放弃、2 分钟自动开始。修改文案需同步 `getByText('继续')` 断言。
