# DevForge 前后端审计报告（2026-04-23）

## 范围

- 前端：`src/` 下 Vue 3 + Pinia + Tauri API 调用链
- 后端：`src-tauri/src/` 下 Rust / Tauri / SQLx 数据库与 AI 服务链路
- 本次目标：检查当前前后端可继续优化的方向与明确缺陷，输出可执行结论

## 验证结果

- `pnpm exec vue-tsc --noEmit`：通过
- `cargo check`：失败
  - 阻塞点：`src-tauri/src/services/db_engine/meta.rs`
  - 错误：`postgres::get_foreign_keys` 不存在，导致 `tokio::try_join!` 推断失败
- `pnpm test -- --runInBand`：失败
  - 原因不是业务代码，而是 `vitest` 不支持 `--runInBand` 参数，当前脚本没有封装串行运行方式

## 高优先级缺陷

### 1. Rust 后端当前无法完整编译通过

- 位置：`src-tauri/src/services/db_engine/meta.rs:63`
- 现象：
  - PostgreSQL 分支调用了 `postgres::get_foreign_keys`
  - 但 `src-tauri/src/services/db_drivers/postgres.rs` 里没有对应实现
- 影响：
  - 当前数据库元数据 bundle 链路在 Rust 侧是阻塞状态
  - 任何依赖 `cargo check` / CI / 发版构建的流程都会失败
- 建议：
  - 优先补齐 `postgres::get_foreign_keys`
  - 再补一条 Rust 侧最小编译验证到 CI 或本地 pre-push 流程

### 2. 数据同步链路对 PostgreSQL 兼容性有明确风险

- 位置：`src-tauri/src/services/data_sync.rs:374`
- 现象：
  - `count_table_rows()` 固定使用 `quote_identifier(table, "mysql")`
  - 同文件其余 SQL 构造已按 `db_type` 分支处理
- 影响：
  - PostgreSQL 同步时，表名大小写或关键字场景可能直接失败
  - 该问题比性能问题更靠前，因为属于跨库逻辑不一致
- 建议：
  - `count_table_rows()` 改为先 `detect_db_type()`，再使用对应方言 quote
  - 给 MySQL / PostgreSQL 各补一条最小集成测试或构造 SQL 单测

### 3. 数据同步仍使用 `SELECT * + LIMIT/OFFSET`，大表性能与一致性风险仍在

- 位置：`src-tauri/src/services/data_sync.rs:406`
- 现象：
  - `build_select_sql()` 仍是 `SELECT * FROM ... LIMIT ... OFFSET ...`
  - 同步前还会额外执行 `COUNT(*)`
- 影响：
  - 大表同步会随着页数增加越来越慢
  - 在源表持续写入时，`OFFSET` 分页可能漏数或重数
  - `SELECT *` 也会放大无用列传输成本
- 建议：
  - 改为主键或稳定排序列驱动的 keyset/seek 分页
  - 至少允许按列清单而不是 `*` 拉取
  - 对超大表提供“关闭总数统计”或“估算总量”模式

## 中优先级优化项

### 4. `DatabaseView` 生命周期职责过重，连接、轮询、恢复、快捷键耦合过深

- 位置：`src/views/DatabaseView.vue:156-340`
- 现象：
  - 同一视图同时负责连接建立与断开、连接池轮询、workspace 恢复、schema cache 生命周期、全局快捷键注册、KeepAlive 激活/失活补偿
- 影响：
  - 行为正确性依赖多个生命周期钩子配合，后续改动很容易引入重复注册或状态漂移
  - 单元测试粒度也会被迫变粗
- 建议：
  - 提取 `useDatabaseConnectionLifecycle`
  - 提取 `usePoolStatusPolling`
  - 把“视图切换/连接恢复”逻辑从组件模板层挪到 composable

### 5. Rust 编译产物目录未被 `.gitignore` 明确屏蔽，存在误提交风险

- 证据：
  - 仓库中能扫描到大量 `src-tauri/target/**`
  - 但根 `.gitignore` 未包含 `src-tauri/target`
- 当前状态：
  - `git ls-files 'src-tauri/target/**'` 结果为 0，说明目前还没被正式纳入版本库
- 风险：
  - 后续很容易被误 add
  - 会显著污染仓库体积与 diff 可读性
- 建议：
  - 在根 `.gitignore` 或 `src-tauri/.gitignore` 明确补上 `target/`
  - 顺手把构建日志、check 输出这类一次性文件策略也统一

### 6. 测试命令封装不完整，影响团队验证一致性

- 现象：
  - `package.json` 只有 `vitest run`
  - 但没有串行/指定文件/类型检查的统一脚本
  - 本次 `pnpm test -- --runInBand` 直接失败，说明命令约定不稳定
- 影响：
  - 本地协作时容易出现“每个人运行方式不一样”
  - CI 很难直接复用本地经验
- 建议：
  - 增加脚本：`test:unit`、`test:typecheck`、`test:db-workspace`、`check:rust`
  - 文档中固定推荐命令，避免口头约定

## 低优先级但值得跟进的点

### 7. 开发期日志仍较分散，长期会拉低调试信噪比

- 现象：
  - `src/App.vue`、`src/main.ts`、`src/composables/useAnnotationCanvas.ts` 等仍保留多个 `console.log`
- 影响：
  - 虽然生产构建会 drop console，但开发环境日志会逐渐失控
- 建议：
  - 统一走 `src/utils/logger.ts`
  - 给数据库、AI、文件系统三类日志设前缀与级别

### 8. `any/as any/JSON.parse` 的边界仍偏多，说明类型边界尚未完全收口

- 典型位置：
  - `src/locales/index.ts`
  - `src/stores/workspace.ts`
  - `src/components/database/er-diagram/*`
  - 多处配置解析和跨窗口消息处理
- 影响：
  - 复杂功能继续迭代时，最容易在边界层积累隐性 bug
- 建议：
  - 优先给外部输入增加 schema 校验或类型守卫
  - 尤其是连接配置、AI provider 配置、工作区快照恢复

## 建议的下一步顺序

1. 先修 Rust 编译阻塞：补 `postgres::get_foreign_keys`，重新 `cargo check`
2. 修 `data_sync.rs` 的 PostgreSQL 方言错误：`count_table_rows()` 使用真实 `db_type`
3. 优化大表同步：从 `OFFSET` 分页迁移到 keyset/seek
4. 收敛 `DatabaseView.vue` 生命周期逻辑：拆 2-3 个 composable
5. 补工程治理：`.gitignore` 增加 `src-tauri/target`，统一测试/校验脚本

## 结论

当前前端整体处于“功能快速扩展后开始收敛”的阶段，数据库工作区的缓存和大表浏览方向已经明显变好，前端类型检查也能通过。真正的短板主要集中在两处：

- Rust 后端元数据链路还有编译阻塞，属于必须先处理的硬问题
- 数据同步链路在 SQL 方言与大表策略上仍偏保守，后续容易成为性能和稳定性瓶颈

如果只做一件事，优先把 Rust 侧 PostgreSQL 外键链路补齐并恢复 `cargo check` 绿灯。
