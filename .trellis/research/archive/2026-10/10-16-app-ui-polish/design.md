# 核心页面 UI 细节优化技术设计

## 1. 结构与组件设计

### 1.1 视宽收敛规范（Desktop Width Constraint）
将 `review.tsx`、`completed.tsx`、`contexts.tsx`、`waiting.tsx`、`habits.tsx` 内部主容器由 `w-full max-w-5xl mx-auto` 统一为：
`w-full max-w-2xl mx-auto`，实现全应用一致的书卷阅读视宽。

### 1.2 回顾页面（Review）
- 引入 `@expo/vector-icons/Ionicons`；
- 「今日回顾」配 `sunny-outline`（陶土色徽章），「本周回顾」配 `calendar-outline`（陶土色徽章）；
- 右侧动作采用带圆形轻底座的 `chevron-forward`；
- 保持 `accessibilityLabel="今日回顾"`、`accessibilityLabel="本周回顾"` 契约。

### 1.3 已完成清单（Completed）
- 头部返回按钮保持 `← 现在`，右侧放对称平衡容器；
- 恢复操作按钮 label 设为 `恢复行动`，保留原有 `reopen` 调用。

### 1.4 场景管理（Contexts）
- 新场景创建卡片下方增加建议预置胶囊：`['电脑', '办公室', '电话', '外出', '家里']`；
- 点击自动填入输入框，减少移动端键盘输入负担。
