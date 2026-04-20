# DevForge 代码审查报告（处理状态版）

> 审查范围：`src/` 目录下的入口、路由、composables、stores、views、构建配置及部分产物相关建议。
> 复核时间：2026-04-20。
> 最近处理时间：2026-04-20。
> 当前结论：报告中可低风险落地的问题已处理一批；大型重构和需要实测数据支撑的优化暂缓。

---

## 一、处理摘要

### 已处理

1. `useMetadataCache` SWR 后台刷新不通知 UI。
2. `configJson` 多处重复解析。
3. `DatabaseView` 部分重型面板同步导入。
4. 连接池轮询未感知页面可见性。
5. `useToolApproval` 使用 `setInterval` 轮询等待。
6. `usePerformance.startPerformanceMonitoring` 空壳。
7. `App.vue` 中 `settingsStore` 重复声明。
8. `useSqlCompletion` 关键字数组重复。
9. `KeepAlive :max="10"` 缓存偏大。
10. `manualChunks` 可继续拆分。
11. Monaco Worker 使用 `&inline`。
12. 组件级 `v-show` 导致 Vue runtime warning。

### 暂缓

1. `useAiChat.ts` 大型 composable 拆分。
2. `useQueryResult.ts` 大型 composable 拆分。
3. `hashPath` 碰撞风险优化。
4. SQL 日志脱敏正则增强。
5. `zh-CN` 同步加载异步化。

### 不处理或原判断不成立

1. `echarts` 未做 tree-shaking。
2. `columnsEqual` 浅比较不完整。
3. `crypto.randomUUID()` 兼容性。

---

## 二、已处理问题

### 1. `useMetadataCache` SWR 后台刷新不通知 UI

**状态**：已处理
**优先级**：高
**位置**：

- `src/composables/useMetadataCache.ts`
- `src/composables/useObjectTree.ts`

**处理内容**：

1. 为 `fetchWithCache` 增加 `onRefresh` 回调能力。
2. 增加后台刷新去重，避免同一个 key 同时发起多个刷新请求。
3. 后台刷新成功后会更新缓存，并通过 `onRefresh` 通知调用方。
4. `useObjectTree` 已接入 `onRefresh`，数据库、表、视图、存储过程、函数、触发器、列信息等元数据刷新后可以同步更新 UI。

**剩余风险**：

如果后续还有新调用点使用 `fetchWithCache`，需要按需传入 `onRefresh`，否则它仍只会获得下一次主动调用时的新数据。

---

### 2. `configJson` 重复 `JSON.parse`

**状态**：已处理
**优先级**：中
**位置**：

- `src/api/connection.ts`
- `src/stores/connections.ts`
- `src/views/DatabaseView.vue`
- `src/components/layout/TabBar.vue`
- `src/components/layout/sidebar/ConnectionItem.vue`

**处理内容**：

1. 新增统一解析入口 `parseConnectionConfig`。
2. 新增配置读取 helper：`getIsFavorite`、`getEnvironment`、`getReadOnly`、`getConfirmDanger`、`getAutoReconnect`。
3. `ConnectionState` 增加 `parsedConfig`，连接加载、新增、编辑、移动分组时都会同步维护。
4. 连接列表收藏过滤、DatabaseView 环境/只读/危险确认、TabBar 环境色、ConnectionItem 环境标签已改为复用解析后的配置。

**剩余风险**：

`parseAutoReconnect(configJson)` 仍保留作为兼容导出，但内部或调用点已可优先走 `parsedConfig`。

---

### 3. `DatabaseView` 重型面板同步导入

**状态**：已处理
**优先级**：中
**位置**：`src/views/DatabaseView.vue`

**处理内容**：

以下组件已改为 `defineAsyncComponent`：

1. `SchemaComparePanel`
2. `PerformanceDashboard`
3. `UserManagementPanel`
4. `BackupDialog`
5. `RestoreDialog`
6. `CreateDatabaseDialog`
7. `EditDatabaseDialog`
8. `RoutineExecDialog`
9. `ObjectEditorDialog`
10. `DataSyncPanel`
11. `SchedulerPanel`

**剩余风险**：

实际 chunk 体积收益需要通过重新构建后查看产物确认。当前只确认代码层面的懒加载已落地。

---

### 4. 连接池轮询未感知页面可见性

**状态**：已处理
**优先级**：低
**位置**：`src/views/DatabaseView.vue`

**处理内容**：

1. 增加 `document.visibilitychange` 监听。
2. 页面隐藏时停止连接池状态轮询。
3. 页面重新可见且连接仍有效时恢复轮询。
4. 保留原有 `onDeactivated` 和 `onBeforeUnmount` 清理逻辑。

---

### 5. `useToolApproval` 使用 `setInterval` 轮询等待

**状态**：已处理
**优先级**：中低
**位置**：`src/composables/useToolApproval.ts`

**处理内容**：

审批队列等待逻辑已从 50ms `setInterval` 改为 Vue `watch` 驱动。当前一个审批结束后，后续审批会通过响应式变化继续执行，不再固定间隔轮询。

---

### 6. `usePerformance.startPerformanceMonitoring` 空壳

**状态**：已处理
**优先级**：低
**位置**：`src/composables/usePerformance.ts`

**处理内容**：

1. 重写性能监控逻辑。
2. 开发环境下会输出 navigation 关键时间。
3. 对超过 1000ms 的 resource / measure entry 输出 slow entry 日志。
4. 增加 `beforeunload` 清理监听和 observer。

---

### 7. `App.vue` 中 `settingsStore` 重复声明

**状态**：已处理
**优先级**：低
**位置**：`src/App.vue`

**处理内容**：

删除 `restoreStartupState` 内部重复的 `const settingsStore = useSettingsStore()`，复用外层 store 实例。

---

### 8. `useSqlCompletion` 关键字数组重复

**状态**：已处理
**优先级**：低
**位置**：`src/composables/useSqlCompletion.ts`

**处理内容**：

`SQL_KEYWORDS` 已用 `Set` 去重，避免重复关键字生成重复候选。

---

### 9. `KeepAlive :max="10"` 缓存偏大

**状态**：已处理
**优先级**：中低
**位置**：`src/views/MainLayout.vue`

**处理内容**：

主工作区 `<KeepAlive>` 的 `max` 从 `10` 调整为 `8`，降低重型 tab 长时间缓存的内存压力。

**剩余风险**：

是否继续降低需要结合实际内存快照。当前不建议在没有数据的情况下继续压低。

---

### 10. `manualChunks` 可进一步拆分

**状态**：部分处理
**优先级**：低到中
**位置**：`vite.config.ts`

**处理内容**：

在现有 `monaco`、`xterm`、`vue-vendor` 基础上，新增：

1. `shiki`
2. `diff`

**未处理原因**：

没有盲目新增 `echarts` chunk。当前项目已经按需使用 `echarts/core`，是否独立拆 chunk 应继续由构建产物分析决定。

---

### 11. Monaco Worker 使用 `&inline`

**状态**：已处理
**优先级**：低到中
**位置**：`src/main.ts`

**处理内容**：

Monaco editor worker 从：

```ts
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker&inline'
```

改为：

```ts
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
```

**剩余风险**：

已通过类型检查，但 Tauri 最终打包环境仍建议实际打开编辑器验证一次 worker 加载路径。

---

### 12. 组件级 `v-show` 导致 Vue runtime warning

**状态**：已处理
**优先级**：低
**位置**：`src/views/MainLayout.vue`

**处理内容**：

将 `ActivityBar`、`SidePanel`、`TabBar`、`BottomPanel`、`StatusBar` 上的组件级 `v-show` 改为 `v-if`，避免 Vue 在非元素根组件上应用 runtime directive 时发出警告。

---

## 三、暂缓问题

### 1. `useAiChat.ts` 大型 composable 拆分

**状态**：暂缓
**原因**：

这是高风险结构性重构，当前 `useAiChat.ts` 同时承担消息管理、流式通信、工具调用、审批、压缩、日志和资源刷新等职责。直接拆分容易影响 AI 连续对话和工具循环稳定性。

**建议**：

后续单独开任务拆分，优先从边界清晰的模块开始：

1. 工具执行与审批。
2. 流式事件处理。
3. 会话持久化。
4. 自动压缩。

---

### 2. `useQueryResult.ts` 大型 composable 拆分

**状态**：暂缓
**原因**：

该问题属于长期维护性技术债，不是当前功能缺陷。拆分前需要先明确虚拟滚动、列统计、行内编辑、导出等边界。

---

### 3. `hashPath` 碰撞风险

**状态**：暂缓
**位置**：`src/stores/workspace-files.ts`

**原因**：

当前场景下碰撞概率较低，且修改 root id 生成方式可能影响已有持久化数据和展开状态。后续如果要改，应设计迁移兼容。

---

### 4. SQL 日志脱敏正则边界

**状态**：暂缓
**位置**：`src/composables/useGlobalErrorHandler.ts`

**原因**：

当前脱敏目标是降低日志泄露风险，不是完整 SQL 解析。更严格策略需要先定义安全要求和误杀边界。

---

### 5. `zh-CN` 同步加载

**状态**：暂缓
**位置**：`src/locales/index.ts`

**原因**：

默认语言就是中文时，同步加载 `zh-CN` 不一定是坏事。异步化会增加启动状态处理复杂度。是否处理应由 bundle 分析决定。

---

## 四、不处理或原判断不成立

### 1. `echarts` 未做 tree-shaking

**状态**：不处理
**原因**：

当前代码已经使用 `echarts/core` 按需导入，没有发现 `import * as echarts from 'echarts'` 的全量导入。

---

### 2. `columnsEqual` 浅比较不完整

**状态**：不处理
**原因**：

当前 `ColumnDefinition` 类型里没有 `unsigned`、`zerofill` 等字段。`columnsEqual` 已覆盖当前类型定义里的字段。

---

### 3. `crypto.randomUUID()` 兼容性

**状态**：不处理
**原因**：

当前项目是 Tauri 桌面应用，不是需要兼容老旧浏览器或非安全上下文的普通 Web 站点。该问题在当前运行环境下优先级很低。

---

## 五、验证结果

已执行：

```bash
pnpm exec vue-tsc -b
```

结果：通过。

已执行：

```bash
cargo check --target-dir D:\Project\fullStack\forge-boot\.tmp-devforge-target
```

结果：通过。Rust 侧仍有若干既有 warning，和本次前端审查问题无直接关系。

---

## 六、后续建议

1. 先实际运行一次 Tauri dev，重点验证 Monaco 编辑器 worker、数据库面板懒加载、资源树后台刷新。
2. 如要继续处理技术债，建议单独开任务拆 `useAiChat.ts`，不要和功能修复混在一起。
3. 如果后续发现包体仍偏大，再跑 bundle analyzer 决定是否继续拆 `echarts`、`marked`、`dompurify` 等 chunk。
