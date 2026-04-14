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

- **自动展开**（其他工具默认折叠）
- **顶栏**：`写入文件 · src/utils/helper.ts` + 状态图标 + `[打开文件]` 按钮
- **内容区**：
  - 工具执行成功后，异步调 `localReadFileContent(path)` 读取刚写入的文件
  - 用 `AiCodeBlock` 组件渲染代码高亮预览（复用现有组件）
  - 加载中显示 skeleton
- **"打开文件"按钮**：在 DevForge 中打开该文件的编辑 Tab

#### read_file 专属展示

当 `toolCall.name === 'read_file'` 且 `status === 'success'` 时：

- 结果区用 `AiCodeBlock` 代码高亮渲染（替代 `<pre>` 纯文本）
- 从文件路径推断语言类型（复用 `file-markers.ts` 中扩展名映射）

#### 其他工具（list_directory, search_files）

保持现有 `<pre>` 纯文本展示不变。

#### 组件内部结构

```
AiToolCallBlock.vue
├── 通用头部（工具名 + 参数摘要 + 状态图标）
├── [write_file 成功] → AiCodeBlock（高亮预览）+ 打开文件按钮
├── [read_file 成功] → AiCodeBlock（高亮预览）
└── [其他] → <pre> 纯文本（现有逻辑）
```

### 2. System Prompt 工具引导

让 AI 主动使用工具写文件，关键在 system prompt 的引导。

#### 模式对应策略

| 模式 | 策略 |
|------|------|
| 普通对话 | 不强制，AI 自由选择输出代码块或调工具 |
| 规划模式 | 先分析 → 用户确认 → 调 write_file 写入 |
| 全自动 | 直接调 write_file 写入，不输出代码块 |

#### Prompt 内容

当 Tool Use 启用时（`enableTools && workDir` 同时有值），在 system prompt 中追加工具说明：

```
【工具能力】
你可以使用以下工具操作用户的工作目录：
- read_file: 读取文件
- list_directory: 列出目录
- search_files: 搜索文件内容
- write_file: 写入/创建文件

工作目录: {workDir}
```

全自动模式额外追加：

```
当用户要求修改或创建文件时，直接调用 write_file 工具写入，不要在回复中输出完整代码块。
```

#### 注入点

在 `AiChatView.vue` 的 `effectiveSystemPrompt` computed 属性中拼接。需要从 `useAiChat` 获取 `workDir` 值，并结合当前模型是否支持 toolUse 来决定是否追加。

### 3. 工作目录设置 UI

当前 `useAiChat.ts` 有 `workDir` ref 但没有 UI 入口。Tool Use 依赖工作目录才能启用。

#### UI 设计

- **位置**：AI 对话顶栏，左侧按钮组后面
- **显示**：当前工作目录路径（截取最后两级，如 `…/DevForge/devforge`）
- **交互**：点击调 Tauri `open` dialog（选择目录模式）
- **默认值**：取 workspace store 中最近打开的项目路径（如果有）
- **未设置时**：显示"设置工作目录"占位文字

#### 与 Tool Use 联动

- `workDir` 有值 + 模型支持 `toolUse` → 启用工具（发 tools 参数）
- `workDir` 为空 → 不发 tools 参数，AI 退化为纯对话

#### 持久化

工作目录存到 session 级别，不同对话可以有不同工作目录。

### 4. 路径→语言推断工具函数

`file-markers.ts` 新增一个工具函数，从文件路径推断编程语言标识符，供 AiToolCallBlock 渲染高亮时使用。

```typescript
/**
 * 从文件路径推断语言标识符
 * @param filePath 文件路径，如 "src/utils/helper.ts"
 * @returns 语言标识符，如 "typescript"；未知返回 "text"
 */
export function inferLanguageFromPath(filePath: string): string
```

复用 AiCodeBlock 中已有的扩展名映射关系，但方向相反（ext → lang 而非 lang → ext）。

## 文件改动清单

### 修改 3 个文件

| 文件 | 改动 |
|------|------|
| `src/components/ai/AiToolCallBlock.vue` | write_file/read_file 专属高亮展示；自动展开；打开文件按钮；异步读取文件内容 |
| `src/views/AiChatView.vue` | effectiveSystemPrompt 拼接工具说明；顶栏新增工作目录选择器 |
| `src/utils/file-markers.ts` | 新增 `inferLanguageFromPath()` 函数 |

### 不改的文件

| 文件 | 原因 |
|------|------|
| `AiCodeBlock.vue` | 保持现有复制 + 手动保存按钮，作为兜底 |
| `AiMessageBubble.vue` | 无需改动，工具调用展示已有 |
| `useAiChat.ts` | Tool Use 循环已完善，workDir 已暴露 |
| `src-tauri/` (后端) | ai_tools.rs 和 commands/ai.rs 无需改动 |

## 验证方式

1. 设置工作目录 → 全自动模式 → 对 AI 说"帮我创建一个 hello.ts 文件" → AI 调用 write_file → 工具卡片自动展开，显示代码高亮预览 + 打开文件按钮
2. 对 AI 说"读取 src/main.ts" → AI 调用 read_file → 结果以代码高亮展示（非纯文本）
3. 规划模式 → 对 AI 说"帮我重构 xxx 文件" → AI 先分析，确认后调 write_file
4. 普通模式 → AI 可以选择输出代码块（用户手动保存）或调工具
5. 未设置工作目录 → 工具不启用，AI 正常输出代码块
6. 点击"打开文件"按钮 → 文件在 DevForge 编辑 Tab 中打开
7. list_directory / search_files → 保持现有 `<pre>` 展示不变
