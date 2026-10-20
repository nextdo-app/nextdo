# 执行与验证计划

## 实施步骤

1. **Step 1: 重构 `apps/mobile/lib/theme.ts` 全局主题状态机**
   - 定义 `ThemeSnapshot` 不可变快照；
   - 建立 Web 现代 `matchMedia` 双通道监听与 Native 监听；
   - 将 DOM 类写入与 NativeWind 同步收敛至统一状态更新逻辑，消除组件级 Effect 竞态；
   - 让 `useSyncExternalStore` 订阅整套快照。

2. **Step 2: 更新并扩充自动化单测**
   - 运行 `apps/mobile/__tests__/theme.test.tsx`；
   - 补充系统外观动态切换时快照同步与 Class 一致性的单测用例。

3. **Step 3: 浏览器与真实桌面环境实测**
   - 运行 Swift Headless 视口动态翻转测试，抓取前后实测截图保存到 `.verify/10-20-theme-system-color-sync-fix/`；
   - 跑通完整交付门禁 `pnpm verify:web`。

4. **Step 4: 提交准备与收尾**
   - 向用户汇报实测成果并提供三阶段提交计划。
