# DevForge 资源管理器升级 + AI 文件操作可视化 — 设计规格

> **状态**: Final  
> **日期**: 2026-04-16  
> **范围**: 两大功能升级，共享 workspace-files 数据层

---

## 一、总体目标

1. **资源管理器**：从粗糙的 VS Code 仿制品升级为超越 VS Code/IDEA 的圆润现代文件树，具备完整交互能力
2. **AI 文件操作可视化**：AI 创建/修改文件后，在对话流中用毛玻璃折叠卡片展示操作结果，支持深邃沉浸型并排 Diff（左旧右新）

### 分阶段交付

| 阶段 | 范围 | 优先级 |
|------|------|--------|
| **Phase 1** | 视觉升级（圆润现代风格）+ 右键菜单完善 + 多选 + AI Diff 可视化 | 当前 |
| **Phase 2** | 搜索过滤增强 + 拖拽移动/复制 + 文件预览悬浮 | 后续 |
| **Phase 3** | 标签/书签系统 + 分栏视图 | 远期 |

---

## 二、Feature 1 — 资源管理器升级（Phase 1）

### 2.1 视觉风格：圆润现代型

**设计语言**: macOS Finder + Arc Browser 融合，深色暗调

| 元素 | 规格 |
|------|------|
| 行项 | 圆角 8px hover 背景，行高 32px，padding-left 按 depth × 16px |
| 选中态 | `bg-primary/8` + 左侧 2px 圆角高亮条 |
| 文件夹图标 | 渐变色 emoji 风格（📁→📂展开态），根据深度切换色调 |
| 文件图标 | 按扩展名映射语言色点（.vue→绿 / .ts→蓝 / .java→橙 / .py→黄） |
| Git 装饰 | 圆角胶囊 pill 标签（M 绿/A 蓝/D 红/U 黄），右侧对齐 |
| 目录子项数 | 折叠态右侧显示浅色圆角 badge（如 `4`） |
| 修改时间 | 悬浮时 tooltip 显示相对时间 |
| 字体 | 系统 sans-serif，12px |
| 分隔线 | 根目录间用 1px 渐变分隔线 |

### 2.2 Phase 1 交互功能

#### 右键菜单（完善升级）
- 文件：打开、在编辑器中打开、复制路径、复制相对路径、复制名称、重命名(F2)、删除(Delete)、在系统文件管理器中显示
- 目录：同上 + 新建文件、新建目录、折叠所有子目录
- 根目录：同上 + 移除工作区根目录
- 空白区：添加工作区文件夹、新建文件

#### 多选批量操作
- Ctrl+Click 切换选中
- Shift+Click 范围选中
- Ctrl+A 全选当前目录
- 多选后右键 → 批量删除、批量移动、批量复制路径
- 选中数量 badge 显示

#### 拖拽（仅树内）
- 文件/目录拖拽到目录 → 移动
- 按住 Ctrl 拖拽 → 复制
- 拖拽时目标目录高亮 + 插入线指示位置
- **注意**: `dragDropEnabled: false`（Tauri 配置限制），外部拖拽不支持，列入 Phase 2 评估

### 2.3 Phase 2/3 交互功能（本期不做，仅记录）

| 功能 | 阶段 | 说明 |
|------|------|------|
| 搜索过滤增强 | Phase 2 | 现有 FileSearchDialog.vue 可增强，不需引入 fuse.js |
| 文件预览悬浮 | Phase 2 | 图片缩略图 + 代码前 10 行，需额外 Tauri 文件读取 |
| 外部拖拽 | Phase 2 | 需评估 Tauri dragDropEnabled 的替代方案 |
| 标签/书签 | Phase 3 | 颜色标签 + 收藏面板 |
| 分栏视图 | Phase 3 | 双栏独立文件树 |

### 2.4 现有代码改造范围

| 文件 | 改动 |
|------|------|
| `src/types/workspace-files.ts` (64行) | FileNode 类型无需改动（已有完整字段） |
| `src/stores/workspace-files.ts` (439行) | 新增多选状态(selectedIds: Set)、批量操作 actions(batchDelete/batchMove) |
| `src/composables/useFileTree.ts` (158行) | 新增多选逻辑(Ctrl/Shift click handler) |
| `src/components/layout/panels/FilesPanel.vue` | 升级布局：工具栏+右键菜单升级+多选 badge |
| `src/components/layout/panels/files/FileTreeRow.vue` (120行) | 重写样式：圆角行、渐变图标、pill Git 标签、多选 checkbox |
| `src/components/layout/panels/files/WorkspaceRootHeader.vue` | 视觉升级匹配新风格 |
| `src/components/layout/panels/files/FileSearchDialog.vue` | 保持现有，Phase 2 增强 |
| 新建 `src/components/layout/panels/files/FileContextMenu.vue` | 抽离右键菜单为独立组件 |

---

## 三、Feature 2 — AI 文件操作可视化

### 3.1 毛玻璃折叠卡片组（文件操作列表）

当 AI 执行 `write_file`/`create_file`/`delete_file` 工具时，在对话流中渲染：

**卡片组结构**:
```
┌─ AI 消息头 ─────────────────────────────┐
│ ★ 已修改 N 个文件                        │
│                                           │
│ ┌─ 文件卡片 1（展开） ──────────────────┐ │
│ │ ▼ ■ Button.vue  src/components/  +2 -1│ │
│ │ ┌─ mini diff (最多10行) ────────────┐  │ │
│ │ │ - :class="btnClass"               │  │ │
│ │ │ + :class="btnClass" :disabled     │  │ │
│ │ └───────────────────────────────────┘  │ │
│ │ [Apply] [Reject] [Side-by-side]        │ │
│ └────────────────────────────────────────┘ │
│                                           │
│ ┌─ 文件卡片 2（折叠） ──────────────────┐ │
│ │ ▶ ■ types.ts  src/types/         +4  │ │
│ └────────────────────────────────────────┘ │
│                                           │
│ [ Accept All ]  [ Reject All ]           │
└───────────────────────────────────────────┘
```

**视觉规格**（语义定义，具体值实现时通过 CSS 变量调整）:
- 卡片: 毛玻璃背景 + 极淡 border + 12px 圆角
- 文件图标: 8px 渐变色方块（按文件类型着色）
- NEW 标签: 紫色 pill
- 增删统计: 绿 `+N` / 红 `-N`
- 展开/折叠: SVG 箭头，旋转动画 150ms
- **改动 ≥3 行自动展开，其余折叠**
- **mini diff 最多显示 10 行**，超出显示 "... 还有 N 行改动"

**mini diff 区域**:
- 深色背景，monospace 10px，行高 1.7
- 删除行: 红色前缀 `-`
- 新增行: 绿色前缀 `+`

**操作按钮**:
- Apply: 绿色文字链
- Reject: 灰色文字链
- Side-by-side: 灰色文字链，点击展开完整并排 Diff

### 3.2 深邃沉浸型并排 Diff

点击 "Side-by-side" 时展开完整对比视图：

**布局**:
```
┌─ 文件信息栏 ──────────────────────────────────────┐
│ [★AI] Button.vue                                   │
│ src/components/ · 添加 loading 状态    [+2] [-1]   │
├─ BEFORE ──────────────────┬─ AFTER ────────────────┤
│ 行号 │ 旧代码              │ 行号 │ 新代码           │
│  13  │ <template>          │  13  │ <template>       │
│  14  │ <button ██旧██>     │  14  │ <button ██新██>  │
│      │ ///斜纹占位///       │  15  │ <Loader .../>    │
│  15  │   <slot />          │  16  │   <slot />       │
│  16  │ </button>           │  17  │ </button>        │
├───────────────────────────┴────────────────────────┤
│ [✓ 应用更改]  [撤销]  [查看全文]  [复制]           │
│                           AI generated · hunk 1/1  │
└────────────────────────────────────────────────────┘
```

**视觉规格**:
- 整体容器: 深色渐变底 + 16px 圆角 + 右上微光晕
- AI 图标: 28px 圆角方块，紫色渐变 + box-shadow
- 增删 pill: 20px 圆角，半透明背景 + 同色 border
- 列标题: `BEFORE` / `AFTER` 大写小字体，各带色点
- 行号: 极低对比度，不干扰代码阅读
- 删除行: 渐变红背景 + 左 2px 红色边框
- 新增行: 渐变绿背景 + 右 2px 绿色边框
- 字符级差异: 圆角 pill 背景高亮（红/绿）
- 占位行: 斜纹填充对齐
- "应用更改" 按钮: 绿色渐变实心 + 阴影
- 其他按钮: 极淡背景 + border

**边界处理**:
- 大 diff（>500 行改动）: 分 hunk 折叠，仅展开变更附近 ±3 行上下文
- 二进制文件: 显示 "Binary file changed" 占位
- 新建文件: 无 BEFORE 列，仅显示 AFTER 全文
- 删除文件: 无 AFTER 列，仅显示 BEFORE 全文（红色调）

### 3.3 Apply/Reject 交互逻辑

**Apply（应用更改）**:
1. 读取磁盘当前文件内容，与 oldContent 比对
2. 如果一致 → 写入 newContent，卡片变 "已应用"（绿色勾 + 淡化）
3. 如果不一致（外部已修改）→ 提示冲突，让用户选择"强制覆盖"或"取消"
4. 写入失败（权限/磁盘） → 显示错误 toast
5. 触发文件树 `refreshGitDecorations()`

**Reject（撤销）**:
1. 有原始内容 → 恢复原文件
2. 新建文件 → 删除文件
3. 卡片变 "已撤销"（灰色划线）

**Accept All / Reject All**:
- 逐个执行，某个失败不影响其余，失败的标红提示

### 3.4 Diff 库选择

选用 **`diff`**（jsdiff）npm 包：
- `diffLines()` 计算行级差异 → 用于并排对齐
- `diffChars()` / `diffWords()` 计算字符级差异 → 用于 pill 高亮
- 轻量（~15KB gzipped），纯前端，无需 WASM

### 3.5 现有代码改造范围

| 文件 | 改动 |
|------|------|
| `src/types/ai.ts` (260行) | 新增 FileOperation 类型（op/path/oldContent/newContent/status） |
| `src/components/ai/AiToolCallBlock.vue` (265行) | 重写 write_file 渲染逻辑 → 调用 AiFileOpCard |
| `src/components/ai/AiMessageBubble.vue` (260行) | 聚合同一消息的 write_file 工具调用 → AiFileOpsGroup |
| 新建 `src/components/ai/AiFileOpCard.vue` | 单文件操作卡片（展开/折叠/mini diff/操作按钮） |
| 新建 `src/components/ai/AiDiffViewer.vue` | 深邃沉浸型并排 Diff 组件 |
| 新建 `src/components/ai/AiFileOpsGroup.vue` | 文件操作卡片组容器（Accept All/Reject All） |
| 新建 `src/composables/useAiDiff.ts` | diff 计算封装（基于 jsdiff） |

---

## 四、共享依赖

| 依赖 | 用途 | 备注 |
|------|------|------|
| `diff` (jsdiff) | 文本差异计算 | 新增，AI Diff 需要 |
| `@vueuse/core` | 已有 | useElementHover、useDebounceFn 等 |

---

## 五、不做的事情（YAGNI）

- 不做文件内容编辑器（workspace tab 职责）
- 不做 Git 分支/提交操作
- 不做 AI 文件操作的 undo/redo 栈
- 不做远程文件系统支持
- 不做文件树自定义排序配置 UI
- 不引入 fuse.js（现有 FileSearchDialog 足够，Phase 2 评估）

---

## 六、验证清单

### 资源管理器（Phase 1）

| 场景 | 预期 |
|------|------|
| 打开项目 | 圆润现代风格文件树，渐变图标，Git pill 标签 |
| 悬浮文件 | tooltip 显示文件大小+修改时间 |
| 右键文件 | 完整上下文菜单（打开/复制路径/重命名/删除等） |
| 右键目录 | 同上 + 新建文件/目录 |
| 树内拖拽 | 文件移动到目标目录，Ctrl=复制 |
| Ctrl+Click | 多选，选中数量 badge |
| Shift+Click | 范围选中 |
| 多选右键 | 批量删除/复制路径 |

### AI 文件操作

| 场景 | 预期 |
|------|------|
| AI write_file | 毛玻璃卡片，改动≥3行自动展开 mini diff |
| mini diff 超长 | 最多10行 + "... 还有 N 行" |
| 点击 Side-by-side | 展开深邃沉浸型并排 Diff |
| 字符级差异 | 旧代码红色 pill、新代码绿色 pill |
| 点击 Apply | 写入磁盘，卡片变绿色"已应用" |
| Apply 冲突 | 提示外部已修改，选择覆盖或取消 |
| 点击 Reject | 恢复原文件，卡片变灰色"已撤销" |
| AI 新建文件 | NEW 标签，无 Before 列 |
| Accept All | 批量应用，单个失败不影响其余 |
| 大 diff (>500行) | 分 hunk 折叠 |
| 二进制文件 | "Binary file changed" 占位 |
