# Design: 优化推荐理由权重贡献与可信度 (now-rank-and-reasons)

## 1. 架构与改动范围

改动主要涉及两个模块：
- **`packages/core` (纯领域/引擎)**：
  - `src/engine/rank.ts`：加权贡献计算、重排序算法、软到期日（`dueDate`）紧急度推导、高价值理由过滤。
  - `src/engine/rank.test.ts` & `recommend.test.ts`：单测更新与补充。
- **`apps/mobile` (展示层 / UI)**：
  - `lib/reason-labels.ts`：理由文案精准化。
  - `app/(tabs)/now.tsx`：精简 Now 视觉层级，弱化背景杂质与边框堆叠，突出英雄卡片与动作指引。

---

## 2. 详细设计

### 2.1 软到期日（`dueDate`）紧迫度算法
在 `packages/core/src/engine/rank.ts` 中：
```ts
if (candidate.deadline !== undefined) {
  const h = hoursBetween(now, parseIso(candidate.deadline));
  if (h <= 0) signals['deadline-urgency'] = 1.0;
  else if (h <= 24) signals['deadline-urgency'] = 0.9;
  else if (h <= 72) signals['deadline-urgency'] = 0.7;
  else if (h <= 168) signals['deadline-urgency'] = 0.4;
} else if (candidate.dueDate !== undefined) {
  // dueDate 格式通常为 ISO 日期 (YYYY-MM-DD 或 YYYYMMDD)
  // 将其转换为本地日期比较，或者按当天 23:59:59 的时间戳
  const dueDateTime = parseDueDateEndOfDay(candidate.dueDate);
  const h = hoursBetween(now, dueDateTime);
  if (h <= 0) signals['deadline-urgency'] = 0.85; // 逾期软到期
  else if (h <= 24) signals['deadline-urgency'] = 0.75; // 今天到期
  else if (h <= 72) signals['deadline-urgency'] = 0.50; // 1~3 天内
  else if (h <= 168) signals['deadline-urgency'] = 0.25; // 4~7 天内
}
```

### 2.2 理由按加权贡献降序排序与可信度门槛
计算每个 signal 的实际加权得分：
`const weightedScore = W[code] * signals[code];`

可信度门槛（避免低价值被标记为高价值）：
- `goal-value`：仅在 `candidate.value >= 3` 且加权贡献 > 0 时生成理由。
- `project-importance`：仅在关联活跃项目且 `project.value >= 3` 时生成理由。
- 其他信号：只要加权贡献 > 0 且有效即可生成理由。

排序规则：
```ts
const reasons: Reason[] = eligibleCodes
  .slice()
  .sort((a, b) => {
    const diff = (W[b] * signals[b]) - (W[a] * signals[a]);
    if (Math.abs(diff) > 1e-6) return diff;
    return SCORE_CODES.indexOf(a) - SCORE_CODES.indexOf(b);
  })
  .map((code) => ({ type: 'score', code }));
```

### 2.3 Now 界面视觉层级精简
- 弱化场景/时间栏的外层重边框，增强容器内边距与留白（Padding & Breathing room）。
- 统计栏（可执行数、耗时、认知负荷）采用更平滑的轻背景胶囊设计，避免与下方的英雄推荐卡片争夺视觉焦点。
- 英雄卡片的“Why this?”理由标签样式优化，突出主导理由。
