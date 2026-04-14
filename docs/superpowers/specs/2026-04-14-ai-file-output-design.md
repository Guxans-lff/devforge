# DevForge AI 助手 — 文件输出增强设计

## 概述

增强 AI 助手的文件输出体验：让 AI 通过 Tool Use 直接写文件成为主要链路，并大幅提升工具调用的前端展示质量。

### 设计原则

参考 Claude Code 的设计哲学：**代码块是展示，文件操作走 Tool Use**。

- 代码块（AiCodeBlock）保持现有的复制 + 手动保存功能，作为兜底
- 所有 AI 主动写文件的场景，走 `write_file` 工具调用
- 通过 system prompt 引导 AI 在合适模式下主动调用工具

## 功能拆解

### 1. AiToolCallBlock 展示增强

当前工具调用展示组件（AiToolCallBlock.vue）对所有工具统一用 `<pre>` 渲染参数和结果。需要为文件操作工具提供专属展示。

#### write_file 专属展示

当 `toolCall.name === 'write_file'` 且 `status === 'success'` 时：

- **自动展开**：watch `status` 变化，当从 `running` 变为 `success` 时自动设置 `expanded = true`
- **顶栏**：`写入文件 · src/utils/helper.ts` + 状态图标 + `[用系统默认程序打开]` 按钮
- **内容区**：
  - 直接使用 `toolCall.parsedArgs.content` 作为预览内容（无需额外读文件，内容已在工具参数中）
  - 用 `AiCodeBlock` 组件渲染代码高亮预览，传入 `:show-actions="false"` 隐藏保存/复制按钮（文件已写入，这些按钮多余）
  - 大文件截断：预览内容超过 200 行时只显示前 100 行 + `... 共 N 行，已截断`
- **"打开文件"按钮**：调用 Tauri `shell.open(filePath)` 用系统默认程序打开。DevForge 当前不支持本地文件编辑 Tab，不做强行扩展。

#### read_file 专属展示

当 `toolCall.name === 'read_file'` 且 `status === 'success'` 时：

- 结果区用 `AiCodeBlock` 代码高亮渲染（替代 `<pre>` 纯文本），传入 `:show-actions="false"`
- 从文件路径推断语言类型（复用 `inferLanguageFromPath()` 工具函数）
- **剥离元数据头**：后端 `exec_read_file` 返回格式为 `[文件: path | N 行 | X KB]\n<content>`，渲染前需用正则剥离第一行元数据，只将实际文件内容传给 AiCodeBlock
- 大文件截断：同 write_file，超过 200 行只显示前 100 行

#### 其他工具（list_directory, search_files）

保持现有 `<pre>` 纯文本展示不变。

#### 组件内部结构

```
AiToolCallBlock.vue
├── 通用头部（工具名 + 参数摘要 + 状态图标）
├── [write_file 成功] → AiCodeBlock（高亮预览，无操作按钮）+ 打开文件按钮
├── [read_file 成功] → AiCodeBlock（高亮预览，无操作按钮）
└── [其他] → <pre> 纯文本（现有逻辑）
```

### 2. System Prompt 工具引导

让 AI 主动使用工具写文件，关键在 system prompt 的**行为引导**（工具定义已通过 API `tools` 参数发送，不需要在 prompt 中重复 schema）。

#### 模式对应策略

| 模式 | 策略 |
|------|------|
| 普通对话 | 不强制，AI 自由选择输出代码块或调工具 |
| 规划模式 | 先分析 → 用户确认 → 调 write_file 写入 |
| 全自动 | 直接调 write_file 写入，不输出代码块 |

#### Prompt 内容

当 Tool Use 启用时（`enableTools && workDir` 同时有值），在 system prompt 中追加**行为指引**：

```
【工具使用指引】
你可以通过工具调用来操作用户的工作目录中的文件。
工作目录: {workDir}

使用原则：
- 需要了解文件内容时，调用工具读取，不要凭记忆猜测
- 需要创建或修改文件时，调用 write_file 工具直接写入
- 搜索代码时优先使用 search_files 工具
```

全自动模式额外追加：

```
当用户要求修改或创建文件时，直接调用 write_file 工具写入，不要在回复中输出完整代码块让用户手动保存。
```

#### 注入点

在 `AiChatView.vue` 的 `effectiveSystemPrompt` computed 属性中拼接。通过已暴露的 `chat.workDir.value` 获取工作目录值，结合当前模型的 `capabilities.toolUse` 判断是否追加。

### 3. 工作目录设置 UI

当前 `useAiChat.ts` 有 `workDir` ref（composable 返回值已暴露）但没有 UI 入口。Tool Use 依赖工作目录才能启用。

#### UI 设计

- **位置**：AI 对话顶栏，左侧按钮组后面
- **显示**：当前工作目录路径（截取最后两级，如 `…/DevForge/devforge`）
- **交互**：点击调 Tauri `@tauri-apps/plugin-dialog` 的 `open({ directory: true })` 选择目录
- **默认值**：空（用户首次需手动选择）
- **未设置时**：显示"设置工作目录"占位按钮，灰色图标

#### 数据流

`AiChatView.vue` 中直接写入 `chat.workDir.value = selectedDir`。`useAiChat` composable 内的 `send()` 方法已在使用 `workDir.value` 判断是否启用 Tool Use。

#### 与 Tool Use 联动

- `workDir` 有值 + 模型支持 `toolUse` → 启用工具（发 tools 参数）
- `workDir` 为空 → 不发 tools 参数，AI 退化为纯对话

#### 持久化

当前阶段 workDir 仅存在于 composable 的内存 ref 中，页面刷新丢失。后续可扩展持久化到 session 记录，但不在本次范围内。

### 4. 路径→语言推断工具函数

`file-markers.ts` 新增一个工具函数，从文件路径推断编程语言标识符。

```typescript
/**
 * 从文件路径推断语言标识符
 * @param filePath 文件路径，如 "src/utils/helper.ts"
 * @returns 语言标识符，如 "ts"；未知返回 "text"
 */
export function inferLanguageFromPath(filePath: string): string
```

映射表（ext → lang）：

```typescript
const EXT_LANG: Record<string, string> = {
  '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.jsx': 'jsx',
  '.vue': 'vue', '.rs': 'rust', '.go': 'go', '.py': 'python',
  '.java': 'java', '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
  '.md': 'markdown', '.html': 'html', '.css': 'css', '.scss': 'scss',
  '.sql': 'sql', '.sh': 'bash', '.toml': 'toml', '.xml': 'xml',
}
```

特殊文件名处理：`Dockerfile` → `dockerfile`，`Makefile` → `makefile`。

## 文件改动清单

### 修改 4 个文件

| 文件 | 改动 |
|------|------|
| `src/components/ai/AiToolCallBlock.vue` | write_file/read_file 专属高亮展示；watch status 自动展开；打开文件按钮（shell.open）；read_file 结果剥离元数据头；大文件截断 |
| `src/components/ai/AiCodeBlock.vue` | 新增 `showActions` prop（默认 true），控制是否显示顶栏复制/保存按钮 |
| `src/views/AiChatView.vue` | effectiveSystemPrompt 拼接工具行为指引；顶栏新增工作目录选择器；workDir 数据流绑定 |
| `src/utils/file-markers.ts` | 新增 `inferLanguageFromPath()` 函数 + EXT_LANG 映射表 |

### 不改的文件

| 文件 | 原因 |
|------|------|
| `AiMessageBubble.vue` | 无需改动，工具调用展示已有 |
| `useAiChat.ts` | Tool Use 循环已完善，workDir 已暴露 |
| `src-tauri/` (后端) | ai_tools.rs 和 commands/ai.rs 无需改动 |

## 验证方式

1. 设置工作目录 → 全自动模式 → 对 AI 说"帮我创建一个 hello.ts 文件" → AI 调用 write_file → 工具卡片自动展开，显示代码高亮预览 + 打开文件按钮
2. 对 AI 说"读取 src/main.ts" → AI 调用 read_file → 结果以代码高亮展示（无 `[文件: ...]` 元数据头）
3. 规划模式 → 对 AI 说"帮我重构 xxx 文件" → AI 先分析，确认后调 write_file
4. 普通模式 → AI 可以选择输出代码块（用户手动保存）或调工具
5. 未设置工作目录 → 工具不启用，AI 正常输出代码块
6. 点击"打开文件"按钮 → 用系统默认程序打开文件
7. list_directory / search_files → 保持现有 `<pre>` 展示不变
8. AI 写入大文件（>200 行）→ 预览截断显示前 100 行
