<div align="center">

# Nextdo

**行动先于计划，清空大脑，进入心流。**

一款以 **GTD（Getting Things Done）** 哲学与科学执行力为内核的现代、开源、本地优先（Local-First）个人任务与习惯助手。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Android%20%7C%20iOS%20%7C%20Windows%20%7C%20Web-lightgrey.svg)](#-下载与安装)
[![Local-First](https://img.shields.io/badge/Data-Local--First-success.svg)](#-本地优先与数据主权)
[![Tech Stack](https://img.shields.io/badge/Stack-React%20Native%20%7C%20Expo%20%7C%20Tauri%20v2%20%7C%20PowerSync-orange.svg)](#-技术架构)

[🌐 在线体验 (PWA)](https://nextdo-cew.pages.dev) • [功能特性](#-核心特性) • [GTD 工作流](#-设计哲学与-gtd-工作流) • [快速下载](#-下载与安装) • [多端同步](#-多端同步与自托管) • [技术架构](#-技术架构) • [本地开发](#-本地开发指南)

</div>

---

## 为什么选择 Nextdo？

市面上的大多数待办清单（Todo Lists）往往只是**静态的列表堆叠**：任务越积越多，未完成项不断延期，最终演变成令人窒息的焦虑来源。

**Nextdo 的不同之处在于：**
- **拒绝清单选择困难**：清单不应成为你的决策负担。Nextdo 拥有内置的**智能当下推荐引擎（Now Engine）**，根据你当前的物理环境、碎片时间和事件优先级，直接推送**当前唯一应当执行的最佳下一步行动**。
- **严格遵循 GTD 闭环**：从低阻力的闪念捕获，到引导式单步厘清向导，再到聚焦执行与定期系统检视，形成完整心流闭环。
- **终结假性拖延**：多次跳过的死任务会自动触发**重新厘清机制（Re-clarify）**，逼迫面对阻碍，而不是任由其在清单底层腐烂。
- **真正的本地优先（Local-First）**：毫秒级离线读写，无需联网也能流畅使用全功能；同时支持去中心化、零成本的多端增量实时同步。

---

## ✨ 核心特性

### 1. 🧠 闪念收集箱（Capture / Inbox）
- **零阻力捕捉**：灵感与杂务转瞬即逝，无需当场分类、打标签或估算耗时，一键收集，立即重回当前工作。
- **清空大脑**：大脑是用来思考的，不是用来记事的。将所有心理负担迅速卸载到本地数字存储中。

### 2. 🔀 交互式厘清向导（Clarify Wizard）
Nextdo 将 GTD 的核心决策树转化为直观的单步向导，一步一问，消除模棱两可：
- **可行动吗？** 否 → 归档为参考资料（Reference）、暂存将来也许（Someday/Maybe）或直接放入垃圾箱。
- **需要多个步骤？** 是 → 自动创建或关联到对应项目（Project）。
- **两分钟原则？** 2 分钟内可搞定 → 立即执行（Do Now），不生成冗余任务。
- **由谁负责？** 委托他人 → 归入等待清单（Waiting For），设置预期与跟进时间。
- **固定时间还是灵活行动？** 具有硬性时间点 → 日历动作（Calendar Action）；其余均转为可落地的下一步行动（Next Action）。

### 3. 🎯 智能当下推荐引擎（The "Now" Engine - 杀手级能力）
告别对着几百条待办事项发呆的决策疲劳，点击底栏 **「当下 (Now)」**：
- **时间自适应**：选择你此刻可用的碎片时间（15 分钟、30 分钟、1 小时等），系统只推荐能在此时间内完成的行动。
  （场景／情境筛选在 0.1.7 暂时下线，实现存档于 `park/contexts-scenes` 分支。）
- **多维科学评分模型**：
  - 截止日期紧迫度（Deadline Urgency）
  - 目标与项目价值（Goal & Project Value）
  - 时间碎片契合度（Time Fit）
  - 习惯坚持契约（Habit Commitment）
  - 心理防倦怠与健康关怀（Health Protection）
- **The ONE Recommendation**：系统精算出当前唯一最推荐的事项，并透明展示推荐理由（Why this?）。
- **防拖延 Re-clarify 机制**：若某项任务连续跳过超过阈值，系统判定该任务粒度过大或存在心理阻力，强制唤起重新厘清，拒绝死任务自我欺骗。

### 4. ⏱️ 沉浸专注模式（Focus Mode）
- **全屏极简倒计时**：启动当前推荐行动后，自动进入心流专注屏，屏蔽一切多余干扰。
- **计时与状态追溯**：记录每一次专注会话（Focus Session），为后续复盘提供真实的时间消耗数据。

### 5. 📂 成果导向的项目管理（Projects）
- **必须明确完成成果（Outcome）**：拒绝“学英语”、“搞科研”等模糊空话，强制定义可验收的目标状态。
- **停滞项目自动预警**：系统自动检测缺乏后续动作的“孤儿项目”，督促拆解推进，杜绝烂尾。

### 6. 🌱 21 天微习惯追踪（Habits & Challenges）
- **习惯原子化**：将宏大愿景落实为每日微习惯，支持设定时间窗口与循环周期。
- **项目强绑定**：习惯可直接归属于具体项目（如“每日阅读 15 分钟论文”归属“毕业课题”）。
- **坚持轨迹可视化**：直观的进度环与连续完成打卡轨迹。

### 7. ⏳ 等待与委托清单（Waiting For）
- 结构化记录交由他人推进的事项，标记委托对象、承诺日期与跟进节点，不再遗忘外部依赖。

### 8. 📊 双轨复盘与系统检视（Daily & Weekly Review）
- **今日回顾（Daily Review）**：睡前或下班前 3 分钟，快速结算今日完成、排期顺延与次日必做，清空心理账本。
- **每周检视（Weekly Review）**：深度审视收件箱、活跃项目进度、停滞阻塞、习惯走势与委托事项，让系统持续保持值得信赖的健康状态。

---

## 🧭 设计哲学与 GTD 工作流

Nextdo 严格映射大卫·艾伦（David Allen）提出的 GTD 五步法：

<div align="center">
  <img src="./docs/assets/gtd-workflow.png" alt="Nextdo × GTD 五步法" width="100%" />
</div>

---

## 🛡️ 本地优先与数据主权

- **极速本地存储**：数据首要存储于本地 SQLite 数据库（移动端原生驱动，桌面端与网页端嵌入式引擎），毫秒级启动与查询，无网络状态下全功能离线可用。
- **数据完全属于你**：无商业公司服务器偷窥或分析你的个人隐私，数据库账本掌握在你自己的设备中。
- **流式实时同步**：基于 [PowerSync](https://powersync.com/) 与 PostgreSQL 的 WAL（Write-Ahead Logging）机制，实现轻量、实时、低功耗的多端双向增量同步。

---

## 📦 下载与安装

无需自行配置编译环境，直接前往 **[GitHub Releases](https://github.com/printsdf/Nextdo/releases)** 即可下载对应系统的预编译安装包：

| 平台 | 适用架构 | 安装包 / 推荐格式 | 说明 |
| :--- | :--- | :--- | :--- |
| **macOS** | Apple Silicon (M系列)<br>Intel (x86_64) | `Nextdo_x.x.x_aarch64.dmg`<br>`Nextdo_x.x.x_x64.dmg` | 原生轻量级桌面端（基于 Tauri v2）<br>支持 macOS 11.0 及以上 |
| **Windows** | 64 位 (x86_64) | `Nextdo_x.x.x_x64-setup.exe`<br>`Nextdo_x.x.x_x64_en-US.msi` | 提供 NSIS 快捷安装包与企业级 MSI 包<br>适配 Windows 10 / 11 |
| **Linux** | 64 位 (x86_64) | `Nextdo_x.x.x_amd64.AppImage`<br>`Nextdo_x.x.x_amd64.deb` | AppImage 即开即用，deb 适配 Debian/Ubuntu<br>兼容主流桌面发行版 |
| **Android** | arm64-v8a (主流机型)<br>armeabi-v7a / x86_64 | `Nextdo_x.x.x_android_arm64-v8a.apk`<br>`Nextdo_x.x.x_android_armeabi-v7a.apk` | 推荐绝大多数现代 64 位手机下载 `arm64-v8a`<br>适配 Android 8.0 及以上 |
| **Web / PWA** | 现代主流浏览器 | [🌐 在线网页版 (PWA)](https://nextdo-cew.pages.dev) | 支持 Chrome / Safari / Edge 等现代浏览器<br>可直接「添加至主屏幕」享受独立窗口与离线秒开 |
| **iOS** | iPhone / iPad | [📲 Safari 添加至主屏幕](https://nextdo-cew.pages.dev) | 无需 App Store，使用 Safari 打开网页版并点击「分享」→「添加到主屏幕」即可像原生 App 一样全屏使用、离线存取与支持提醒 |

<details>
<summary><b>💡 首次安装与安全提示（macOS / Windows）</b></summary>

- **macOS 提示「无法打开，因为无法验证开发者」**：
  Nextdo 是开源免费项目，未购买商业开发者证书。若遇到系统拦截，可在访达中**按住 Control 键右键点击 Nextdo.app**，选择「打开」；或在终端执行命令解除隔离属性：
  ```bash
  xattr -cr /Applications/Nextdo.app
  ```
- **Windows 提示「Windows 已保护你的电脑」**：
  若触发 SmartScreen 提示，点击窗口中的**「更多信息」**，然后点击**「仍要运行」**即可正常安装。
- **Linux AppImage 无法直接启动**：
  下载后请赋予执行权限：
  ```bash
  chmod +x Nextdo_*.AppImage && ./Nextdo_*.AppImage
  ```
</details>

### 📱 极简 PWA 与 iOS 主屏幕安装（免 App Store）

Nextdo 已全面支持渐进式 Web 应用（Progressive Web App, PWA）。**iPhone / iPad 用户无需通过 App Store**，使用 Safari 浏览器即可一键安装为独立全屏 App：

1. **在线访问**：使用 iPhone Safari 打开 **[https://nextdo-cew.pages.dev](https://nextdo-cew.pages.dev)**。
2. **添加到主屏幕**：
   - 点击 Safari 底部工具栏的 **「分享」** 按钮（带有向上箭头的图标 ⎋）；
   - 在菜单中向下滑动，选择 **「添加到主屏幕」**（带有 ⊞ 标志）；
   - 点击右上角「添加」，主屏幕即生成 Nextdo 原生应用图标。
3. **原生级完整体验**：
   - 📲 **独立全屏沉浸窗口**：自动隐藏浏览器地址栏与底栏，交互手感与原生应用无异，已完美适配 iPhone 灵动岛、刘海屏与底部手势安全区；
   - ⚡ **离线秒开与本地 SQLite 数据库**：数据首要存储于浏览器本地 OPFS / IndexedDB 数据库中，断网也可极速读写，重连后自动双向增量同步；
   - 🔔 **准时任务提醒**：在主屏幕独立窗口模式下完整适配 iOS 16.4+ Web Push，支持稍后与日历行动定时通知。

---

## ☁️ 多端同步与自托管

Nextdo 专为个人设计了极简的多端同步方案，既可零成本免维护白嫖云服务，也可在自备服务器上一键容器化部署：

### 方案 A：零成本 Serverless 免费云同步（最推荐 · 纯网页搞定）
利用三大主流云平台的**永久免费套餐**搭建，**无需服务器、无需终端命令、无需下载源码**：
- **数据库**：[Neon](https://neon.tech/)（免费 PostgreSQL，自动初始化 14 张业务表，无需写建表 SQL）
- **同步引擎**：[PowerSync Cloud](https://powersync.com/)（免费流引擎，实时同步增量）
- **后端网关**：[Cloudflare Workers](https://dash.cloudflare.com/)（全球边缘计算，在线粘贴代码一键发布）

> 📖 **完整图文教程**：
> - 📄 **[飞书云文档：Nextdo 零成本私有云同步搭建指南（推荐 · 纯网页全流程）](https://my.feishu.cn/wiki/FDWJwoCHsiBgltk0sW4cKs47nKb?from=from_copylink)**
> - 📝 [仓库 Markdown 文档：零成本免费云同步完整部署指南](./server/deploy/FREE_CLOUD_DEPLOY.md)
>
> 🔔 **想要飞书 / 微信提醒？** 有 DDL 的任务除 app 与日历提醒外，还可额外推到飞书自定义机器人或个人微信（经 PushPlus 中转，免费版每天 200 条）。配置入口在部署完成后的 Worker 控制台：**Settings → Triggers → Cron Triggers** 建一个 `* * * * *`，再在 **Variables and Secrets** 里填通道密钥。详见 [部署指南「可选：开启外部提醒通道」](./server/deploy/FREE_CLOUD_DEPLOY.md#可选开启外部提醒通道飞书--个人微信)。

### 方案 B：私有 VPS 单机一键 Docker 部署
如果你拥有一台 Linux VPS，可使用单机版 Docker Compose 一键拉起完整后端服务：
> 📖 **Docker 部署文档**：查看 [Production Deployment 文档](./server/deploy/README.md)。

### 多端秒级扫码配对
1. 在首台设备（如 Mac 电脑）的「设置」中输入你的服务网址，点击连接即可完成免密绑定；
2. 在第二台设备（如手机）打开设置，直接扫描电脑屏幕生成的二维码，秒级加入同一同步账本！

---

## 🛠️ 技术架构

Nextdo 采用现代化的 TypeScript Monorepo 架构设计，逻辑分层解耦，保证极致的性能与多端复用能力：

```
Nextdo Monorepo
├── apps/
│   ├── mobile/         # 核心客户端：Expo (React Native 0.86 / iOS / Android / Web)
│   └── desktop/        # 桌面壳工程：Tauri v2 (Rust 编写的高性能轻量桌面容器)
├── packages/
│   ├── core/           # 纯领域内核：GTD 状态机、Now 推荐评分算法、无外部副作用
│   ├── db/             # 数据持久层：PowerSync + SQLite + Kysely 查询构建器
│   └── ui/             # 共享跨端设计系统：Tailwind CSS / NativeWind 原子化组件
└── server/
    ├── app/            # Hono 轻量 API 运行时 (认证下发、数据上报)
    └── deploy/         # Cloudflare Workers 部署包与 Docker Compose 配置
```

- **前端技术栈**：React 19、React Native 0.86、Expo SDK 57、NativeWind 4 (Tailwind CSS)
- **桌面容器**：Tauri v2
- **本地存储与同步**：SQLite (`@op-engineering/op-sqlite`)、PowerSync (`@powersync/react-native` / `@powersync/web`)
- **服务端**：Hono、Cloudflare Workers、PostgreSQL 16

---

## 💻 本地开发指南

如果你希望参与 Nextdo 的功能开发或自行编译定制版本，可参考以下步骤：

### 准备环境
- Node.js `>= 22.13`
- pnpm `>= 12.5.1`
- （如需编译桌面端）Rust 1.78+ 及 Cargo

### 快速起步
```bash
# 1. 克隆代码仓库
git clone https://github.com/printsdf/Nextdo.git
cd Nextdo

# 2. 安装项目依赖
pnpm install

# 3. 运行代码检查与全量测试套件
pnpm lint
pnpm typecheck
pnpm test

# 4. 启动移动端/Web端开发服务器
cd apps/mobile
pnpm start        # 交互式菜单（按 w 启动 Web 模式，按 a 启动 Android，按 i 启动 iOS）

# 5. （可选）启动桌面端 Tauri 调试
cd ../desktop
pnpm dev
```

---

## 🗺️ 路线图 (Roadmap)

- [x] GTD 完整生命周期闭环（收集箱、向导式厘清、项目拆解）
- [x] 智能当下推荐引擎（时间约束与多维权重精算）
- [x] 21 天习惯契约与项目联动追踪
- [x] 全屏极简心流专注模式
- [x] 双轨日常与每周系统复盘
- [x] 本地优先与全自动零成本多端云同步
- [x] 多端设备二维码扫码配对
- [ ] 外部日历导入与系统日历双向互通 (CalDAV / Google Calendar / Apple Calendar)
- [ ] 本地自然语言快速捕获解析（如“明天下午三点跟张三开会”）
- [ ] 专注时长热力图与长期统计报表
- [ ] 跨平台全局快捷捕获呼出栏

---

## 🤝 参与贡献

我们非常欢迎各种形式的社区贡献！无论是提出新想法、报告 Bug 还是提交代码改进：
1. 提交 [Issue](https://github.com/printsdf/Nextdo/issues) 提出你的功能建议或缺陷反馈；
2. Fork 本仓库，创建新的特性分支（`git checkout -b feat/awesome-feature`）；
3. 遵循现有的代码规范与测试流程，提交变更；
4. 开启 Pull Request，我们会在第一时间进行 Review 与讨论。

---

## 💖 致谢与鸣谢

特别感谢 **[TopBook](https://topbook.cc/)** 团队长期以来在高效工作流、个人知识管理与 GTD 哲学普及上的卓越分享，为 Nextdo 的产品理念与心流设计提供了深刻的启发。

---

## 📄 开源协议

本项目采用 [MIT 许可证](./LICENSE) 开源，允许商业与非商业场景下的自由使用、修改与分发。

---

<div align="center">
  <sub>如果 Nextdo 帮助你找回了专注与心流，欢迎在 GitHub 上为我们点亮一颗 ⭐️！</sub>
</div>
