# DevForge FilesPanel 多根工作区资源管理器设计

> 日期：2026-04-16
> 状态：设计完成，待实现

## 概述

将当前 FilesPanel（仅 SFTP 连接列表）重设计为多根工作区本地文件资源管理器，支持同时浏览多个项目文件夹，深度联动 AI workDir，提供完整 CRUD 和实时文件监听。

## 核心需求

1. **多根工作区**：同时挂载多个本地文件夹，各自独立折叠/移除/排序
2. **文件树浏览**：懒加载 + 虚拟滚动，支持 10 万+ 节点
3. **完整 CRUD**：新建/重命名/删除文件和文件夹，拖拽移动
4. **实时监听**：文件系统变更自动反映到树
5. **AI workDir 联动**：工作区文件夹自动可用作 AI 工具沙箱
6. **Git 状态装饰**：文件级 modified/added/deleted 等状态显示
7. **快速搜索**：Ctrl+P 模糊搜索文件名
8. **压缩文件夹**：单子目录链合并显示（如 `src / components / layout`）

## 架构选型

| 维度 | 方案 | 依据 |
|------|------|------|
| 文件监听 | `notify-debouncer-full` | 300ms 去重，rename 配对，比 raw notify 减少 80%+ 冗余事件 |
| 虚拟滚动 | `@tanstack/vue-virtual`（已安装）| 复用 useObjectTree 现有模式 |
| 树结构 | 扁平数组 + indent level | VSCode IndexTreeModel 同款，O(1) 索引 |
| CRUD | `tauri-plugin-fs` | Tauri 官方插件，安全沙箱内操作 |
| Git 状态 | Decoration Provider + `git2`（已安装）| 解耦渲染与状态 |
| 搜索 | 复用 `fuzzyMatch.ts` | 路径权重评分，零新依赖 |
| 拖拽 | HTML5 DnD API | 无第三方库，600ms 悬停自动展开 |
| 删除 | `trash` crate | 默认移至回收站 |

---

## 数据模型

### TypeScript 类型（`src/types/workspace-files.ts`）

```typescript
/** 工作区根文件夹 */
export interface WorkspaceRoot {
  id: string                    // 路径 hash
  path: string                  // 绝对路径
  name: string                  // 显示名
  collapsed: boolean
  sortOrder: number
}

/** 扁平树节点 */
export interface FileNode {
  id: string                    // rootId:relativePath
  rootId: string
  name: string
  path: string                  // 相对路径
  absolutePath: string
  depth: number
  isDirectory: boolean
  isExpanded: boolean
  isLoading: boolean
  isCompressed: boolean
  compressedSegments?: string[]
  childCount?: number
}

/** 装饰信息（与节点解耦） */
export interface FileDecoration {
  gitStatus?: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'conflict'
  badge?: string
  color?: string
}

/** Tauri 返回的目录条目 */
export interface DirEntry {
  name: string
  isDir: boolean
  size?: number
  modified?: number
}

/** 文件变更事件 */
export interface FileChangeEvent {
  type: 'create' | 'modify' | 'delete' | 'rename'
  path: string
  newPath?: string
  isDir: boolean
}
```

---

## Tauri 后端

### 新增 Rust 模块：`src-tauri/src/commands/workspace_fs.rs`

| Command | 用途 |
|---------|------|
| `read_directory(path)` | 读取单层目录（懒加载） |
| `read_directory_recursive(path, max_depth)` | 递归读 N 层（预取） |
| `create_file(path, content?)` | 新建文件 |
| `create_directory(path)` | 新建文件夹 |
| `rename_entry(old, new)` | 重命名 |
| `delete_entry(path, use_trash)` | 删除（默认回收站） |
| `move_entry(source, target_dir)` | 移动 |
| `watch_directory(id, path)` | 启动文件监听 |
| `unwatch_directory(id)` | 停止监听 |
| `get_git_status(repo_path)` | 获取 Git 状态 Map |

### 文件监听

- `notify-debouncer-full` 300ms debounce
- 每个 WorkspaceRoot 一个 watcher
- 变更通过 Tauri event `explorer:changes` 推送前端
- 前端 50ms 二次去抖
- 删除默认用 `trash` crate 移至回收站

### 新增 Cargo 依赖

```toml
notify-debouncer-full = "0.4"
trash = "5"
```

---

## 前端 Store

### `src/stores/workspace-files.ts`

```
状态:
  roots: WorkspaceRoot[]              # 持久化到 SQLite
  expandedDirs: Set<string>           # 会话内存
  decorations: Map<string, FileDecoration>  # 异步更新，不触发树重渲染
  nodeCache: Map<string, FileNode[]>  # dirPath → 子节点缓存

计算属性:
  flatNodes: FileNode[]               # 虚拟滚动数据源，DFS 遍历 + 压缩

方法:
  addRoot(path) / removeRoot(id) / reorderRoots(from, to)
  expandDir(id) / collapseDir(id) / toggleDir(id)
  createFile(parent, name) / createDirectory(parent, name)
  rename(oldPath, newName) / deleteEntry(path, permanent?)
  moveEntry(source, targetDir)
  handleFileChanges(events[])
  refreshGitDecorations(rootPath)
```

**性能策略**：
- `flatNodes` 仅在 roots/expandedDirs/nodeCache 变化时重算
- decorations 独立 Map，异步更新不触发 flatNodes 重算
- 展开目录：先加载当前层 → 后台 250ms 延迟预取下一层

---

## UI 组件

### 文件结构

```
components/layout/panels/
├── FilesPanel.vue              # 面板容器
├── files/
│   ├── WorkspaceRootHeader.vue # 根标题行
│   ├── FileTreeRow.vue         # 单行（28px 固定）
│   ├── FileTreeRenameInput.vue # 原地重命名
│   ├── FileSearchDialog.vue    # Ctrl+P 搜索
│   └── useFileTree.ts          # 组合函数
```

### FilesPanel 工具栏

- 添加工作区文件夹（系统选择对话框）
- 新建文件 / 新建文件夹
- 刷新 / 折叠全部
- Ctrl+P 快速搜索

### FileTreeRow（28px 固定行高）

- `paddingLeft = depth * 16px`
- 目录：展开箭头 + 文件夹图标
- 文件：扩展名映射图标
- 右侧：Git 装饰徽标
- 双击文件 → 打开编辑器 Tab
- 双击目录 → 展开/折叠
- F2 重命名，Delete 删除

### 右键菜单

- 新建文件/文件夹
- 重命名（F2）
- 删除（Delete）
- 复制路径
- 在终端中打开
- 在系统资源管理器中显示
- 作为 AI 工作目录

### 键盘导航

- ↑↓ 移动焦点
- Enter 展开/打开
- F2 重命名
- Delete 删除
- Ctrl+Shift+E 聚焦文件面板

---

## 拖拽交互

### 文件拖拽移动

- HTML5 DnD API，`draggable` 属性
- 自定义 MIME `application/x-devforge-file`
- 拖到目录上 600ms 自动展开
- 放下 → `moveEntry()`

### 工作区根排序

- WorkspaceRootHeader 之间拖拽排序
- 更新 roots 数组 → 持久化

---

## 压缩文件夹

单子目录链合并为一行：`src / components / layout`

展开压缩节点时，展开到实际包含多个子项的层级。

---

## AI workDir 联动

1. 工作区根列表自动作为 AI 可用 workDir 选项
2. AI 工具执行路径必须在某个工作区根内（安全检查）
3. AI 写入文件 → 监听捕获 → 树实时更新
4. 右键菜单"作为 AI 工作目录"快捷设置

---

## 持久化

| 数据 | 存储 | 方式 |
|------|------|------|
| roots 列表 | SQLite | usePersistence 插件 |
| expandedDirs | 内存 | 会话结束丢弃 |
| decorations | 内存 | 按需刷新 |
| nodeCache | 内存 | 按需加载 |

---

## 不在本次范围

- 内置代码编辑器 Tab（后续独立设计）
- SFTP 远程文件浏览（保留在 ConnectionsPanel 入口）
- 文件内容搜索（grep 级别，后续增强）
