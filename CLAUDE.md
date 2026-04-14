# DevForge 项目说明

## 项目概述

DevForge 是一个基于 **Tauri 2** 的桌面开发者工具，整合了数据库管理、SSH 终端、SFTP 文件传输、Redis 缓存管理、Git 版本控制、截图标注等功能模块，定位为对标 Navicat + DataGrip + FileZilla + Redis Desktop 的一体化工具。

- **版本**：0.6.1
- **目标平台**：Windows（当前）

---

## 技术栈

### 前端（`src/`）
| 技术 | 版本 | 说明 |
|------|------|------|
| Vue 3 | ^3.5.24 | 前端框架（Composition API） |
| TypeScript | ~5.9.3 | 类型系统 |
| Vite | ^7.2.4 | 构建工具 |
| Tailwind CSS | ^4.1.18 | 原子化样式 |
| Reka UI | ^2.8.0 | 无头组件库（shadcn/vue 底层） |
| Pinia | ^3.0.4 | 状态管理 |
| Vue Router | ^5.0.2 | 路由 |
| @tanstack/vue-table | ^8.21.3 | 表格（含虚拟滚动） |
| Monaco Editor | ^0.55.1 | 代码编辑器 |
| @xterm/xterm | ^6.0.0 | WebGL 终端 |
| @vue-flow/core | ^1.48.2 | 可视化流程图（ER 图、SQL Builder） |
| ECharts | ^6.0.0 | 数据可视化 |
| Vue i18n | ^11.2.8 | 国际化（中/英） |
| Tesseract.js | ^7.0.0 | OCR 文字识别 |
| Vitest | ^4.1.0 | 单元测试 + happy-dom |

### 后端（`src-tauri/`）
| 技术 | 版本 | 说明 |
|------|------|------|
| Tauri | 2.10.0 | 桌面应用框架 |
| Rust | edition 2021, ≥1.77.2 | 系统编程语言 |
| Tokio | 1 | 异步运行时 |
| SQLx | 0.8 | 数据库驱动（MySQL/PostgreSQL/SQLite） |
| Russh | 0.48 | SSH/SFTP 协议 |
| Redis | 0.27 | Redis 客户端（含集群） |
| Git2 | 0.19 | Git 操作（libgit2） |
| Xcap + Image | 0.5 | 屏幕截图 |
| Portable-pty | 0.8 | 本地 Shell（Windows ConPTY） |
| Keyring | 3 | Windows 凭据管理 |
| Rust-xlsxwriter | 0.79 | Excel 导出 |

---

## 目录结构

```
devforge/
├── src/                        # 前端 Vue 源码
│   ├── api/                    # Tauri invoke 封装（27 个模块）
│   ├── components/             # 通用组件（~260 个）
│   │   ├── database/           # 数据库相关（查询面板、表编辑器、ER 图、Schema 对比、性能监控、数据同步等）
│   │   ├── file-manager/       # SFTP 文件管理
│   │   ├── git/                # Git 操作组件
│   │   ├── redis/              # Redis 数据类型编辑器
│   │   ├── screenshot/         # 截图标注 OCR
│   │   ├── terminal/           # 终端组件 + 服务器监控仪表盘
│   │   └── ui/                 # shadcn/vue 基础 UI 组件
│   ├── composables/            # Vue composables（45 个）
│   ├── stores/                 # Pinia 状态管理（11 个 store）
│   ├── views/                  # 页面视图（14 个）
│   │   ├── DatabaseView.vue    # 数据库管理
│   │   ├── FileManagerView.vue # SFTP 文件管理
│   │   ├── TerminalView.vue    # SSH 远程终端
│   │   ├── LocalTerminalView.vue # 本地 Shell 终端
│   │   ├── RedisView.vue       # Redis 缓存管理
│   │   ├── GitView.vue         # Git 版本控制
│   │   ├── MultiExecView.vue   # 多主机批量执行
│   │   ├── TunnelView.vue      # SSH 隧道管理
│   │   ├── ScreenshotView.vue  # 截图标注
│   │   ├── TerminalPlayerView.vue # 终端录制回放
│   │   ├── SettingsView.vue    # 设置页
│   │   └── WelcomeView.vue     # 欢迎页
│   ├── types/                  # TypeScript 类型定义（29 个）
│   └── locales/                # i18n 语言包（中/英）
├── src-tauri/
│   └── src/
│       ├── commands/           # Tauri 命令（32 个模块）
│       │   ├── db/             # 数据库（admin、metadata、query、tools）
│       │   ├── ssh.rs          # SSH 连接与执行
│       │   ├── sftp.rs         # SFTP 文件操作
│       │   ├── redis.rs        # Redis 全数据类型操作
│       │   ├── git.rs          # Git 版本控制
│       │   ├── screenshot.rs   # 屏幕截图
│       │   ├── local_shell.rs  # 本地 Shell
│       │   ├── tunnel.rs       # SSH 隧道
│       │   ├── scheduler.rs    # 定时任务
│       │   └── ...             # 其他命令模块
│       ├── services/           # 核心业务逻辑（40 个服务）
│       │   ├── db_drivers/     # MySQL、PostgreSQL、SQLite 驱动
│       │   ├── db_engine/      # 数据库引擎（查询、元数据、导入导出、性能分析、索引建议）
│       │   ├── redis_engine.rs # Redis 引擎
│       │   ├── git_engine.rs   # Git 引擎
│       │   ├── sftp_engine.rs  # SFTP 引擎
│       │   ├── ssh_engine.rs   # SSH 连接引擎
│       │   ├── screenshot_engine.rs # 截图引擎
│       │   ├── local_shell_engine.rs # 本地 Shell 引擎
│       │   ├── ssh_tunnel.rs   # SSH 隧道
│       │   ├── storage.rs      # 本地 SQLite 存储
│       │   ├── credential.rs   # 凭据管理
│       │   ├── scheduler.rs    # 定时任务调度
│       │   ├── transfer_manager.rs # 文件传输管理
│       │   └── ...             # 其他服务
│       ├── models/             # 数据模型定义
│       └── utils/              # 工具函数
└── public/                     # 静态资源
```

---

## 功能模块

| 模块 | 状态 | 说明 |
|------|------|------|
| 数据库管理 | ✅ 完成 | MySQL/PostgreSQL/SQLite 查询、表编辑、备份恢复、导入导出、ER 图、性能分析、索引建议、Schema 对比迁移（多选筛选 + 表级开关 + SQL 联动）、数据同步 |
| SSH 终端 | ✅ 完成 | 远程命令执行、终端录制回放、命令片段、服务器监控仪表盘（CPU/内存/磁盘/网络实时图表） |
| SFTP 文件管理 | ✅ 完成 | 文件上传下载、书签、权限管理、文件 diff、远程文件编辑 |
| 批量执行 | ✅ 完成 | 多主机并发命令执行 |
| 本地终端 | ✅ 完成 | Windows ConPTY 本地 Shell |
| SSH 隧道 | ✅ 完成 | 本地/远程端口转发 |
| 定时任务 | ✅ 完成 | Cron 表达式调度 |
| Redis 客户端 | ✅ 完成 | 全数据类型、PubSub、Cluster、Sentinel、Monitor、Lua 脚本、内存分析 |
| Git 客户端 | ✅ 完成 | 提交、分支、合并、Rebase、Blame、图形化历史 |
| 截图标注 | 🔧 开发中 | 屏幕/区域截图、标注工具、OCR、翻译 |
| SQL Builder | 🔧 开发中 | 可视化 SQL 查询构建器（Vue Flow） |

---

## 常用命令

```bash
# 前端开发（单独运行 Vite）
pnpm dev

# Tauri 开发模式（前后端联调）
pnpm tauri:dev

# 构建生产包
pnpm tauri:build

# 仅检查 Rust 编译
cargo check --manifest-path src-tauri/Cargo.toml

# 前端测试
pnpm test

# TypeScript 类型检查
pnpm build  # 触发 vue-tsc
```

---

## 关键约定

### Rust 后端
- 错误类型统一使用 `anyhow::Error` 或自定义 `AppError`
- Tauri 命令返回 `Result<T, String>`（错误序列化为字符串）
- 数据库操作避免 `sqlx::query()` 对 `USE`/`SET`/`BEGIN` 等语句（走 prepared statement 协议，MySQL 会报 1295 错误），改用 `sqlx::raw_sql()` 或 `execute_unprepared()`
- SFTP/SSH 使用 russh 异步 API，注意跨任务 Send 约束
- 新增服务引擎放 `services/` 下，对应命令放 `commands/` 下

### 前端
- 组件命名：PascalCase
- Composable 命名：`use` 前缀（如 `useConnection`）
- 状态通过 Pinia store 管理，避免 prop drilling
- 表格大数据量使用 @tanstack/vue-virtual 虚拟滚动
- UI 基础组件基于 shadcn/vue（Reka UI + Tailwind），风格为 new-york / zinc

### 数据库
- 本地配置数据存储在 SQLite（由 `storage.rs` 管理）
- 用户连接的外部数据库通过 `db_engine/` 动态连接
- 连接凭据通过 Windows Credential Manager 加密存储

---

## 已知问题 / 注意事项

- MySQL `USE` 语句需用 `execute_unprepared()` 执行，不能走 prepared statement
- Rust 编译较慢，`cargo check` 优先用于验证，完整构建用 `tauri:build`
- Windows 平台，路径分隔符注意兼容性
- 后端错误统一使用 `ensureErrorString()` 提取错误信息，避免 `String()` 导致 `[object Object]`
- Schema 对比的 `diff_column` 箭头方向为「目标当前值 → 源端目标值」（迁移方向）
- ECharts 在 Tauri WebView 中不支持 oklch 色值，需通过 `getCssColor()` 转换为 hex

---

## Design Context

> 由 Impeccable `/teach-impeccable` 生成，详见 [.impeccable.md](.impeccable.md)

### Users
- **目标用户**：通用 IT 人员 —— 开发者、运维工程师、DBA、测试人员
- **使用场景**：日常开发运维中管理数据库、SSH 远程连接、SFTP 文件传输、Redis 缓存、Git 版本控制、批量命令执行
- **核心诉求**：一个工具替代多款工具，减少切换，提高效率
- **使用频率**：工作日全天高频使用，长时间驻留桌面

### Brand Personality
- **品牌个性**：专业 · 高效 · 精致
- **语气**：沉稳可靠但不刻板，现代新颖但不花哨
- **情感目标**：安心、掌控感、专注

### Aesthetic Direction
- **视觉调性**：JetBrains / DataGrip 风格 —— 信息密度高、功能分区清晰、暗色主题为主
- **主题**：暗色优先（dark-first）
- **配色基底**：zinc 色系（oklch），蓝紫色调微妙偏移（hue ~286）
- **反面参考**：不要消费级 SaaS 大留白、不要 Electron 套壳感、不要 AI 味设计

### Design Principles
1. **信息密度优先** — 每一像素为信息服务，紧凑不等于拥挤
2. **操作零等待** — 所有交互有即时反馈，不让用户等、不让用户猜
3. **键盘优先** — 快捷键覆盖高频操作，Tab 导航清晰，命令面板随时可达
4. **沉稳不花哨** — 动效克制有目的，彩色仅用于语义。但鼓励添加精心设计的装饰细节（industrial-grid、noise-texture、状态脉冲点、hover 微交互）来提升高级感和品牌辨识度
5. **一致到像素** — 间距、圆角、阴影、字号全走 design tokens，模块间统一视觉语言
