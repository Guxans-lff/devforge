# P1-02: ER 图 + 查询结果优化方案

> 优先级：P1 | 预估工作量：中高 | 影响面：数据库可视化与数据浏览体验

---

## 一、现状分析

### 当前能力
- ✅ ObjectTree 数据库对象树（999 行，含虚拟滚动和搜索）
- ✅ TableEditorPanel 表结构编辑（1314 行）
- ✅ QueryResult 结果网格（923 行，含行内编辑、分页）
- ✅ SchemaComparePanel Schema 对比（563 行）
- ✅ Schema 缓存（useSchemaCache.ts - 118 行）
- ✅ 虚拟滚动（@tanstack/vue-virtual）
- ✅ 数据过滤（useDataFilter.ts - 203 行）

### 当前缺失
- ❌ ER 图可视化（表关系图）
- ❌ 单元格大数据预览（长文本/JSON/Blob）
- ❌ 行转列查看（垂直查看单行所有字段）
- ❌ 结果集对比功能
- ❌ 列统计信息（min/max/avg/null 比例）
- ❌ 数据可视化（简单图表）

---

## 二、优化方案

### 2.1 ER 图可视化

#### 2.1.1 架构设计

```
SchemaCache（已有表结构数据）
        ↓
  外键信息查询（MySQL INFORMATION_SCHEMA）
        ↓
  ┌─────────────────┐
  │ ER 图渲染引擎    │
  │  Vue Flow        │
  └─────────────────┘
        ↓
  ┌─────┬─────┬─────┐
  │ 拖拽 │ 缩放 │ 导出 │
  └─────┴─────┴─────┘
```

#### 2.1.2 数据模型

**后端新增查询**（`db_drivers/mysql/mod.rs`）：

```rust
// 外键关系查询
pub async fn get_foreign_keys(
    pool: &MySqlPool,
    database: &str,
) -> Result<Vec<ForeignKeyInfo>, AppError> {
    // SELECT TABLE_NAME, COLUMN_NAME,
    //        REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME,
    //        CONSTRAINT_NAME
    // FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    // WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
}

// 索引信息（用于 ER 图标注）
pub async fn get_indexes(
    pool: &MySqlPool,
    database: &str,
) -> Result<Vec<IndexInfo>, AppError> {
    // SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME,
    //        NON_UNIQUE, INDEX_TYPE
    // FROM INFORMATION_SCHEMA.STATISTICS
    // WHERE TABLE_SCHEMA = ?
}
```

**类型定义扩展**（`src/types/database.ts`）：

```typescript
interface ForeignKeyInfo {
  constraintName: string
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
  onUpdate: string
  onDelete: string
}

interface IndexInfo {
  tableName: string
  indexName: string
  columns: string[]
  isUnique: boolean
  indexType: string
}

interface ErNode {
  id: string  // 表名
  position: { x: number; y: number }
  data: {
    tableName: string
    columns: ColumnInfo[]
    primaryKey: string[]
    indexes: IndexInfo[]
  }
}

interface ErEdge {
  id: string
  source: string  // from 表
  target: string  // to 表
  sourceHandle: string  // from 列
  targetHandle: string  // to 列
  data: ForeignKeyInfo
}
```

#### 2.1.3 前端组件设计

**技术选型**：Vue Flow（基于 D3，Vue 3 原生支持）

**新增文件**：

```
src/components/database/er-diagram/
├── ErDiagramPanel.vue        # 主面板（工作区 Tab）
├── ErTableNode.vue           # 自定义表节点
├── ErRelationEdge.vue        # 自定义关系边
├── ErToolbar.vue             # 工具栏（布局/导出/过滤）
└── useErLayout.ts            # 自动布局算法
```

**ErDiagramPanel.vue 核心功能**：

```vue
<template>
  <VueFlow
    :nodes="nodes"
    :edges="edges"
    :node-types="nodeTypes"
    :edge-types="edgeTypes"
    @node-click="onNodeClick"
  >
    <ErToolbar
      @layout="autoLayout"
      @export="exportImage"
      @filter="filterTables"
    />
    <MiniMap />
    <Controls />
  </VueFlow>
</template>
```

**自动布局算法**（`useErLayout.ts`）：
1. **Dagre 布局**（默认）：基于有向图的层次布局，外键方向作为边
2. **Force 布局**：力导向布局，适合关系复杂的场景
3. **手动拖拽**：保存用户调整后的位置到 localStorage

**交互功能**：
- 双击表节点 → 打开 TableEditorPanel
- 悬停关系线 → 显示外键详情
- 右键菜单 → 查看表数据 / 编辑表结构
- 框选多表 → 仅显示选中表的关系
- 搜索过滤 → 按表名过滤显示

**导出功能**：
- PNG / SVG 图片导出
- SQL DDL 导出（选中表的建表语句）

#### 2.1.4 工作区集成

在 `database-workspace.ts` 中新增 Tab 类型：

```typescript
// InnerTab 类型扩展
type InnerTabType = 'query' | 'table-editor' | 'table-data'
  | 'import' | 'schema-compare' | 'performance'
  | 'user-management'
  | 'er-diagram'  // 新增

// store 中新增方法
openErDiagram(connectionId: string, database: string)
```

**入口**：
- ObjectTree 右键菜单 → "查看 ER 图"
- 数据库节点工具栏按钮
- 命令面板 → "打开 ER 图"

---

### 2.2 单元格大数据预览

#### 2.2.1 问题描述

当前 QueryResult 的网格直接显示截断的文本，对于以下场景体验差：
- 长文本字段（TEXT/LONGTEXT）
- JSON 数据
- 日期时间格式化
- BLOB/二进制数据
- ENUM/SET 类型

#### 2.2.2 单元格预览面板

**新增组件**：`src/components/database/CellPreviewPanel.vue`

**触发方式**：
1. 单击单元格 → 底部或侧边预览面板展示完整内容
2. 双击单元格 → 弹出模态预览（大屏查看）
3. 快捷键 `Space` → 快速预览（类似 macOS Quick Look）

**预览模式**（根据数据类型自动切换）：

```typescript
type PreviewMode =
  | 'text'       // 纯文本，支持换行和搜索
  | 'json'       // JSON 格式化 + 折叠 + 路径导航
  | 'xml'        // XML 格式化 + 语法高亮
  | 'image'      // BLOB 图片预览
  | 'hex'        // 二进制 Hex 查看
  | 'markdown'   // Markdown 渲染
  | 'datetime'   // 日期时间（多时区显示）
  | 'url'        // URL 可点击预览
```

**JSON 预览增强**：
- 语法高亮
- 折叠/展开层级
- 路径复制（点击节点 → 复制 `$.data[0].name`）
- 搜索 JSON 内容
- JSON → 表格视图切换（数组数据）

**涉及文件**：
- 新增 `src/components/database/CellPreviewPanel.vue` - 预览面板
- 新增 `src/components/database/preview/` 目录 - 各类型预览器
  - `JsonPreview.vue`
  - `TextPreview.vue`
  - `ImagePreview.vue`
  - `HexPreview.vue`
- 修改 `src/components/database/QueryResult.vue` - 单元格点击事件

---

### 2.3 行转列查看

#### 2.3.1 功能描述

当表列数很多（20+列）时，横向滚动查看不直观。提供「行转列」视图，将单行数据以表单形式纵向展示。

#### 2.3.2 设计方案

**新增组件**：`src/components/database/RowDetailPanel.vue`

**触发方式**：
- 选中行 → 快捷键 `Ctrl+D` → 侧边展示
- 右键菜单 → "查看行详情"
- 行内按钮（可选）

**展示形式**：

```
┌─────────────────────────────┐
│ 行详情 - Row #3             │
├──────────┬──────────────────┤
│ id       │ 42               │
│ name     │ Zhang San        │
│ email    │ zhang@example... │
│ bio      │ [展开查看]        │
│ avatar   │ [图片预览]        │
│ created  │ 2024-01-15 10:.. │
├──────────┴──────────────────┤
│ ◀ 上一行  3/156  下一行 ▶   │
└─────────────────────────────┘
```

**功能**：
- 列名 + 值配对显示
- 长文本自动展开/折叠
- 前后行导航
- 可编辑模式（配合现有 useInlineEdit）
- NULL 值特殊标记
- 复制单个字段值

**涉及文件**：
- 新增 `src/components/database/RowDetailPanel.vue` - 行详情面板
- 修改 `src/components/database/QueryResult.vue` - 行选择事件

---

### 2.4 列统计信息

#### 2.4.1 功能描述

选中列或结果集时，自动计算并展示列的统计概览。

#### 2.4.2 设计方案

**统计指标**：

| 数据类型 | 统计项 |
|---------|--------|
| 数值型 | min, max, avg, sum, 中位数, 标准差 |
| 字符串 | 最长, 最短, 平均长度, 空值占比 |
| 日期型 | 最早, 最晚, 时间跨度 |
| 所有类型 | 总行数, 唯一值数, NULL 数, NULL 占比 |

**展示位置**：
- 结果网格底部状态栏（选中列时）
- 列头右键菜单 → "列统计"
- 独立统计面板

**实现方式**：
1. **前端计算**（小结果集 < 10000 行）：直接在已加载数据上计算
2. **后端计算**（大结果集）：发送聚合 SQL 查询

**涉及文件**：
- 新增 `src/composables/useColumnStats.ts` - 列统计计算
- 修改 `src/components/database/QueryResult.vue` - 状态栏扩展
- 可选：`src-tauri/src/services/db_drivers/mysql/` - 后端聚合查询

---

### 2.5 结果集数据可视化

#### 2.5.1 功能描述

将查询结果快速转换为简单图表，无需导出到其他工具。

#### 2.5.2 设计方案

**技术选型**：ECharts（轻量且 Vue 生态成熟）或 Chart.js

**支持图表类型**：
- 柱状图 / 条形图（适合分组统计）
- 折线图（适合时间序列）
- 饼图（适合占比分析）
- 散点图（适合相关性分析）

**交互**：
1. 结果网格工具栏 → "图表" 按钮
2. 选择图表类型
3. 拖拽列到 X/Y 轴
4. 实时预览

**新增文件**：
```
src/components/database/chart/
├── ChartPanel.vue       # 图表面板
├── ChartConfig.vue      # 图表配置（轴映射）
└── useChartData.ts      # 数据转换
```

---

## 三、实施阶段

### 阶段 1：ER 图基础版（工作量：3-4 天）
1. [ ] 后端外键/索引查询 API
2. [ ] Vue Flow 集成与自定义节点
3. [ ] Dagre 自动布局
4. [ ] 基本交互（拖拽/缩放/悬停）
5. [ ] 工作区 Tab 集成

### 阶段 2：单元格预览（工作量：2-3 天）
1. [ ] CellPreviewPanel 框架
2. [ ] JSON 预览器（格式化 + 折叠）
3. [ ] 文本预览器（搜索 + 换行）
4. [ ] 类型自动检测
5. [ ] QueryResult 集成

### 阶段 3：行转列查看（工作量：1-2 天）
1. [ ] RowDetailPanel 组件
2. [ ] 前后行导航
3. [ ] QueryResult 交互集成

### 阶段 4：列统计 + 图表（工作量：2-3 天）
1. [ ] useColumnStats 计算逻辑
2. [ ] 结果网格状态栏扩展
3. [ ] 图表面板（可选，看时间）

---

## 四、技术选型

| 需求 | 推荐方案 | 理由 |
|------|---------|------|
| ER 图渲染 | Vue Flow (@vue-flow/core) | Vue 3 原生、交互丰富、社区活跃 |
| 自动布局 | Dagre | 层次布局效果好，与 Vue Flow 配合成熟 |
| JSON 预览 | vue-json-pretty 或自研 | 轻量、可定制 |
| 图表 | ECharts (vue-echarts) | 功能全面、性能优、中文文档完善 |

---

## 五、对标分析

| 功能 | DevForge（当前） | DataGrip | DBeaver | Navicat |
|------|-----------------|----------|---------|---------|
| ER 图 | ❌→✅ | ✅（优秀） | ✅（内置） | ✅（基础） |
| 单元格预览 | ❌→✅ | ✅（侧栏） | ✅（弹窗） | ✅（基础） |
| JSON 预览 | ❌→✅ | ✅（格式化） | ✅ | ❌ |
| 行转列 | ❌→✅ | ✅（默认有） | ✅ | ✅ |
| 列统计 | ❌→✅ | ✅（Aggregate） | ❌ | ❌ |
| 数据图表 | ❌→✅ | ❌ | ❌ | ✅（收费版） |

---

## 六、风险与注意事项

1. **Vue Flow 包大小**：约 200KB gzip，需做懒加载（ER 图 Tab 打开时才加载）
2. **大型数据库 ER 图性能**：100+ 张表时需要虚拟化或分区显示
3. **外键查询性能**：INFORMATION_SCHEMA 查询在大型数据库上可能较慢，需缓存
4. **BLOB 预览安全**：二进制数据显示需限制大小，防止内存溢出
5. **ECharts 按需引入**：避免全量引入增加包体积
