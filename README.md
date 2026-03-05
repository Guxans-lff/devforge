# DevForge

DevForge 是一款基于 Tauri 和 Vue 3 构建的现代化开发者工具箱，致力于为开发者提供一体化的服务器运维、数据库管理、文件传输以及多终端执行环境。

## ✨ 核心特性

- **💻 强大的终端管理 (Terminal)**：集成原生级 Xterm.js，支持全功能 SSH 终端、字体设置、快速输入等流畅的命令行体验。
- **🗄️ 数据库客户端 (Database)**：支持多种类型数据库连接与管理，内置支持高级语法高亮的 SQL 查询面板 (QueryPanel)。
- **📁 可视化文件管理 (File Manager)**：直观清晰的文件浏览器，支持基于传输队列 (Transfer Queue) 的多任务安全传输。
- **⚡ 批量执行 (Multi Exec)**：应对多服务器管理难题，提供在多个目标实例中并发执行指令的功能。
- **📝 代码编辑与格式化**：深度集成 Monaco Editor 应对各类代码与脚本编写场景，并提供开箱即用的 SQL 格式化工具。
- **🎨 现代化交互界面**：采用 Tailwind CSS 和 Reka UI 构建无障碍、兼顾暗/亮色彩模式（Dark Mode）与舒适度的高度定制 UI。
- **🌍 多语言支持 (i18n)**：自带中英文等多语言国际化支持方案。

## 🛠️ 技术栈

- **桌面应用框架**：[Tauri](https://tauri.app/) 
- **核心前端框架**：[Vue 3](https://vuejs.org/) (Composition API / `<script setup>`) + [TypeScript](https://www.typescriptlang.org/)
- **构建工具**：[Vite](https://vitejs.dev/)
- **样式方案**：[Tailwind CSS v4](https://tailwindcss.com/)
- **状态管理 & 路由**：[Pinia](https://pinia.vuejs.org/) + [Vue Router](https://router.vuejs.org/)
- **重要库/组件**: 
  - `reka-ui` (无头组件库)
  - `@xterm/xterm` (终端引擎)
  - `monaco-editor` (编辑器基石)
  - `@tanstack/vue-table` (数据/分析表格)
  - `splitpanes` (自定义调整面板)
  - `lucide-vue-next` (图标库)

## 🚀 快速开始

### 环境依赖

在运行启动本机开发前，请确保您已安装并配置好以下环境：

- 现代浏览器 或 [Node.js](https://nodejs.org/) 开发环境
- 您偏好的包管理器 (`npm` / `yarn` / `pnpm` / `bun`)
- [Rust 与 Cargo](https://www.rust-lang.org/) (打包和运行 Tauri 后端系统必需)

### 开发部署

```bash
# 1. 安装所有项目依赖
npm install

# 2. 纯前端浏览器式开发预览 (无 Tauri 桥接功能)
npm run dev

# 3. 🕸️ 启动 Tauri 桌面应用进行完整环境无缝调试
npm run tauri:dev
```

### 项目构建发布

```bash
# 运行生产级构建，自动打包输出主流操作系统桌面客户端文件 (如 .dmg, .exe, .AppImage)
npm run tauri:build
```

## 📁 主要目录结构

```text
devforge/
├── src/                  # 前端层 (Vue 3 / TypeScript) 源码
│   ├── components/       # 功能模块及核心组件 (涵盖终端面板、数据库视图、文件管理器等)
│   ├── locales/          # i18n 多语言翻译文件包 (例如 en.ts / zh.ts 等)
│   ├── views/            # 核心业务主视图 (Terminal, Database, FileManager 等页面)
│   ├── router/           # 页面路由配置
│   ├── store/            # 全局 Pinia 模块定义
│   └── main.ts           # 核心装载入口
├── src-tauri/            # Tauri 桌面端底层支撑层代码 (Rust 语言编写后端及系统功能 API)
├── public/               # 无需构建的公共静态资源
├── package.json          # Node 依赖与预置脚本
├── tailwind.config.ts    # (可能存在) Tailwind 样式自定义变量与规范
└── tsconfig.json         # TS 根约束规则配置
```

## 🤝 参与贡献

我们欢迎社区力量共同成长！如果您有任何使用反馈、改进意见，或发现了潜在故障，请随时提交 **Issues** 或创建 **Pull Requests** 参与到代码建设中来。

---

_💡 **DevForge** - 引领高效工作流，为您锻造卓越的代码开发体验。_
