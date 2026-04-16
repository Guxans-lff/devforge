# DevForge 工作区重构：Activity Bar + Side Panel 体系

> **日期**: 2026-04-15
> **状态**: Reviewed (2 rounds)
> **范围**: Phase 1 — 侧边栏体系（渐进式改造）

## 1. 背景与动机

DevForge 当前左侧 Sidebar 只是一个连接列表，所有功能（数据库/SSH/SFTP/AI/Git/搜索）全部挤在 Tab 系统中切换。随着功能增多，用户面临四大痛点：

1. **导航混乱** — 数据库表、SSH 终端、文件管理、AI 全在 Tab 里切换，找东西费劲
2. **无法分屏协作** — 不能同时看 SQL 结果和表结构（Phase 2 解决，本期不做）
3. **状态不记忆** — 面板宽度、激活面板等状态丢失（本期解决）
4. **资源组织差** — 连接多了变成一长串列表，缺少分组/搜索/收藏之外的导航维度

本次重构引入 **Activity Bar + Side Panel** 体系（类似 VSCode），同时通过 **上下文感知联动** 超越 VSCode 的割裂式面板设计。

### 设计原则

- **渐进式改造** — 保留现有 Tab 系统和所有业务组件，只改布局层
- **零业务组件变更** — DatabaseView、TerminalView 等内容组件不动
- **上下文感知** — 面板之间感知当前 Tab 上下文，自动联动

## 2. 整体布局

### 当前布局

```
┌───────────────────────────────────────┐
│            TitleBar                    │
├────────────┬──────────────────────────┤
│  Sidebar   │  TabBar                  │
│ (连接列表)  │─────────────────────────│
│            │    Active Tab Content    │
│            │──────────────────────────│
│            │  BottomPanel             │
└────────────┴──────────────────────────┘
```

### 新布局

```
┌───────────────────────────────────────┐
│            TitleBar                    │
├──┬─────────┬─────────────────────────┤
│AB│SidePanel│  TabBar                  │
│  │(动态内容)│─────────────────────────│
│DB│         │                          │
│FS│ 根据激活 │    Active Tab Content   │
│🔍│ 的图标   │                          │
│AI│ 切换面板 │                          │
│  │         │──────────────────────────│
│──│         │  BottomPanel             │
│⚙│         │                          │
├──┴─────────┴─────────────────────────┤
│            StatusBar                   │
└───────────────────────────────────────┘
```

**AB** = Activity Bar (48px 固定宽度图标栏)

## 3. 组件设计

### 3.1 Activity Bar

**位置**: 最左侧，48px 固定宽度
**文件**: `src/components/layout/ActivityBar.vue`

#### 图标列表

| 位置 | ID | 图标 | 标签 | 行为 |
|------|-----|------|------|------|
| 上部 | `connections` | Database | 连接 | 切换 ConnectionsPanel |
| 上部 | `files` | FolderOpen | 文件 | 切换 FilesPanel |
| 上部 | `search` | Search | 搜索 | 切换 SearchPanel |
| 上部 | `ai` | Bot | AI | 切换 AiPanel |
| 分隔 | — | — | — | 弹性空白区 |
| 底部 | — | Terminal | 本地终端 | 打开本地终端 Tab |
| 底部 | — | MoreHorizontal | 更多 | DropdownMenu（批量执行/Git/截图/隧道） |
| 底部 | — | Settings | 设置 | 打开设置 Tab（不切换 Panel） |
| 底部 | — | Sun/Moon | 主题 | 切换主题 |
| 底部 | — | ChevronLeft | 折叠 | 折叠/展开 SidePanel |

#### 底部"更多"菜单

从 Sidebar.vue 底部 `DropdownMenu` 迁移，保留以下快捷入口：

| 菜单项 | 图标 | 行为 |
|--------|------|------|
| 批量执行 | LayoutGrid | 打开 multi-exec Tab |
| Git 仓库 | GitBranch | 打开 Git 仓库对话框 |
| 截图翻译 | Camera | 打开 screenshot Tab |
| 隧道管理 | Cable | 打开 tunnel Tab |

> AI 对话不再放"更多"菜单，已有 Activity Bar 上部的 `ai` 图标承载。迁移时需从 Sidebar.vue 更多菜单中删除 AI 对话入口（当前 L686-690）。
>
> 底部按钮顺序调整为：本地终端 → 更多菜单 → 设置 → 主题 → 折叠（相比旧 Sidebar 的"主题→终端→设置→更多→折叠"，有意将高频操作前移）。

#### 交互规则

1. **单击图标** → 激活对应 Panel；如果该 Panel 已激活 → 折叠 SidePanel（activeSidePanel = null）
2. **角标** — 连接在线数、未读 AI 消息数（badge 小圆点/数字）
3. **激活态** — 左侧 2px 高亮条 + 图标颜色变为 primary
4. **Tooltip** — hover 300ms 后右侧显示面板名称

#### 数据结构

```typescript
// 新增类型
type SidePanelId = 'connections' | 'files' | 'search' | 'ai'

interface ActivityItem {
  id: SidePanelId
  icon: Component
  label: string
  badge?: () => number | undefined  // 响应式角标
}
```

### 3.2 Side Panel 容器

**文件**: `src/components/layout/SidePanel.vue`

动态加载面板内容的容器组件：

```vue
<template>
  <div class="side-panel" :style="{ width: panelWidth + 'px' }">
    <!-- 面板标题栏 -->
    <div class="panel-header">
      <span>{{ panelTitle }}</span>
      <button @click="closePanel">×</button>
    </div>
    <!-- 动态面板内容 -->
    <component :is="activePanelComponent" />
    <!-- 右侧拖拽调整宽度 -->
    <div class="resize-handle" @mousedown="startResize" />
  </div>
</template>
```

**关键行为**:
- 宽度可拖拽调整，最小 200px，最大 500px
- 拖拽边界保护：`mousemove` 时 `Math.max(200, Math.min(500, newWidth))`，`mouseup` 时保存到 `PanelState.sidePanelWidth`
- 拖拽过程中添加 `user-select: none` 到 `document.body`，防止文字选中
- 宽度持久化到 `PanelState.sidePanelWidth`
- 折叠时宽度为 0（不渲染内容，用 v-if）
- 面板切换用 `<KeepAlive>` 保持各面板内部状态

### 3.3 ConnectionsPanel（连接面板）

**文件**: `src/components/layout/panels/ConnectionsPanel.vue`

**从 Sidebar.vue 提取**，保持所有现有功能：
- 搜索框
- 收藏分组（Collapsible）
- 按类型分组（数据库/SSH/SFTP/Redis/Git）
- 新建连接按钮
- ConnectionItem 拖拽排序
- 右键菜单（编辑/复制/删除/测试/收藏/颜色标签）
- 颜色标签选择器

**上下文感知**:
- 监听 `workspace.activeTab.connectionId`
- 自动滚动到并高亮当前 Tab 对应的连接项

### 3.4 SearchPanel（搜索面板）

**文件**: `src/components/layout/panels/SearchPanel.vue`

MVP 版本 — 连接名和 Tab 标题搜索：

```
┌─────────────────┐
│ 🔍 搜索...       │  ← 输入框（自动聚焦）
├─────────────────┤
│ 打开的 Tab       │
│  📊 MySQL-Dev    │  ← 匹配的 Tab
│  📄 config.json  │
├─────────────────┤
│ 连接             │
│  🔗 MySQL-Dev    │  ← 匹配的连接名
│  🔗 PG-Prod      │
└─────────────────┘
```

**数据源**:
- `workspace.tabs` — 搜索 Tab 标题
- `connectionStore.connections` — 搜索连接名、host
- 搜索结果点击 → 激活对应 Tab 或打开连接

**与 ConnectionsPanel 搜索的关系**:
- ConnectionsPanel 内部保留独立的筛选框（仅过滤连接列表，类似文件树的快速筛选）
- SearchPanel 是**全局搜索**入口，同时搜索 Tab + 连接，范围更广
- 两者独立运作，无数据耦合

**后续迭代**:
- 数据库表名搜索（需要后端 API）
- SFTP 文件名搜索
- SQL 历史搜索

### 3.5 AiPanel（AI 面板）

**文件**: `src/components/layout/panels/AiPanel.vue`

从 `AiSessionDrawer.vue` 提取会话列表核心功能：

```
┌─────────────────┐
│ [+ 新建对话]     │  ← 打开新 AI Tab
├─────────────────┤
│ 最近会话         │
│ 💬 SQL 优化咨询   │  ← 点击打开/切换 AI Tab
│ 💬 代码生成       │
│ 💬 错误排查       │
├─────────────────┤
│ 当前模型         │
│ GPT-4o ⚡ 128K   │
└─────────────────┘
```

**行为**:
- 会话列表从 `useAiChatStore().sessions` 获取
- 点击会话 → 打开 AI Tab 并切换到该会话
- 新建对话 → 打开新 AI Tab
- 与 AiChatView 中的 AiSessionDrawer 共享数据源，但入口不同

### 3.6 FilesPanel（文件面板）

**文件**: `src/components/layout/panels/FilesPanel.vue`

V1 简版 — 快捷入口面板：

```
┌─────────────────┐
│ 文件管理         │
├─────────────────┤
│ SFTP 连接        │
│  📂 MySQL-Dev    │  ← 快速打开 SFTP Tab
│  📂 Prod-Server  │
├─────────────────┤
│ 本地目录         │
│  📁 AI 工作目录   │  ← 当前 AI workDir
│  [选择目录...]   │
└─────────────────┘
```

**上下文感知**:
- 如果当前 Tab 是数据库/SSH 且有 connectionId → 高亮对应的 SFTP 快捷入口
- AI 工作目录从活跃 AI 会话获取

### 3.7 StatusBar

**文件**: `src/components/layout/StatusBar.vue`

底部固定 24px 状态栏：

```
┌──────────────────────────────────────────────────────┐
│ 🟢 MySQL-Dev │ main ↗2 ↘1 │ GPT-4o │ 3 连接在线      │
└──────────────────────────────────────────────────────┘
```

**区域划分**:

| 位置 | 内容 | 数据源 | 点击行为 |
|------|------|--------|----------|
| 左侧 | 当前连接名+状态 | `activeTab.connectionId` → connectionStore | 切到连接面板 |
| 中间 | Git 分支+变更数 | 当前 Git Tab 数据 | 切到 Git Tab |
| 中间 | AI 模型名 | 当前 AI 配置 | 切到 AI Tab |
| 右侧 | 在线连接数 | connectionStore 统计 | 切到连接面板 |

**条件渲染**: 各区域仅在有数据时显示，空状态不占空间。

## 4. 上下文感知联动

这是超越 VSCode 的核心差异点。

### 联动矩阵

| 当前 Tab 类型 | ConnectionsPanel | FilesPanel | AiPanel |
|---------------|-----------------|------------|---------|
| database | **高亮当前连接** | 显示该连接 SFTP 入口 | — |
| terminal (SSH) | **高亮当前连接** | 同步终端 cwd 路径 | — |
| terminal (本地) | — | 通用入口 | — |
| file-manager | **高亮当前连接** | **同步当前路径** | — |
| ai-chat | — | 显示 AI workDir | 高亮当前会话 |
| redis | **高亮当前连接** | 通用入口 | — |
| multi-exec | — | 通用入口 | — |
| terminal-player | **高亮源连接** | 通用入口 | — |
| screenshot | — | 通用入口 | — |
| tunnel | — | 通用入口 | — |
| git | — | 通用入口 | — |
| welcome/settings | 无特殊行为 | 通用入口 | — |

### 实现方式

所有联动通过 Vue 响应式 `computed` 实现，不需要额外事件总线：

```typescript
// ConnectionsPanel 内部
const highlightedConnectionId = computed(
  () => workspace.activeTab?.connectionId ?? null
)

// FilesPanel 内部
const contextConnectionId = computed(
  () => workspace.activeTab?.connectionId ?? null
)
```

## 5. 状态管理变更

### PanelState 字段变更

**策略：移除旧字段，替换为新字段。** 不保留已弃用字段，通过 `persistence.ts` 的 `migrations` 机制做一次性迁移。

```typescript
// src/types/workspace.ts
type SidePanelId = 'connections' | 'files' | 'search' | 'ai'

interface PanelState {
  // ── 移除的字段（v1 → v2 迁移后不再存在）──
  // sidebarWidth      → 由 sidePanelWidth 替代
  // sidebarCollapsed  → 由 activeSidePanel 替代

  // ── 保留字段 ──
  bottomPanelHeight: number
  bottomPanelCollapsed: boolean
  bottomPanelTab: 'query-history' | 'log' | 'transfer' | 'history' | 'dev'
  immersiveMode: boolean

  // ── 新增字段 ──
  activeSidePanel: SidePanelId | null  // null = 面板折叠
  sidePanelWidth: number               // 侧面板宽度（默认 260）
  showStatusBar: boolean               // 是否显示状态栏（默认 true）
}
```

### workspace store 变更

```typescript
// 默认 panelState 更新
const panelState = ref<PanelState>({
  activeSidePanel: 'connections',  // 默认打开连接面板
  sidePanelWidth: 260,
  showStatusBar: true,
  bottomPanelHeight: 200,
  bottomPanelCollapsed: true,
  bottomPanelTab: 'query-history',
  immersiveMode: false,
})

// 新增方法
function setActiveSidePanel(panelId: SidePanelId | null) {
  panelState.value = { ...panelState.value, activeSidePanel: panelId }
}

function toggleSidePanel(panelId: SidePanelId) {
  if (panelState.value.activeSidePanel === panelId) {
    setActiveSidePanel(null)  // 再次点击 → 折叠
  } else {
    setActiveSidePanel(panelId)
  }
}

// 保留 toggleSidebar() 作为快捷键入口（Ctrl+B）
function toggleSidebar() {
  if (panelState.value.activeSidePanel) {
    setActiveSidePanel(null)
  } else {
    setActiveSidePanel('connections')  // 默认展开连接面板
  }
}

// 替代旧 setSidebarWidth
function setSidePanelWidth(width: number) {
  panelState.value = { ...panelState.value, sidePanelWidth: Math.max(200, Math.min(500, width)) }
}
```

### 沉浸式模式快照更新

```typescript
// 旧快照结构
// let _panelSnapshot: { sidebarCollapsed: boolean; bottomPanelCollapsed: boolean } | null

// 新快照结构
let _panelSnapshot: {
  activeSidePanel: SidePanelId | null
  bottomPanelCollapsed: boolean
  showStatusBar: boolean
} | null = null

function enterImmersive(): void {
  if (panelState.value.immersiveMode) return
  if (_immersiveManuallyExited) return
  _panelSnapshot = {
    activeSidePanel: panelState.value.activeSidePanel,
    bottomPanelCollapsed: panelState.value.bottomPanelCollapsed,
    showStatusBar: panelState.value.showStatusBar,
  }
  panelState.value = {
    ...panelState.value,
    activeSidePanel: null,        // 折叠侧面板
    bottomPanelCollapsed: true,
    showStatusBar: false,          // 隐藏状态栏
    immersiveMode: true,
  }
}

function exitImmersive(): void {
  if (!panelState.value.immersiveMode) return
  _immersiveManuallyExited = true
  const snapshot = _panelSnapshot ?? {
    activeSidePanel: 'connections' as SidePanelId,
    bottomPanelCollapsed: true,
    showStatusBar: true,
  }
  _panelSnapshot = null
  panelState.value = {
    ...panelState.value,
    activeSidePanel: snapshot.activeSidePanel,
    bottomPanelCollapsed: snapshot.bottomPanelCollapsed,
    showStatusBar: snapshot.showStatusBar,
    immersiveMode: false,
  }
}
```

## 6. 文件变更清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/components/layout/ActivityBar.vue` | Activity Bar 图标栏 |
| `src/components/layout/SidePanel.vue` | Side Panel 动态容器 |
| `src/components/layout/panels/ConnectionsPanel.vue` | 连接面板（从 Sidebar 提取） |
| `src/components/layout/panels/SearchPanel.vue` | 搜索面板 |
| `src/components/layout/panels/AiPanel.vue` | AI 面板 |
| `src/components/layout/panels/FilesPanel.vue` | 文件面板 |
| `src/components/layout/StatusBar.vue` | 底部状态栏 |

### 删除文件

| 文件 | 说明 |
|------|------|
| `src/components/layout/Sidebar.vue` | 完全删除。连接列表逻辑提取到 ConnectionsPanel，底部按钮分配到 ActivityBar |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/views/MainLayout.vue` | 替换 `<Sidebar />` 为 `<ActivityBar /> + <SidePanel />`，添加 `<StatusBar />`。沉浸式控制：`<ActivityBar v-show="!isImmersive" />`、`<SidePanel v-show="!isImmersive" />`、`<StatusBar v-show="!isImmersive && panelState.showStatusBar" />`，TabBar 和 BottomPanel 的 v-show 保持不变 |
| `src/types/workspace.ts` | 新增 `SidePanelId` 类型，替换 `PanelState` 中 `sidebarWidth`/`sidebarCollapsed` 为新字段 |
| `src/stores/workspace.ts` | 新增 `setActiveSidePanel`/`toggleSidePanel`/`setSidePanelWidth` 方法；移除 `setSidebarWidth`（仅 Sidebar.vue 自身调用，随 Sidebar 删除而消失）；更新 `toggleSidebar`/`enterImmersive`/`exitImmersive`；persistence version 升至 2 + 迁移函数 |
| `src/composables/useKeyboardShortcuts.ts` | `focusObjectTree` 改为：`if (!workspace.panelState.activeSidePanel) { workspace.setActiveSidePanel('connections') }` — 展开连接面板而非仅翻转 boolean |
| `src/stores/command-palette.ts` | `toggleSidebar()` 方法签名不变，无需改动（store 内部已兼容） |
| `src/stores/settings.ts` | shortcut binding ID `toggleSidebar` 保持不变，无改动 |

### 迁移文件（从 Sidebar.vue 拆分）

| 原始位置 | 去向 | 说明 |
|----------|------|------|
| Sidebar.vue — 连接列表核心 | ConnectionsPanel.vue | 搜索框、收藏分组、按类型分组、拖拽排序、右键菜单、颜色标签 |
| Sidebar.vue — ConnectionDialog/ConfirmDialog 渲染 | ConnectionsPanel.vue | 随连接逻辑一起迁移 |
| Sidebar.vue — 颜色标签选择器 Teleport 浮层 | ConnectionsPanel.vue | `<Teleport to="body">` 颜色选择器浮层，随颜色标签功能迁移 |
| Sidebar.vue — 底部主题切换 | ActivityBar.vue | Sun/Moon 图标按钮 |
| Sidebar.vue — 底部本地终端 | ActivityBar.vue | Terminal 图标按钮 |
| Sidebar.vue — 底部设置 | ActivityBar.vue | Settings 图标按钮 |
| Sidebar.vue — 底部更多菜单 | ActivityBar.vue | MoreHorizontal DropdownMenu |
| Sidebar.vue — 底部折叠按钮 | ActivityBar.vue | ChevronLeft 图标按钮 |

### 不变文件

- 所有业务视图组件（DatabaseView、TerminalView、FileManagerView、AiChatView 等）**零改动**
- `ConnectionItem.vue`、`ConnectionDialog.vue`、`ConfirmDialog.vue` 等子组件不变
- `src/locales/zh-CN.ts`、`src/locales/en.ts` — sidebar 相关翻译 key 保留，新增 activity bar 相关 key

## 7. 迁移策略

### 旧 Sidebar → 新体系

1. 从 `Sidebar.vue` 提取连接列表核心逻辑到 `ConnectionsPanel.vue`
2. 底部按钮（主题/终端/设置/更多菜单/折叠）分配到 `ActivityBar.vue`
3. 在 `MainLayout.vue` 中删除 `<Sidebar />` 引用，替换为 `<ActivityBar /> + <SidePanel />`
4. 删除 `Sidebar.vue` 文件
5. 保留 `ConnectionItem.vue`、`ConnectionDialog.vue` 等子组件不变
6. 颜色标签选择器、拖拽排序逻辑跟着 ConnectionsPanel 走

### PanelState 数据迁移

使用 `persistence.ts` 内置的 `version` + `migrations` 正式机制，**不在 `deserialize` 中写迁移逻辑**。

```typescript
// src/stores/workspace.ts — usePersistence 配置
// 注意：migrations 函数入参类型与 PersistConfig<T> 中 T 一致（WorkspacePersistedData）
// persistence.ts 内部逻辑：data = migrateFn(data) as T

const persistence = usePersistence<WorkspacePersistedData>({
  key: 'workspace',
  version: 2,  // 从 1 升级到 2
  migrations: {
    // v1 → v2：PanelState 字段替换
    2: (oldData) => {
      const data = oldData as WorkspacePersistedData
      const ps = data.panelState as any
      if (ps) {
        // sidebarCollapsed → activeSidePanel
        ps.activeSidePanel = ps.sidebarCollapsed ? null : 'connections'
        // sidebarWidth → sidePanelWidth
        ps.sidePanelWidth = ps.sidebarWidth ?? 260
        // 新增字段
        ps.showStatusBar = true
        // 清理旧字段
        delete ps.sidebarCollapsed
        delete ps.sidebarWidth
      }
      return data
    },
  },
  serialize: () => ({ /* ... */ }),
  deserialize: (data) => { /* 纯反序列化，无迁移逻辑 */ },
})
```

**迁移时序**：`persistence.load()` → 检测 `storedVersion(1) < version(2)` → 执行 `migrations[2](data)` → `saveImmediate()` 写入新版 → `deserialize()` 恢复状态。

## 8. 沉浸式模式兼容

当前 AI Tab 激活时自动进入沉浸式模式（隐藏 Sidebar + BottomPanel）。新架构下：

- 沉浸式模式隐藏 **ActivityBar + SidePanel + TabBar + BottomPanel + StatusBar**
- `_panelSnapshot` 结构更新为 `{ activeSidePanel, bottomPanelCollapsed, showStatusBar }`（见 Section 5 详细代码）
- `enterImmersive()` — 保存快照 → `activeSidePanel = null` + `showStatusBar = false` + `bottomPanelCollapsed = true`
- `exitImmersive()` — 从快照恢复所有三个字段
- MainLayout 中 `v-show="!isImmersive"` 条件扩展到 ActivityBar、SidePanel、StatusBar
- `_immersiveManuallyExited` 标志位保留：用户手动退出沉浸式后设为 true，阻止 watch 自动重入（防止切换 Tab 时 AI Tab 的 watch 又触发 enterImmersive）

## 9. 验证计划

| 场景 | 预期行为 |
|------|----------|
| Activity Bar 图标点击 | 切换对应面板，再次点击折叠 |
| 连接面板功能 | 新建/编辑/删除/测试/收藏/拖拽排序/颜色标签 全部正常 |
| 上下文高亮 | 切换数据库 Tab → 连接面板自动高亮对应连接 |
| 搜索面板 | 输入关键词 → 实时过滤 Tab 和连接 |
| AI 面板 | 点击会话 → 打开 AI Tab 并加载该会话 |
| 面板宽度调整 | 拖拽调整 → 刷新后保持 |
| 折叠态 | SidePanel 折叠 → 只显示 ActivityBar |
| 沉浸式 | AI Tab → 全部隐藏；退出 → 全部恢复 |
| 旧数据兼容 | 升级后 sidebarCollapsed/Width 自动迁移到新字段 |
| StatusBar | 显示当前连接/Git/AI 信息，点击跳转 |

## 10. 后续迭代（Out of Scope）

- **Phase 2**: 分屏系统（左右/上下拆分 Tab 内容区）
- **Phase 3**: .devforge-workspace 工作区文件（绑定一组连接+配置+布局）
- 全局搜索增强（数据库表名、SFTP 文件、SQL 历史）
- Activity Bar 图标拖拽排序
- 面板拖出为独立窗口
