# AI 文件输出增强 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强 DevForge AI 助手的文件输出体验 — write_file/read_file 工具调用的前端展示增强 + system prompt 行为引导 + 工作目录选择器 + tauri-plugin-opener 集成。

**Architecture:** 前端 4 个文件改动 + 1 个 Tauri 插件安装。AiToolCallBlock 为 write_file/read_file 提供专属代码高亮展示（复用 AiCodeBlock），AiCodeBlock 新增 `showActions` prop 控制按钮显隐。AiChatView 在 system prompt 中注入工具行为指引并提供工作目录 UI 入口。file-markers.ts 新增路径→语言推断函数。

**Tech Stack:** Vue 3 + TypeScript + Tauri 2 + tauri-plugin-opener + shiki

---

## 文件结构

| 动作 | 文件 | 职责 |
|------|------|------|
| 修改 | `src/utils/file-markers.ts` | 新增 `inferLanguageFromPath()` 工具函数 |
| 修改 | `src/components/ai/AiCodeBlock.vue` | 新增 `showActions` prop 控制按钮显隐 |
| 修改 | `src/components/ai/AiToolCallBlock.vue` | write_file/read_file 专属展示增强 |
| 修改 | `src/views/AiChatView.vue` | system prompt 工具指引 + 工作目录选择器 |
| 修改 | `src-tauri/Cargo.toml` | 添加 `tauri-plugin-opener` 依赖 |
| 修改 | `package.json` | 添加 `@tauri-apps/plugin-opener` 依赖 |
| 修改 | `src-tauri/src/lib.rs` | 注册 opener 插件 |
| 修改 | `src-tauri/capabilities/default.json` | 添加 `opener:default` 权限 |

---

## Task 1: `inferLanguageFromPath` 工具函数

**Files:**
- Modify: `src/utils/file-markers.ts`

这是其他任务的基础依赖（AiToolCallBlock 用它推断语言类型）。

- [ ] **Step 1: 在 `file-markers.ts` 末尾添加 `inferLanguageFromPath` 函数**

在文件末尾（`MAX_FILE_SIZE` 常量之后）追加：

```typescript
// ─────────────────────── 路径→语言推断 ───────────────────────

/** 文件扩展名 → 代码高亮语言标识符 */
const EXT_LANG: Record<string, string> = {
  '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.jsx': 'jsx',
  '.vue': 'vue', '.rs': 'rust', '.go': 'go', '.py': 'python',
  '.java': 'java', '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
  '.md': 'markdown', '.html': 'html', '.css': 'css', '.scss': 'scss',
  '.sql': 'sql', '.sh': 'bash', '.toml': 'toml', '.xml': 'xml',
}

/** 特殊文件名 → 语言标识符 */
const SPECIAL_FILES: Record<string, string> = {
  'Dockerfile': 'dockerfile',
  'Makefile': 'makefile',
}

/**
 * 从文件路径推断语言标识符
 * @param filePath 文件路径，如 "src/utils/helper.ts"
 * @returns 语言标识符，如 "ts"；未知返回 "text"
 */
export function inferLanguageFromPath(filePath: string): string {
  // 提取文件名
  const fileName = filePath.split(/[/\\]/).pop() ?? ''

  // 先检查特殊文件名
  if (SPECIAL_FILES[fileName]) return SPECIAL_FILES[fileName]

  // 按扩展名匹配
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  return EXT_LANG[ext] ?? 'text'
}
```

- [ ] **Step 2: 验证无类型错误**

Run: `cd D:/Project/DevForge/devforge && npx vue-tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无 `file-markers.ts` 相关错误

- [ ] **Step 3: Commit**

```bash
git add src/utils/file-markers.ts
git commit -m "feat(ai): 新增 inferLanguageFromPath 路径→语言推断函数"
```

---

## Task 2: AiCodeBlock `showActions` prop

**Files:**
- Modify: `src/components/ai/AiCodeBlock.vue`

为 AiCodeBlock 添加 `showActions` prop，控制顶栏按钮（保存/复制）是否显示。在 AiToolCallBlock 中嵌套使用时设为 `false`（文件已写入/已读取，按钮多余）。

- [ ] **Step 1: 修改 props 定义，添加 `showActions`**

在 `AiCodeBlock.vue` 第 12-14 行的 `defineProps` 中，增加 `showActions` 属性：

```typescript
// 替换现有的 defineProps
const props = withDefaults(defineProps<{
  language: string
  code: string
  /** 是否显示顶栏操作按钮（复制/保存），默认 true */
  showActions?: boolean
}>(), {
  showActions: true,
})
```

- [ ] **Step 2: 用 `v-if` 条件渲染按钮区**

在模板中，将第 113 行的 `<div class="flex items-center gap-1">` 按钮容器包裹在 `v-if="showActions"` 中：

```html
<!-- 将现有的按钮容器 -->
<div class="flex items-center gap-1">
<!-- 改为 -->
<div v-if="showActions" class="flex items-center gap-1">
```

- [ ] **Step 3: 验证无类型错误**

Run: `cd D:/Project/DevForge/devforge && npx vue-tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无 `AiCodeBlock.vue` 相关错误

- [ ] **Step 4: Commit**

```bash
git add src/components/ai/AiCodeBlock.vue
git commit -m "feat(ai): AiCodeBlock 新增 showActions prop 控制按钮显隐"
```

---

## Task 3: 安装 tauri-plugin-opener

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `package.json`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

AiToolCallBlock 的"打开文件"按钮依赖此插件的 `openPath()` API。

- [ ] **Step 1: Rust 端添加依赖**

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 段落末尾（`base64 = "0.22.1"` 之后的某行），添加：

```toml
tauri-plugin-opener = "2"
```

- [ ] **Step 2: 前端添加依赖**

在 `package.json` 的 `dependencies` 中（`@tauri-apps/plugin-dialog` 旁边），添加：

```json
"@tauri-apps/plugin-opener": "^2.0.0",
```

- [ ] **Step 3: 注册插件**

在 `src-tauri/src/lib.rs` 第 60 行（`.plugin(tauri_plugin_dialog::init())` 之后），添加：

```rust
.plugin(tauri_plugin_opener::init())
```

- [ ] **Step 4: 添加权限**

在 `src-tauri/capabilities/default.json` 的 `permissions` 数组中（`"dialog:default"` 之后），添加：

```json
"opener:default"
```

- [ ] **Step 5: 安装前端依赖**

Run: `cd D:/Project/DevForge/devforge && pnpm install`
Expected: 安装成功，lock 文件更新

- [ ] **Step 6: 验证 Rust 编译**

Run: `cd D:/Project/DevForge/devforge/src-tauri && cargo check 2>&1 | tail -5`
Expected: 编译成功（可能有预已存在的 warnings）

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml package.json pnpm-lock.yaml src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "chore: 安装 tauri-plugin-opener 依赖（文件打开功能）"
```

---

## Task 4: AiToolCallBlock 展示增强

**Files:**
- Modify: `src/components/ai/AiToolCallBlock.vue`

这是本次改动最核心的任务。为 write_file 和 read_file 工具提供专属的代码高亮展示，替代现有的统一 `<pre>` 渲染。

### 4.1 导入依赖和新增状态

- [ ] **Step 1: 添加导入和组件引用**

在 `AiToolCallBlock.vue` 的 `<script setup>` 中：

1. 添加 `watch` 到 vue 导入
2. 导入 `AiCodeBlock`
3. 导入 `inferLanguageFromPath`
4. 导入 `openPath` from `@tauri-apps/plugin-opener`
5. 导入 `ExternalLink` 图标

```typescript
import { ref, computed, watch } from 'vue'
import type { ToolCallInfo } from '@/types/ai'
import { ChevronRight, Loader2, CheckCircle2, XCircle, Wrench, ExternalLink } from 'lucide-vue-next'
import AiCodeBlock from './AiCodeBlock.vue'
import { inferLanguageFromPath } from '@/utils/file-markers'
import { openPath } from '@tauri-apps/plugin-opener'
```

### 4.2 自动展开逻辑

- [ ] **Step 2: 添加 watch，write_file/read_file 成功时自动展开**

在 `expanded` ref 定义之后（第 16 行），添加 watch：

```typescript
/** write_file / read_file 成功时自动展开 */
watch(
  () => props.toolCall.status,
  (newStatus, oldStatus) => {
    if (
      oldStatus === 'running' &&
      newStatus === 'success' &&
      (props.toolCall.name === 'write_file' || props.toolCall.name === 'read_file')
    ) {
      expanded.value = true
    }
  },
)
```

### 4.3 新增 computed 属性

- [ ] **Step 3: 添加文件操作专属 computed**

在 `resultPreview` computed 之后，添加三个新 computed：

```typescript
/** 是否为文件操作工具（write_file / read_file） */
const isFileOp = computed(() =>
  props.toolCall.name === 'write_file' || props.toolCall.name === 'read_file',
)

/** 工具的文件路径（从 parsedArgs 中提取，可能是相对路径） */
const filePath = computed(() =>
  (props.toolCall.parsedArgs?.path as string) ?? '',
)

/** 推断的语言标识符 */
const inferredLang = computed(() =>
  filePath.value ? inferLanguageFromPath(filePath.value) : 'text',
)

/**
 * 文件操作的代码预览内容
 * - write_file: 直接取 parsedArgs.content
 * - read_file: 从 result 中剥离元数据头 `[文件: ... | N 行 | X KB]`
 */
const filePreviewContent = computed(() => {
  if (props.toolCall.name === 'write_file') {
    return (props.toolCall.parsedArgs?.content as string) ?? ''
  }
  if (props.toolCall.name === 'read_file' && props.toolCall.result) {
    // 剥离第一行元数据：[文件: path | N 行 | X KB]
    const result = props.toolCall.result
    const firstNewline = result.indexOf('\n')
    if (firstNewline > 0 && result.startsWith('[文件:')) {
      return result.slice(firstNewline + 1)
    }
    return result
  }
  return ''
})

/**
 * 截断后的预览内容（大文件只显示前 100 行）
 */
const truncatedPreview = computed(() => {
  const content = filePreviewContent.value
  if (!content) return { text: '', truncated: false, totalLines: 0 }
  const lines = content.split('\n')
  if (lines.length > 200) {
    return {
      text: lines.slice(0, 100).join('\n'),
      truncated: true,
      totalLines: lines.length,
    }
  }
  return { text: content, truncated: false, totalLines: lines.length }
})
```

### 4.4 打开文件方法

- [ ] **Step 4: 添加 `handleOpenFile` 方法**

在 computed 属性之后，添加：

```typescript
/**
 * 从 write_file 结果中提取绝对路径
 * 后端返回格式: "已创建 D:\xxx\hello.ts (123 字节)" 或 "已更新 ..."
 */
const absoluteFilePath = computed(() => {
  const result = props.toolCall.result ?? ''
  const match = result.match(/^(?:已创建|已更新)\s+(.+?)\s+\(/)
  return match?.[1] ?? ''
})

/** 用系统默认程序打开文件 */
async function handleOpenFile() {
  const path = absoluteFilePath.value
  if (!path) return
  try {
    await openPath(path)
  } catch (e) {
    console.error('[AI] 打开文件失败:', e)
  }
}
```

### 4.5 模板改造

- [ ] **Step 5: 替换展开内容区模板**

将现有的展开内容区（第 121-138 行的 `<div v-if="expanded" ...>` 整个块）替换为：

```html
    <!-- 展开内容 -->
    <div v-if="expanded" class="border-t border-border/20">
      <!-- ===== write_file / read_file 专属展示 ===== -->
      <template v-if="isFileOp && toolCall.status === 'success'">
        <!-- 打开文件按钮（仅 write_file 且有绝对路径） -->
        <div v-if="toolCall.name === 'write_file' && absoluteFilePath" class="flex items-center justify-end px-3 py-1.5">
          <button
            class="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="用系统默认程序打开"
            @click.stop="handleOpenFile"
          >
            <ExternalLink class="h-3 w-3" />
            <span>打开文件</span>
          </button>
        </div>
        <!-- 代码高亮预览 -->
        <div v-if="truncatedPreview.text" class="px-1 pb-1">
          <AiCodeBlock
            :language="inferredLang"
            :code="truncatedPreview.text"
            :show-actions="false"
          />
          <div
            v-if="truncatedPreview.truncated"
            class="px-3 py-1 text-[10px] text-muted-foreground/50 text-center"
          >
            ... 共 {{ truncatedPreview.totalLines }} 行，已截断显示前 100 行
          </div>
        </div>
      </template>

      <!-- ===== 其他工具 / 非成功状态：保持原有 <pre> 展示 ===== -->
      <template v-else>
        <div class="px-3 py-2">
          <!-- 参数 -->
          <div class="mb-1.5">
            <div class="text-[10px] font-medium text-muted-foreground/40 mb-0.5">参数</div>
            <pre class="text-[11px] text-foreground/60 font-mono whitespace-pre-wrap overflow-x-auto max-h-[120px] overflow-y-auto">{{ JSON.stringify(toolCall.parsedArgs ?? toolCall.arguments, null, 2) }}</pre>
          </div>
          <!-- 结果 -->
          <div v-if="toolCall.result || toolCall.error">
            <div class="text-[10px] font-medium mb-0.5" :class="toolCall.error ? 'text-destructive/60' : 'text-muted-foreground/40'">
              {{ toolCall.error ? '错误' : '结果' }}
            </div>
            <pre
              class="text-[11px] font-mono whitespace-pre-wrap overflow-x-auto max-h-[200px] overflow-y-auto"
              :class="toolCall.error ? 'text-destructive/70' : 'text-foreground/60'"
            >{{ resultPreview }}</pre>
          </div>
        </div>
      </template>
    </div>
```

- [ ] **Step 6: 验证无类型错误**

Run: `cd D:/Project/DevForge/devforge && npx vue-tsc --noEmit --pretty 2>&1 | head -30`
Expected: 无 `AiToolCallBlock.vue` 相关错误

- [ ] **Step 7: Commit**

```bash
git add src/components/ai/AiToolCallBlock.vue
git commit -m "feat(ai): AiToolCallBlock write_file/read_file 专属高亮展示"
```

---

## Task 5: AiChatView — System Prompt 工具指引 + 工作目录选择器

**Files:**
- Modify: `src/views/AiChatView.vue`

### 5.1 System Prompt 工具行为指引

- [ ] **Step 1: 在 `effectiveSystemPrompt` 中拼接工具指引**

将 `AiChatView.vue` 第 137-142 行的 `effectiveSystemPrompt` computed 替换为：

```typescript
/** 计算实际的 system prompt（拼接模式后缀 + 工具行为指引） */
const effectiveSystemPrompt = computed(() => {
  const base = systemPrompt.value ?? ''
  const suffix = MODE_SUFFIXES[chatMode.value]

  // 工具行为指引（模型支持 Tool Use + 有工作目录时追加）
  const enableTools = currentModel.value?.capabilities.toolUse && !!chat.workDir.value
  let toolGuide = ''
  if (enableTools) {
    toolGuide = `\n\n【工具使用指引】\n你可以通过工具调用来操作用户的工作目录中的文件。\n工作目录: ${chat.workDir.value}\n\n使用原则：\n- 需要了解文件内容时，调用工具读取，不要凭记忆猜测\n- 需要创建或修改文件时，调用 write_file 工具直接写入\n- 搜索代码时优先使用 search_files 工具`

    // 全自动模式额外追加
    if (chatMode.value === 'auto') {
      toolGuide += `\n\n当用户要求修改或创建文件时，直接调用 write_file 工具写入，不要在回复中输出完整代码块让用户手动保存。`
    }
  }

  const result = base + (suffix || '') + toolGuide
  return result || undefined
})
```

### 5.2 工作目录选择器

- [ ] **Step 2: 添加 `open` 导入和工作目录处理方法**

在 `<script setup>` 顶部的导入区域，添加 `@tauri-apps/plugin-dialog` 的 `open` 导入：

```typescript
// 在现有 import 之后添加（注意不要与已有的 dialog 导入冲突）
import { open as openDialog } from '@tauri-apps/plugin-dialog'
```

同时导入 `FolderOpen` 图标：

```typescript
// 在 lucide-vue-next import 中添加 FolderOpen
import {
  Bot, Settings, History, Plus, Minimize2, Sparkles, Zap, MessageSquareText, FolderOpen,
} from 'lucide-vue-next'
```

在 `exitImmersive` 函数之后，添加工作目录处理方法：

```typescript
/** 选择工作目录 */
async function handleSelectWorkDir() {
  const dir = await openDialog({ directory: true, multiple: false })
  if (dir) {
    chat.workDir.value = dir as string
  }
}

/** 截取工作目录显示名（最后两级） */
const workDirDisplay = computed(() => {
  const dir = chat.workDir.value
  if (!dir) return ''
  const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= 2) return parts.join('/')
  return '…/' + parts.slice(-2).join('/')
})
```

- [ ] **Step 3: 在顶栏添加工作目录按钮**

在模板中，找到顶栏左侧按钮组的 `</TooltipProvider>` 结束标签（约第 311 行），在其**之后**添加工作目录按钮：

```html
          </TooltipProvider>

          <!-- 工作目录选择器 -->
          <button
            class="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors"
            :class="chat.workDir.value
              ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
              : 'text-muted-foreground/40 hover:text-muted-foreground/60 hover:bg-muted/50'"
            :title="chat.workDir.value || '设置工作目录（启用 AI 文件操作）'"
            @click="handleSelectWorkDir"
          >
            <FolderOpen class="h-3.5 w-3.5" />
            <span v-if="chat.workDir.value">{{ workDirDisplay }}</span>
            <span v-else>设置工作目录</span>
          </button>
```

- [ ] **Step 4: 验证无类型错误**

Run: `cd D:/Project/DevForge/devforge && npx vue-tsc --noEmit --pretty 2>&1 | head -30`
Expected: 无 `AiChatView.vue` 相关错误

- [ ] **Step 5: Commit**

```bash
git add src/views/AiChatView.vue
git commit -m "feat(ai): system prompt 工具行为指引 + 工作目录选择器"
```

---

## Task 6: 集成验证

- [ ] **Step 1: 完整类型检查**

Run: `cd D:/Project/DevForge/devforge && npx vue-tsc --noEmit --pretty`
Expected: 无新增错误

- [ ] **Step 2: Rust 端编译检查**

Run: `cd D:/Project/DevForge/devforge/src-tauri && cargo check`
Expected: 编译通过（允许预已存在的 warnings）

- [ ] **Step 3: 功能验证清单**

以下场景需要手动测试：

1. **工作目录选择**: 顶栏点击"设置工作目录" → 弹出目录选择器 → 选择后显示截取路径
2. **write_file 展示**: 设置工作目录 → 全自动模式 → 对 AI 说"帮我创建一个 hello.ts 文件" → 工具卡片自动展开 → 显示代码高亮预览 + 打开文件按钮
3. **read_file 展示**: 对 AI 说"读取 src/main.ts" → 结果以代码高亮展示（无 `[文件: ...]` 元数据头）
4. **打开文件**: 点击"打开文件"按钮 → 用系统默认程序打开
5. **其他工具**: list_directory / search_files → 保持 `<pre>` 展示不变
6. **未设置工作目录**: 工具不启用，AI 正常输出代码块
7. **大文件截断**: write_file 写入 >200 行文件 → 预览截断显示前 100 行
8. **System prompt**: 普通模式无全自动指引；全自动模式有 write_file 强制指引

- [ ] **Step 4: 最终 Commit（如有微调）**

```bash
git add -u
git commit -m "fix(ai): 文件输出增强集成修复"
```
