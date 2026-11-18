# iOS 简约风 UI 重新设计与重构 — 技术设计 (design.md)

## 1. 架构与边界原则

- **UI 纯表现层改造**：严格限制在 `packages/ui` 与 `apps/mobile` 的组件、样式与路由组织层。
- **数据与事务零改动**：`packages/db`（所有查询与变更）、`packages/core`（所有 GTD 领域规则与决策引擎）保持完全不变。
- **跨平台兼容**：保持 React Native / Expo Web / Tauri 桌面端的一致性渲染，不引入平台专有私有 API。

---

## 2. Design Tokens 规范重构 (`packages/ui/src/tokens/`)

### 2.1 配色系统 (`colors.json`)
对接 iOS 官方色彩体系（System Grouped Background & Inset Grouped Surface）：

| Token 键名 | 浅色 (Light) | 深色 (Dark) | 语义说明 |
|-----------|-------------|------------|---------|
| `canvas` | `#F2F2F7` | `#000000` | 主画布底色（iOS Grouped 背景 / 深色纯黑沉浸） |
| `surface` | `#FFFFFF` | `#1C1C1E` | 卡片表面底色（iOS Inset Secondary 纯白 / 深灰） |
| `ink` | `#000000` | `#FFFFFF` | 主文字颜色（高对比度） |
| `muted` | `#8E8E93` | `#98989D` | 次要说明文字（iOS System Gray） |
| `accent` | `#1B5E3A` | `#30D158` | 主品牌色（沉稳自然之绿，兼顾深色可读性） |
| `onAccent` | `#FFFFFF` | `#000000` | 主品牌色按钮上的高对比文字 |
| `border` | `rgba(60, 60, 67, 0.12)` | `rgba(235, 235, 245, 0.15)` | 细分割线（替代粗描边） |
| `warning` | `#FF9500` | `#FF9F0A` | 警告/再明晰黄色（iOS Orange） |
| `danger` | `#FF3B30` | `#FF453A` | 危险/删除红色（iOS Red） |

### 2.2 圆角体系 (`radii.json`)
- `sm`: 6px
- `md`: 10px (输入框 / 小按钮)
- `lg`: 14px (大按钮 / 操作条)
- `xl`: 18px (卡片圆角)
- `full`: 9999px (胶囊 Chips / Tag)

---

## 3. 组件层级重构 (`packages/ui/src/components/`)

1. **`Button`**：
   - 增加尺寸层级（`size?: 'sm' | 'md' | 'lg'`），默认高度 44~48pt，确保符合 iOS 触控热区标准。
   - `variant="primary"`：全色填充 + 细腻按压反馈（`active:opacity-85`），大圆角。
   - `variant="secondary"`：浅色表面底色 + 极细分割线，柔和灰字。
   - `variant="ghost"`：无背景无描边，轻量纯文字操作。
2. **`Card`**：
   - 默认采用 iOS Inset Grouped Card 样式：圆角 `rounded-xl` (16~18px)，去除硬黑边框，通过与 `bg-canvas` 的明暗底色反差形成分层，底部分割线可选。
3. **`Tag`**：
   - 升级为更紧凑精致的圆角胶囊 (`rounded-full`)，字体更纤细清晰。

---

## 4. 路由与 Tab 导航架构 (`apps/mobile/app/`)

### 4.1 Tab 顺序调整
调整 `(tabs)/_layout.tsx`：
```tsx
<Tabs screenOptions={{ headerShown: false }}>
  <Tabs.Screen name="inbox" options={{ title: '收件箱' }} />
  <Tabs.Screen name="now" options={{ title: '现在' }} />
  <Tabs.Screen name="projects" options={{ title: '项目' }} />
  <Tabs.Screen name="review" options={{ title: '回顾' }} />
</Tabs>
```
Tab 栏采用半透明背景与细顶边分割线，字号与激活态高亮对标 iOS 标准样式。

### 4.2 开屏极速捕获弹窗 (`QuickCaptureModal`)
- 组件位置：`apps/mobile/components/quick-capture-modal.tsx`
- 挂载点：在 `(tabs)/_layout.tsx` 或根布局中由状态控制。
- 交互设计：
  - 首次进入页面时，检测并自动弹出（可通过 `sessionStorage` 或全局状态标记本次加载是否已初次触发）。
  - 半屏卡片居中浮动（Web/Desktop）或底部抽屉 Sheet（移动端），背景高斯模糊遮罩。
  - 自动聚焦 `TextInput`（`autoFocus={true}`）。
  - 支持快捷键 `Enter` 直接落入 `addInboxItem`，保存后显示成功微动效并清空，支持连记；点击外部遮罩、按 `ESC` 或点右上角关闭按钮收起。

---

## 5. 核心屏幕视觉重排

### 5.1 【现在】执行屏 (`now.tsx`)
- **场景与时间条**：从原先笨重的大框中解放，转化为轻盈的横向胶囊滑块（Scrollable Pill Row），选中项以 iOS 高亮胶囊展示，减少对主屏视线的遮挡。
- **推荐卡片 (Hero Card)**：
  - 占据视觉中心，标题使用大字号加粗，预估时长与类型标签采用轻底色胶囊。
  - 「为什么是它？」收敛为精致的浅底理由摘要。
- **行动按钮重构**：
  - **核心动作**：全宽大号主按钮 `[开始专注 (25m)]`，位于卡片最下方，醒目突出。
  - **次级操作**：`[换一个]` 与 `[稍后]` 作为等分次要按钮排在主按钮下方，不再挤在一起。

### 5.2 【收件箱】屏 (`inbox.tsx`)
- iOS 大标题风格：`收件箱` 大字顶栏。
- 顶部保留快速输入框，支持一键呼出大弹窗。
- 条目卡片采用 Grouped Cell 质感，点击整行平滑进入 Clarify 向导。

### 5.3 【项目】屏 (`projects.tsx`) 与 【回顾】屏 (`review.tsx`)
- 项目列表使用 Inset Grouped 风格，状态用精致指示灯（绿色/橙红）展示。
- 回顾页面采用两张宽幅卡片展现今日回顾与本周回顾入口。
