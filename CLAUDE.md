# DevForge 项目说明

## 项目概述

DevForge 是一个基于 **Tauri 2** 的桌面开发者工具，整合了数据库管理、SSH 终端和 SFTP 文件传输三大功能模块，定位为对标 Navicat + DataGrip + FileZilla 的一体化工具。

- **版本**：0.2.0
- **目标平台**：Windows（当前）

---

## 技术栈

### 前端（`src/`）
- **框架**：Vue 3 + TypeScript
- **构建工具**：Vite 7
- **UI 组件**：Tailwind CSS v4 + shadcn/vue（`components.json`）
- **状态管理**：Pinia（`src/stores/`）
- **路由**：Vue Router 5
- **表格**：@tanstack/vue-table + @tanstack/vue-virtual（虚拟滚动）
- **终端**：xterm.js（WebGL 渲染）
- **国际化**：vue-i18n（`src/locales/`）
- **测试**：Vitest + happy-dom

### 后端（`src-tauri/`）
- **框架**：Tauri 2 + Rust（edition 2021，rust-version 1.77.2）
- **异步运行时**：Tokio
- **数据库驱动**：sqlx 0.8（SQLite 本地存储 + MySQL + PostgreSQL）
- **SSH/SFTP**：russh 0.48 + russh-sftp 2.1
- **凭据管理**：keyring（Windows Credential Manager）
- **序列化**：serde + serde_json

---

## 目录结构

```
devforge/
├── src/                        # 前端 Vue 源码
│   ├── api/                    # Tauri invoke 封装
│   ├── components/             # 通用组件
│   ├── composables/            # Vue composables
│   ├── stores/                 # Pinia 状态管理
│   ├── views/                  # 页面视图
│   │   ├── DatabaseView.vue    # 数据库管理
│   │   ├── FileManagerView.vue # SFTP 文件管理
│   │   ├── TerminalView.vue    # SSH 终端
│   │   ├── MultiExecView.vue   # 多主机批量执行
│   │   └── SettingsView.vue    # 设置页
│   ├── types/                  # TypeScript 类型定义
│   └── locales/                # i18n 语言包
├── src-tauri/
│   └── src/
│       ├── commands/           # Tauri 命令（前后端入口）
│       ├── services/           # 核心业务逻辑
│       │   ├── db_drivers/     # 数据库驱动（MySQL、PostgreSQL、SQLite）
│       │   ├── db_engine/      # 数据库引擎（查询执行、结果处理）
│       │   ├── sftp_engine.rs  # SFTP 引擎
│       │   ├── sftp_handler.rs # SFTP 操作处理
│       │   ├── ssh_engine.rs   # SSH 连接引擎
│       │   ├── ssh_tunnel.rs   # SSH 隧道
│       │   ├── transfer_manager.rs # 文件传输管理
│       │   ├── storage.rs      # 本地 SQLite 存储
│       │   └── credential.rs   # 凭据管理
│       ├── models/             # 数据模型定义
│       └── utils/              # 工具函数
└── public/                     # 静态资源
```

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

### 前端
- 组件命名：PascalCase
- Composable 命名：`use` 前缀（如 `useConnection`）
- 状态通过 Pinia store 管理，避免 prop drilling
- 表格大数据量使用 @tanstack/vue-virtual 虚拟滚动

### 数据库
- 本地配置数据存储在 SQLite（由 `storage.rs` 管理）
- 用户连接的外部数据库通过 `db_engine/` 动态连接
- 连接凭据通过 Windows Credential Manager 加密存储

---

## 已知问题 / 注意事项

- MySQL `USE` 语句需用 `execute_unprepared()` 执行，不能走 prepared statement
- Rust 编译较慢，`cargo check` 优先用于验证，完整构建用 `tauri:build`
- Windows 平台，路径分隔符注意兼容性

---

## Design Context

> 由 Impeccable `/teach-impeccable` 生成，详见 [.impeccable.md](.impeccable.md)

### Users
- **目标用户**：通用 IT 人员 —— 开发者、运维工程师、DBA、测试人员
- **使用场景**：日常开发运维中管理数据库、SSH 远程连接、SFTP 文件传输、批量命令执行
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
