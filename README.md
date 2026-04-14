# DevForge

DevForge 是一款基于 **Tauri 2 + Vue 3** 构建的现代化开发者工具箱，致力于为开发者提供一体化的服务器运维、数据库管理、文件传输以及多终端执行环境。

**一个工具替代** Navicat + DataGrip + FileZilla + Redis Desktop + SourceTree，减少工具切换，提升工作效率。

## ✨ 核心特性

- **🗄️ 数据库管理**：支持 MySQL / PostgreSQL / SQLite，内置查询面板、表编辑器、ER 图、备份恢复、导入导出、性能分析、索引建议、Schema 对比迁移、SQL Builder
- **💻 SSH 终端**：集成 Xterm.js WebGL 终端，全功能 SSH 远程终端、终端录制回放、命令片段
- **📁 SFTP 文件管理**：双栏文件浏览器，分块传输队列、书签、权限管理、远程文件编辑
- **⚡ 批量执行**：多主机并发命令执行，适用于批量运维场景
- **🔴 Redis 客户端**：全数据类型编辑、PubSub、Cluster 集群、Sentinel 哨兵、Monitor 实时监控、Lua 脚本、内存分析
- **📦 Git 客户端**：提交、分支、合并、Rebase、Blame、图形化提交历史
- **🔗 SSH 隧道**：本地/远程端口转发
- **⏰ 定时任务**：Cron 表达式调度执行
- **🖥️ 本地终端**：Windows ConPTY 本地 Shell
- **📸 截图标注**：屏幕/区域截图、标注工具、OCR 文字识别
- **🎨 现代化 UI**：Tailwind CSS + Reka UI，暗色主题优先，信息密度高
- **🌍 多语言支持**：中文 / English 双语

## 🛠️ 技术栈

### 前端
- **Vue 3** (Composition API / `<script setup>`) + **TypeScript**
- **Vite** 构建 + **Tailwind CSS v4** 样式
- **Pinia** 状态管理 + **Vue Router** 路由
- **Monaco Editor** 代码编辑器
- **@xterm/xterm** WebGL 终端引擎
- **@tanstack/vue-table** 数据表格（含虚拟滚动）
- **@vue-flow/core** 可视化流程图（ER 图、SQL Builder）
- **ECharts** 数据可视化
- **Reka UI** 无头组件库（shadcn/vue 底层）

### 后端 (Rust)
- **Tauri 2** 桌面应用框架
- **SQLx** 数据库驱动（MySQL/PostgreSQL/SQLite）
- **Russh** SSH/SFTP 异步协议
- **Redis** 客户端（含集群支持）
- **Git2** Git 操作（libgit2 绑定）
- **Tokio** 异步运行时

## 🚀 快速开始

### 环境依赖

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/)（推荐）或 npm
- [Rust](https://www.rust-lang.org/) >= 1.77.2

### 开发

```bash
# 安装依赖
pnpm install

# Tauri 开发模式（前后端联调）
pnpm tauri:dev

# 仅前端开发预览（无 Tauri 桥接）
pnpm dev
```

### 构建

```bash
# 生产构建，输出安装包（.exe / .msi）
pnpm tauri:build
```

## 📁 项目结构

```text
devforge/
├── src/                        # 前端 Vue 源码
│   ├── api/                    # Tauri invoke 封装（27 个模块）
│   ├── components/             # 功能组件（~260 个）
│   │   ├── database/           # 数据库（查询、表编辑、ER 图、Schema 对比、性能分析等）
│   │   ├── terminal/           # 终端 + 服务器监控
│   │   ├── file-manager/       # SFTP 文件管理
│   │   ├── redis/              # Redis 数据编辑器
│   │   ├── git/                # Git 操作组件
│   │   ├── screenshot/         # 截图标注 OCR
│   │   └── ui/                 # shadcn/vue 基础 UI
│   ├── composables/            # Vue composables（45 个）
│   ├── stores/                 # Pinia 状态管理（11 个 store）
│   ├── views/                  # 页面视图（14 个）
│   ├── types/                  # TypeScript 类型定义（29 个）
│   └── locales/                # i18n 语言包（中/英）
├── src-tauri/
│   └── src/
│       ├── commands/           # Tauri 命令（32 个模块）
│       ├── services/           # 核心业务服务（40 个）
│       ├── models/             # 数据模型
│       └── utils/              # 工具函数
└── public/                     # 静态资源
```

## 🤝 参与贡献

欢迎提交 **Issues** 或创建 **Pull Requests** 参与贡献。

---

_**DevForge** — 引领高效工作流，为您锻造卓越的代码开发体验。_
