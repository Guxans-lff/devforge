# DevForge 全面优化提升方案

## 背景

DevForge 目前是一个功能丰富的开发者工具箱（Tauri + Vue 3 + Rust，30,000+ 行代码），集成了数据库客户端、SSH 终端、SFTP 文件管理等功能。但对标 Navicat、DBeaver、DataGrip、Termius、FinalShell 等竞品，在功能完备性、工程质量、商业化能力方面仍有显著提升空间。

---

## 一、功能缺失（竞品有我们没有的）

### 1. 多数据库引擎支持 [P0-P2]
- **现状**：仅支持 MySQL + PostgreSQL（`src-tauri/src/services/db_drivers/` 下只有两个驱动）
- **对标**：DBeaver 支持 80+ 种，Navicat 支持 7 种
- **建议**：
  - P0：SQLite 支持（sqlx 已有基础，开发者最常用本地数据库）
  - P1：SQL Server/MSSQL（企业市场刚需，引入 tiberius crate）
  - P2：Redis、MongoDB（需要完全不同的协议层）

### 2. ER 图 / 数据库可视化 [P1]
- **现状**：完全没有数据模型可视化
- **对标**：Navicat 有完整模型设计器；DBeaver/DataGrip 支持 ER 图自动生成
- **建议**：基于 `@vue-flow/core` 或 `elkjs` + 已有的外键信息生成
- **难度**：中

### 3. 数据生成器 / Mock Data [P2]
- **现状**：无
- **对标**：Navicat 有完整数据生成器；DBeaver 有 Mock Data 插件
- **建议**：基于已有 `get_columns` 接口获取表结构，实现随机数据生成

### 4. 自动更新机制 [P0]
- **现状**：完全没有更新机制
- **对标**：几乎所有桌面应用都有
- **建议**：使用 Tauri 官方 `tauri-plugin-updater` + GitHub Releases
- **难度**：低

### 5. 连接配置云同步 [P2]
- **现状**：仅本地 JSON 导入导出（`ImportExportSettings.vue`）
- **对标**：Termius 的核心卖点之一

### 6. 定时任务 / 计划执行 [P2]
- **现状**：无
- **对标**：Navicat 的"自动运行"功能

### 7. SQL 调试器 / 存储过程调试 [P3]
- **现状**：可查看定义但无法调试
- **对标**：DataGrip、Navicat 支持断点调试

---

## 二、现有功能优化提升

### 1. AI SQL 编辑器增强 [P1]
- **现状**：`useSqlCompletion.ts` 仅做静态关键字补全；`models/ai.rs` 已预留 AI 模型但未集成
- **对标**：DataGrip 智能补全；Beekeeper Studio 集成 AI SQL 生成
- **建议**：
  - 集成 AI 自然语言转 SQL
  - SQL 语法错误实时提示
  - 上下文感知的智能补全

### 2. 查询结果体验优化 [P1]
- **现状**：`QueryResult.vue`（923 行）基础表格
- **对标**：Navicat 单元格内预览大文本/JSON/Blob；TablePlus 数据网格
- **建议**：
  - 单元格内查看大文本/JSON/图片（Blob 预览）
  - 行转列查看（单行详情面板）
  - 结果集客户端侧筛选/排序/分组
  - 数据可视化图表（柱状图/饼图）

### 3. 大文件组件拆分 [P1]
- **现状**：5 个组件严重超标（项目规范 800 行上限）
  - `QueryPanel.vue` — 1,359 行
  - `TableEditorPanel.vue` — 1,314 行
  - `UserManagementPanel.vue` — 1,215 行
  - `ObjectTree.vue` — 999 行
  - `QueryResult.vue` — 923 行
- **建议**：按功能域拆分为子组件 + composable

### 4. 终端体验增强 [P1-P2]
- **P1**：本地 Shell 支持（不需要 SSH 连接也能用终端）
- **P2**：ZMODEM 文件传输（sz/rz）、终端标签自定义颜色

### 5. SFTP 功能增强 [P2]
- 远程文件压缩/解压
- 符号链接显示与跟踪
- 远程文件内容搜索（grep）

---

## 三、用户体验提升

### 1. Onboarding 新手引导 [P1]
- **现状**：`WelcomeView.vue` 只是静态首页
- **建议**：首次使用的交互式引导（Feature Tour），使用 `driver.js` 或自建

### 2. 全局搜索增强 [P1]
- **现状**：`CommandPalette.vue` 功能较基础
- **对标**：DataGrip 的"Search Everywhere"
- **建议**：支持搜索数据库对象、查询历史、SQL 片段、快速切换连接

### 3. 连接环境标记 [P1]
- **现状**：`Connection` 模型有 `color` 字段但未充分利用
- **建议**：
  - 环境标记（生产/测试/开发），防止误操作
  - 连接标签页颜色标记
  - 生产环境执行危险操作需二次确认

### 4. 拖放优化 [P2]
- 拖拽表名到 SQL 编辑器自动生成 SELECT
- 拖拽列名插入到 SQL

### 5. 多窗口支持 [P2]
- **现状**：`tauri.conf.json` 只定义单窗口
- **建议**：支持弹出独立窗口（查询结果/终端）

---

## 四、技术架构优化

### 1. 测试体系建设 [P0] ← 最紧迫
- **现状**：全项目仅 3 个单元测试，覆盖率 ≈ 0%
- **建议**：
  - 前端：Vitest 单元测试（stores、composables、utils 优先）
  - Rust 端：单元测试 + 集成测试
  - E2E 测试（Playwright）
  - CI 流水线（GitHub Actions）

### 2. 错误处理统一化 [P1]
- **现状**：`error.rs` 仅 5 种错误类型，`Other(String)` 吞掉大量具体错误
- **建议**：细化错误类型（SSH 错误、SFTP 错误、传输错误等）+ 前端统一错误边界

### 3. 状态持久化迁移 [P1]
- **现状**：`settings.ts` 和 `workspace.ts` 使用 `localStorage`（Tauri WebView 升级时可能丢失）
- **建议**：迁移到 `tauri-plugin-store` 后端存储

### 4. 性能优化 [P1]
- 连接池预热和健康检查
- `SshTunnelEngine` 和 `TerminalRecorder` 从 Mutex 改为 RwLock
- 大数据集查询内存优化

### 5. 日志和可观测性 [P1]
- 结构化日志（性能指标、查询耗时统计）
- 崩溃报告收集（可选匿名）

### 6. 插件/扩展体系 [P3]
- 长期目标：允许第三方扩展数据库驱动、主题、格式化规则

---

## 五、安全性提升

### 1. 凭据加密跨平台 [P0]
- **现状**：`credential.rs` 仅配置 Windows（`Cargo.toml` 只配了 `windows-native`）
- **建议**：验证并适配 macOS Keychain 和 Linux Secret Service

### 2. 生产环境保护 [P0]
- DELETE/DROP/TRUNCATE 二次确认（输入连接名）
- 生产环境只读模式
- 操作审计日志

### 3. 数据传输加密 [P1]
- SSL 连接默认启用（当前 `SslMode` 默认可为 `Disabled`）
- 导出配置文件加密（当前明文 JSON）
- 本地 SQLite 数据库加密（`sqlcipher`）

### 4. CSP 策略优化 [P2]
- 评估 `unsafe-eval` 和 `unsafe-inline` 的替代方案

---

## 六、商业化和运营

### 1. 官网和文档 [P0]
- 产品官网（VitePress/Astro）
- 在线文档和教程
- 更新日志

### 2. CI/CD 和分发 [P0]
- GitHub Actions 自动构建三平台安装包
- 代码签名（Windows + macOS notarization）
- 发布到 WinGet / Homebrew

### 3. 定价模型 [P1]
- Free：基础连接（限 3 个）+ SSH + SFTP
- Pro：无限连接 + AI SQL + 备份恢复 + 模式对比 + 云同步
- Enterprise：SSO + 团队共享 + 审计日志

### 4. License 系统 [P1]
- RSA 签名 + 机器指纹绑定
- 试用期管理

### 5. 国际化完善 [P2]
- 检查硬编码中文
- 增加日语、韩语

---

## 优先级总览

### P0（阻塞发布，立即启动）
| # | 项目 | 难度 | 说明 |
|---|------|------|------|
| 1 | 测试体系建设 | 中 | 30,000+ 行代码零覆盖，最大技术风险 |
| 2 | 自动更新机制 | 低 | tauri-plugin-updater，发布必备 |
| 3 | CI/CD 自动构建 | 中 | 三平台构建 + 代码签名 |
| 4 | 官网和文档 | 低 | 产品发布前提 |
| 5 | 凭据加密跨平台 | 中 | macOS/Linux 发布前必须适配 |
| 6 | 生产环境保护 | 中 | 防止误操作生产数据库 |
| 7 | SQLite 数据库支持 | 中 | 开发者最常用本地数据库 |

### P1（核心竞争力，近期推进）
| # | 项目 | 难度 |
|---|------|------|
| 1 | AI SQL 编辑器增强 | 中 |
| 2 | ER 图可视化 | 中 |
| 3 | 查询结果体验优化 | 中 |
| 4 | 大文件组件拆分 | 中 |
| 5 | Onboarding 引导 | 低 |
| 6 | 全局搜索增强 | 中 |
| 7 | 连接环境标记 | 低 |
| 8 | 错误处理统一化 | 中 |
| 9 | 状态持久化迁移 | 中 |
| 10 | 性能优化 | 中 |
| 11 | 日志可观测性 | 低 |
| 12 | 终端本地 Shell | 中 |
| 13 | 定价模型 + License | 高 |
| 14 | 数据传输加密 | 中 |

### P2（增强体验，中期推进）
SQL Server 支持、云同步、定时任务、数据生成器、SFTP 增强、拖放优化、多窗口、国际化完善、CSP 优化、Redis/MongoDB 支持

### P3（长期规划）
存储过程调试器、插件/扩展体系

---

## 关键文件参考

| 文件 | 说明 |
|------|------|
| `src-tauri/src/services/db_engine/mod.rs` | 数据库引擎核心，扩展多数据库 |
| `src-tauri/src/services/db_drivers/` | 数据库驱动目录，新增驱动在此 |
| `src-tauri/src/utils/error.rs` | 错误处理，仅 5 种类型需扩展 |
| `src-tauri/src/services/credential.rs` | 凭据安全核心 |
| `src-tauri/tauri.conf.json` | 应用配置入口 |
| `src/components/database/QueryPanel.vue` | 1,359 行，需拆分 |
| `src/components/database/QueryResult.vue` | 923 行，需增强 |
| `src/composables/useSqlCompletion.ts` | SQL 补全，AI 集成入口 |
| `src/stores/settings.ts` | 持久化迁移 |
| `src/stores/workspace.ts` | 持久化迁移 |
| `src/models/ai.rs` | AI 模型预留 |
| `src/views/WelcomeView.vue` | Onboarding 改造入口 |
| `src/components/layout/CommandPalette.vue` | 全局搜索增强入口 |

---

## 验证方式

由于这是一份全面的优化规划文档而非具体的代码变更，验证方式为：
1. 老板审阅各优先级分类是否合理
2. 确认 P0 项目的排序和范围
3. 讨论商业化路线（免费开源 vs 商业化）
4. 选择首批要实施的 2-3 个优化点，进入具体技术方案设计
