# Design: 专注页「时间到」提示卡重构（#56）

## 1. 现状（证据）

`apps/mobile/app/focus/[id].tsx`：

- 外层 `<Card className="gap-6 p-6 rounded-3xl border border-border/70 bg-surface shadow-sm …">` —
  `Card` 默认 `elevated` 已带 border / bgSurface / shadow。
- 「时间到」区块再套一层 `<Card className="w-full border-warning bg-warning/10 p-3.5 rounded-2xl">`，
  于是出现边框 + 底色 + 阴影的双层矩形。
- 内部按钮横排左对齐（`flex-row gap-2.5`），主按钮扁平、次级按钮 `secondary` 自带边框与底色。
- 「时间到」用 `text-sm font-semibold`，与正文同级。
- 计时数字始终 `text-6xl sm:text-7xl font-bold text-ink`，到 `00:00` 仍是重型黑字。

`packages/ui/src/components/card.tsx`：`elevated` 变体 = `border border-border bg-surface shadow-sm`，
嵌套即双层容器 —— 这是问题的结构性原因，提示区块不该用 `Card`。

## 2. 方案

**不新增组件，不改 Card 语义**；在专注页把一个「卡片」降级为一个「提示区块」：

1. 提示区块改为 `<View>`（无边框 + 无阴影 + 无底色矩形），用
   `border-l-4 border-warning bg-warning/5 rounded-2xl px-4 py-4` 的**单侧色条**表达提醒态；
   warning 色只出现在色条、图标与标题，不铺满整个容器。
2. 标题层级：`Ionicons name="alarm-outline"` + `font-display text-base font-bold`，
   下方一行 `text-xs text-muted` 说明文案。
3. 按钮：`flex-col gap-2.5` 纵向全宽 —— 主操作「结束专注」在上，次级「继续专注」在下，
   两者同宽、同圆角，消除左右留白与风格不一致。
4. 计时数字：`timeUp` 时颜色降为 `text-muted dark:text-muted-dark`，并在数字下方渲染
   `本次专注 {n} 分钟`（实际用时），保留 `00:00` 的语义但不再抢视觉。
5. 间距：外层 Card `gap-5 p-6 rounded-2xl`；计时区 `gap-4`；提示区块自身 `mt-1`，
   垂直节奏落在 4 的倍数刻度。
6. 可访问性：区块 `accessibilityRole="alert"` + `accessibilityLabel="专注时间到"`；
   「继续」按钮文案改为「继续专注」，与「结束专注」成对且语义更明确（测试同步更新）。

## 3. 变更文件

| 文件 | 变更 |
|------|------|
| `apps/mobile/app/focus/[id].tsx` | 外卡圆角 / 间距；「时间到」区块重构；计时数字降级；按钮纵向 |
| `apps/mobile/__tests__/focus-screen.test.tsx` | 「继续」→「继续专注」；新增无嵌套 Card、实际用时文案断言 |

## 4. 明确不改

- 专注状态机、`focus-timer` 计算、完成 / 放弃流程、`Card` 组件本身。
- 提示音（由 #54 子任务最后接入本区块）。
