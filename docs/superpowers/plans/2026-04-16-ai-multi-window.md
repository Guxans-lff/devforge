# AI 多窗口独立工作区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许用户打开多个独立 AI 对话窗口，每个窗口绑定各自工作区，互不干扰。

**Architecture:** Tauri `WebviewWindowBuilder` 创建独立窗口，加载 `/ai-standalone` 路由对应的精简 AI 视图。每个窗口独立 Vue app 实例，Pinia store 天然隔离。全局快捷键 `Ctrl+Shift+N` 或主窗口按钮触发创建。

**Tech Stack:** Tauri 2.10 (WebviewWindow, global-shortcut plugin), Vue 3.5, Pinia, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-16-ai-multi-window-design.md`

**⚠️ 快捷键变更：** Spec 中写的 `Ctrl+Shift+A` 已被截图功能占用（`src-tauri/src/lib.rs:138`），改用 `Ctrl+Shift+N`。

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src-tauri/src/commands/ai.rs` | 修改 | 新增 `create_ai_window` 命令 |
| `src-tauri/src/lib.rs` | 修改 | 注册命令 + 扩展快捷键 handler |
| `src/views/AiStandaloneView.vue` | 新建 | 独立 AI 窗口视图 |
| `src/main.ts` | 修改 | 新增 `/ai-standalone` 路由 |
| `src/views/AiChatView.vue` | 修改 | Bot 按钮改为打开独立窗口，移除 Tab 多开 |

---

### Task 1: Rust 后端 — create_ai_window 命令

**Files:**
- Modify: `src-tauri/src/commands/ai.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 在 `src-tauri/src/commands/ai.rs` 末尾添加 `create_ai_window` 命令**

```rust
/// 创建独立 AI 对话窗口
///
/// 每个窗口加载 /ai-standalone 路由，拥有独立 JS context。
/// 上限 5 个 AI 窗口。
#[tauri::command]
pub async fn create_ai_window(app: tauri::AppHandle) -> Result<String, String> {
    let ai_count = app
        .webview_windows()
        .keys()
        .filter(|k| k.starts_with("ai-"))
        .count();
    if ai_count >= 5 {
        return Err("最多同时打开 5 个 AI 窗口".into());
    }

    let window_id = format!("ai-{}", chrono::Utc::now().timestamp_millis());
    let url = format!("/ai-standalone?windowId={}", window_id);

    tauri::WebviewWindowBuilder::new(
        &app,
        &window_id,
        tauri::WebviewUrl::App(url.into()),
    )
    .title("AI 对话")
    .inner_size(800.0, 700.0)
    .min_inner_size(480.0, 400.0)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(window_id)
}
```

- [ ] **Step 2: 在 `src-tauri/src/lib.rs` 的 invoke_handler 注册新命令**

在 `ai_cmd::ai_list_compactions,` 之后添加：

```rust
ai_cmd::create_ai_window,
```

- [ ] **Step 3: 验证编译**

Run: `cd src-tauri && cargo check`
Expected: 编译通过，0 errors

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/commands/ai.rs src-tauri/src/lib.rs
git commit -m "feat(ai): 新增 create_ai_window 命令 — 独立 AI 窗口创建"
```

---

### Task 2: 全局快捷键 — Ctrl+Shift+N 创建 AI 窗口

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 扩展全局快捷键 handler**

当前 `lib.rs:137-185` 的 `GsBuilder` 已注册 `ctrl+shift+a`（截图）。需要：
1. 在 `.with_shortcuts(["ctrl+shift+a"])` 改为 `.with_shortcuts(["ctrl+shift+a", "ctrl+shift+n"])`
2. 在 `.with_handler` 闭包内，现有 `Ctrl+Shift+A` 分支之后，添加 `Ctrl+Shift+N` 分支：

```rust
// Ctrl+Shift+N → 新建 AI 独立窗口
if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyN) {
    println!("[GlobalShortcut] 匹配 Ctrl+Shift+N → 新建 AI 窗口");
    let handle = app.clone();
    std::thread::spawn(move || {
        let ai_count = handle.webview_windows().keys()
            .filter(|k| k.starts_with("ai-"))
            .count();
        if ai_count >= 5 {
            log::warn!("[AI] AI 窗口数量已达上限 5");
            return;
        }
        let window_id = format!("ai-{}", chrono::Utc::now().timestamp_millis());
        let url = format!("/ai-standalone?windowId={}", window_id);
        if let Err(e) = tauri::WebviewWindowBuilder::new(
            &handle,
            &window_id,
            tauri::WebviewUrl::App(url.into()),
        )
        .title("AI 对话")
        .inner_size(800.0, 700.0)
        .min_inner_size(480.0, 400.0)
        .build()
        {
            log::error!("[AI] 创建 AI 窗口失败: {e}");
        }
    });
}
```

- [ ] **Step 2: 验证编译**

Run: `cd src-tauri && cargo check`
Expected: 编译通过

- [ ] **Step 3: 提交**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(ai): 全局快捷键 Ctrl+Shift+N 创建 AI 窗口"
```

---

### Task 3: 前端路由 — 新增 /ai-standalone

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: 在 `src/main.ts` 的 routes 数组中添加新路由**

在 `region-select` 路由之后添加：

```typescript
{
  path: '/ai-standalone',
  name: 'ai-standalone',
  component: () => import('@/views/AiStandaloneView.vue'),
},
```

- [ ] **Step 2: 验证类型检查**

Run: `cd devforge && npx vue-tsc --noEmit`
Expected: 会报错找不到 AiStandaloneView.vue（因为还没创建），这是预期的

- [ ] **Step 3: 提交**

```bash
git add src/main.ts
git commit -m "feat(ai): 新增 /ai-standalone 路由"
```

---

### Task 4: AiStandaloneView.vue — 独立 AI 窗口视图

**Files:**
- Create: `src/views/AiStandaloneView.vue`

这是核心文件。基于 `AiChatView.vue` 精简而来，移除 workspace Tab 依赖，新增窗口标题更新和关闭拦截。

- [ ] **Step 1: 创建 `src/views/AiStandaloneView.vue`**

```vue
<script setup lang="ts">
/**
 * 独立 AI 对话窗口视图
 *
 * 通过 Tauri WebviewWindow 独立运行，每个窗口有独立的 Vue app 实例。
 * 从 URL query 解析 windowId，生成独立 sessionId。
 * 窗口关闭前自动保存会话。
 */
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { useAiChatStore } from '@/stores/ai-chat'
import { useAiChat } from '@/composables/useAiChat'
import { useAiMemoryStore } from '@/stores/ai-memory'
import { useFileAttachment, stripMentionMarkers } from '@/composables/useFileAttachment'
import { checkTokenLimit } from '@/utils/file-markers'
import { getCredential } from '@/api/connection'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { ProviderConfig, ModelConfig, AiSession } from '@/types/ai'
import type { ChatMode } from '@/components/ai/AiInputArea.vue'
import AiMessageBubble from '@/components/ai/AiMessageBubble.vue'
import AiInputArea from '@/components/ai/AiInputArea.vue'
import AiUsageBadge from '@/components/ai/AiUsageBadge.vue'
import AiProviderConfig from '@/components/ai/AiProviderConfig.vue'
import AiSessionDrawer from '@/components/ai/AiSessionDrawer.vue'
import AiMemoryDrawer from '@/components/ai/AiMemoryDrawer.vue'
import AiCompactBanner from '@/components/ai/AiCompactBanner.vue'
import WorkspaceFilePicker from '@/components/ai/WorkspaceFilePicker.vue'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  Bot,
  Settings,
  History,
  Plus,
  Sparkles,
  Zap,
  MessageSquareText,
  FolderOpen,
  Brain,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const route = useRoute()
const store = useAiChatStore()
const fileAttachment = useFileAttachment()
const memoryStore = useAiMemoryStore()

// ─────────────────────── 窗口标识 ───────────────────────

/** 从 URL query 解析 windowId */
const windowId = computed(() => (route.query.windowId as string) || `ai-${Date.now()}`)

/** 独立 sessionId，与主窗口命名空间隔离 */
const currentSessionId = computed(() => `session-${windowId.value}`)

// ─────────────────────── 视图状态 ───────────────────────

const currentView = ref<'chat' | 'provider-config'>('chat')
const showSessionDrawer = ref(false)
const showMemoryDrawer = ref(false)
const showFilePicker = ref(false)
const selectedProviderId = ref<string | null>(null)
const selectedModelId = ref<string | null>(null)
const systemPrompt = ref<string | undefined>(undefined)
const chatMode = ref<ChatMode>('normal')

const MODE_SUFFIXES: Record<ChatMode, string> = {
  normal: '',
  plan: '\n\n【模式：规划模式】\n你现在处于规划模式。对于用户的任何请求：\n1. 先详细分析需求，列出关键点\n2. 提出实施方案（如有多个方案则对比优劣）\n3. 列出具体步骤计划\n4. 等待用户确认后才给出最终的代码或执行方案\n不要直接给出代码，先让用户审核你的计划。',
  auto: '\n\n【模式：全自动模式】\n你现在处于全自动模式。对于用户的请求：\n1. 直接完整地分析问题并给出最终解决方案\n2. 包括完整的代码实现、配置、命令等\n3. 主动考虑边界情况、错误处理、性能优化\n4. 给出可直接使用的结果，无需用户二次确认\n以最高效率给出完整、可执行的解决方案。',
}

// ─────────────────────── 对话核心 ───────────────────────

const scrollContainer = ref<HTMLElement | null>(null)

const chat = useAiChat({
  sessionId: currentSessionId,
  scrollContainer,
})

const currentProvider = computed<ProviderConfig | null>(() =>
  store.providers.find(p => p.id === selectedProviderId.value) ?? null,
)

const currentModel = computed<ModelConfig | null>(() =>
  currentProvider.value?.models.find(m => m.id === selectedModelId.value) ?? null,
)

// ─────────────────────── 窗口关闭拦截 ───────────────────────

let unlistenClose: (() => void) | null = null

onMounted(async () => {
  try {
    await store.init()
  } catch (e) {
    chat.error.value = '初始化失败，请刷新重试'
    console.error('[AiStandalone] 初始化失败:', e)
    return
  }

  // 自动选中默认 Provider
  const dp = store.defaultProvider
  if (dp) {
    selectedProviderId.value = dp.id
    const firstModel = dp.models[0]
    if (firstModel) selectedModelId.value = firstModel.id
  }

  if (store.providers.length === 0) {
    currentView.value = 'provider-config'
    return
  }

  if (currentSessionId.value) {
    await chat.loadHistory()
  }

  if (chat.workDir.value) {
    memoryStore.setWorkspace(chat.workDir.value)
  }

  // 拦截窗口关闭 → 先保存会话
  const appWindow = getCurrentWebviewWindow()
  unlistenClose = await appWindow.onCloseRequested(async (event) => {
    await saveCurrentSession()
    // 不阻止关闭
  })
})

onBeforeUnmount(() => {
  unlistenClose?.()
})

// Provider 列表变化时自动选中
watch(() => store.providers, (providers) => {
  if (providers.length > 0 && !selectedProviderId.value) {
    const dp = store.defaultProvider
    if (dp) {
      selectedProviderId.value = dp.id
      const firstModel = dp.models[0]
      if (firstModel) selectedModelId.value = firstModel.id
    }
  }
}, { deep: true })

// 工作目录变化时更新窗口标题
watch(() => chat.workDir.value, async (dir) => {
  const appWindow = getCurrentWebviewWindow()
  if (dir) {
    const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean)
    const name = parts[parts.length - 1] || 'AI'
    await appWindow.setTitle(`AI - ${name}`)
  } else {
    await appWindow.setTitle('AI 对话')
  }
})

// ─────────────────────── 操作 ───────────────────────

const effectiveSystemPrompt = computed(() => {
  const base = systemPrompt.value ?? ''
  const suffix = MODE_SUFFIXES[chatMode.value]
  const enableTools = currentModel.value?.capabilities.toolUse && !!chat.workDir.value
  let toolGuide = ''
  if (enableTools) {
    toolGuide = `\n\n【工具使用指引】\n你可以通过工具调用来操作用户的工作目录中的文件。\n工作目录: ${chat.workDir.value}\n\n使用原则：\n- 需要了解文件内容时，调用工具读取，不要凭记忆猜测\n- 需要创建或修改文件时，调用 write_file 工具直接写入\n- 搜索代码时优先使用 search_files 工具`
    if (chatMode.value === 'auto') {
      toolGuide += `\n\n当用户要求修改或创建文件时，直接调用 write_file 工具写入，不要在回复中输出完整代码块让用户手动保存。`
    }
  }
  const result = base + (suffix || '') + toolGuide
  return result || undefined
})

/** 保存当前会话到 SQLite */
async function saveCurrentSession() {
  if (!currentProvider.value || !currentModel.value) return
  const msgCount = chat.messages.value.filter(m => m.role !== 'error').length
  if (msgCount === 0) return
  const session: AiSession = {
    id: currentSessionId.value,
    title: chat.messages.value.find(m => m.role === 'user')?.content?.slice(0, 30) || '新对话',
    providerId: currentProvider.value.id,
    model: currentModel.value.id,
    systemPrompt: systemPrompt.value,
    messageCount: msgCount,
    totalTokens: chat.totalTokens.value,
    estimatedCost: 0,
    createdAt: chat.messages.value[0]?.timestamp ?? Date.now(),
    updatedAt: Date.now(),
    workDir: chat.workDir.value || undefined,
  }
  await store.saveSession(session).catch(e => console.warn('[AI] 关闭保存失败:', e))
}

async function handleSend(content: string) {
  if (!currentProvider.value || !currentModel.value) return
  const cleanContent = stripMentionMarkers(content)
  const apiKey = await getCredential(`ai-provider-${currentProvider.value.id}`) ?? ''
  if (!apiKey) {
    chat.error.value = '未配置 API Key，请在服务商配置中设置'
    return
  }
  const attachments = fileAttachment.getReadyAttachments()
  if (currentModel.value.capabilities.maxContext > 0) {
    const totalText = cleanContent + attachments.map(f => f.content ?? '').join('')
    const check = checkTokenLimit(totalText, chat.totalTokens.value, currentModel.value.capabilities.maxContext)
    if (check.warn) {
      console.warn(`[AI] Token 接近上限: 预估 ${check.usage} / 上限 ${check.limit}`)
    }
  }
  await chat.send(cleanContent, currentProvider.value, currentModel.value, apiKey, effectiveSystemPrompt.value, attachments)
  fileAttachment.clearAttachments()
}

function handleCreateSession() {
  const newSessionId = `session-${windowId.value}-${Date.now()}`
  store.setActiveSession(newSessionId)
  chat.clearMessages()
  chat.workDir.value = ''
  currentView.value = 'chat'
}

async function handleSelectSession(id: string) {
  store.setActiveSession(id)
  currentView.value = 'chat'
  await chat.loadHistory(id)
}

async function handleDeleteSession(id: string) {
  await store.removeSession(id)
}

/** 打开新的独立 AI 窗口 */
async function handleNewWindow() {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    await invoke('create_ai_window')
  } catch (e) {
    chat.error.value = String(e)
  }
}

function handleMentionFile(path: string) {
  fileAttachment.addFile(path)
}

function handleFilePickerConfirm(paths: string[]) {
  showFilePicker.value = false
  for (const p of paths) fileAttachment.addFile(p)
}

function openProviderConfig() {
  currentView.value = 'provider-config'
}

function handleBackFromConfig() {
  currentView.value = 'chat'
  if (store.providers.length > 0 && !selectedProviderId.value) {
    const dp = store.defaultProvider
    if (dp) {
      selectedProviderId.value = dp.id
      const firstModel = dp.models[0]
      if (firstModel) selectedModelId.value = firstModel.id
    }
  }
}

async function handleSelectWorkDir() {
  const dir = await openDialog({ directory: true, multiple: false })
  if (dir) {
    chat.workDir.value = dir as string
    memoryStore.setWorkspace(dir as string)
    await saveCurrentSession()
  }
}

const workDirDisplay = computed(() => {
  const dir = chat.workDir.value
  if (!dir) return ''
  const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= 2) return parts.join('/')
  return '…/' + parts.slice(-2).join('/')
})

const hasProviders = computed(() => store.providers.length > 0)

const CHAT_MODE_CONFIG = {
  normal: { label: '普通对话', desc: '标准问答交互', icon: MessageSquareText, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  plan: { label: '规划模式', desc: 'AI 先分析规划，确认后执行', icon: Sparkles, color: 'text-violet-500', bg: 'bg-violet-500/10' },
  auto: { label: '全自动', desc: 'AI 自主分析、决策、执行', icon: Zap, color: 'text-amber-500', bg: 'bg-amber-500/10' },
} as const

const currentModeConfig = computed(() => CHAT_MODE_CONFIG[chatMode.value])
</script>

<template>
  <div class="flex h-full flex-col bg-background">
    <!-- Provider 配置页 -->
    <template v-if="currentView === 'provider-config'">
      <AiProviderConfig @back="handleBackFromConfig" />
    </template>

    <!-- 对话页 -->
    <template v-else>
      <!-- 顶栏 -->
      <div class="flex items-center justify-between px-4 py-2 shrink-0 border-b border-border/30">
        <div class="flex items-center gap-1">
          <TooltipProvider :delay-duration="300">
            <!-- 新建对话 -->
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="handleCreateSession">
                  <Plus class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">新建对话</TooltipContent>
            </Tooltip>

            <!-- 新建窗口 -->
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="handleNewWindow">
                  <Bot class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">新窗口</TooltipContent>
            </Tooltip>

            <!-- 历史对话 -->
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="showSessionDrawer = true">
                  <History class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">历史对话</TooltipContent>
            </Tooltip>

            <!-- 配置 -->
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="openProviderConfig">
                  <Settings class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">服务商配置</TooltipContent>
            </Tooltip>

            <!-- 记忆 -->
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="showMemoryDrawer = true">
                  <Brain class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">项目记忆</TooltipContent>
            </Tooltip>
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
        </div>

        <div class="flex items-center gap-2">
          <AiUsageBadge
            v-if="currentModel"
            :prompt-tokens="chat.totalTokens.value"
            :max-context="currentModel.capabilities.maxContext"
            :pricing="currentModel.capabilities.pricing"
          />
        </div>
      </div>

      <!-- 消息区域 -->
      <div ref="scrollContainer" class="flex-1 overflow-y-auto" @scroll="chat.handleScroll">
        <!-- 空状态 -->
        <div
          v-if="chat.messages.value.length === 0 && !chat.isLoading.value"
          class="flex h-full flex-col items-center justify-center text-center px-6"
        >
          <div class="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/5 mb-6">
            <Bot class="h-10 w-10 text-primary/40" />
          </div>
          <h2 class="text-xl font-semibold text-foreground/80 mb-2">AI 助手</h2>
          <p class="text-sm text-muted-foreground max-w-md leading-relaxed">
            {{ hasProviders ? '有什么可以帮你的？选择模型后开始对话。' : '请先配置 AI 服务商和 API Key。' }}
          </p>
          <Button v-if="!hasProviders" variant="outline" size="sm" class="mt-6" @click="openProviderConfig">
            <Settings class="mr-2 h-4 w-4" />
            配置服务商
          </Button>

          <div v-if="hasProviders" class="mt-8 flex items-center gap-2">
            <div :class="[currentModeConfig.bg, 'rounded-full px-3 py-1.5 flex items-center gap-1.5']">
              <component :is="currentModeConfig.icon" class="h-3.5 w-3.5" :class="currentModeConfig.color" />
              <span class="text-xs font-medium" :class="currentModeConfig.color">{{ currentModeConfig.label }}</span>
            </div>
            <span class="text-xs text-muted-foreground">{{ currentModeConfig.desc }}</span>
          </div>

          <div v-if="hasProviders" class="mt-8 grid grid-cols-2 gap-2 max-w-sm">
            <button class="rounded-lg border border-border/30 px-4 py-3 text-left hover:bg-muted/30 transition-colors" @click="chatMode = 'plan'">
              <Sparkles class="h-4 w-4 text-violet-500 mb-1.5" />
              <p class="text-xs font-medium">规划模式</p>
              <p class="text-[10px] text-muted-foreground">先规划后执行</p>
            </button>
            <button class="rounded-lg border border-border/30 px-4 py-3 text-left hover:bg-muted/30 transition-colors" @click="chatMode = 'auto'">
              <Zap class="h-4 w-4 text-amber-500 mb-1.5" />
              <p class="text-xs font-medium">全自动模式</p>
              <p class="text-[10px] text-muted-foreground">AI 直接给出方案</p>
            </button>
          </div>
        </div>

        <!-- 消息列表 -->
        <div v-else class="px-4 pb-4">
          <AiMessageBubble v-for="msg in chat.messages.value" :key="msg.id" :message="msg" />
        </div>
      </div>

      <!-- 压缩提示 -->
      <AiCompactBanner :visible="chat.isCompacting?.value ?? false" />

      <!-- 错误提示 -->
      <div v-if="chat.error.value" class="mx-auto max-w-4xl px-5 mb-2">
        <div class="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {{ chat.error.value }}
        </div>
      </div>

      <!-- 输入区 -->
      <div class="mx-auto w-full max-w-4xl px-5">
        <AiInputArea
          :is-streaming="chat.isStreaming.value"
          :disabled="!hasProviders || !currentModel"
          :loading="chat.isLoading.value"
          :providers="store.providers"
          :selected-provider-id="selectedProviderId"
          :selected-model-id="selectedModelId"
          :chat-mode="chatMode"
          :attachments="fileAttachment.attachments.value"
          :placeholder="chatMode === 'plan' ? '描述你的需求，AI 将先给出规划方案…' : chatMode === 'auto' ? '描述任务，AI 将自动分析并给出完整方案…' : '发送消息…'"
          @send="handleSend"
          @abort="chat.abort"
          @update:selected-provider-id="selectedProviderId = $event"
          @update:selected-model-id="selectedModelId = $event"
          @update:chat-mode="chatMode = $event"
          @open-config="openProviderConfig"
          @select-files="showFilePicker = true"
          @drop-files="fileAttachment.handleDomDrop"
          @drop-file-path="handleMentionFile"
          @remove-attachment="fileAttachment.removeAttachment"
          @mention-file="handleMentionFile"
        />
      </div>
    </template>

    <!-- 历史会话抽屉 -->
    <AiSessionDrawer
      :open="showSessionDrawer"
      :sessions="store.sessions"
      :active-session-id="store.activeSessionId"
      @update:open="showSessionDrawer = $event"
      @select="handleSelectSession"
      @create="handleCreateSession"
      @delete="handleDeleteSession"
    />

    <!-- 工作区文件选择器 -->
    <WorkspaceFilePicker
      v-if="showFilePicker"
      @confirm="handleFilePickerConfirm"
      @close="showFilePicker = false"
    />

    <!-- 记忆管理抽屉 -->
    <AiMemoryDrawer
      :open="showMemoryDrawer"
      @update:open="showMemoryDrawer = $event"
    />
  </div>
</template>
```

- [ ] **Step 2: 验证类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: 提交**

```bash
git add src/views/AiStandaloneView.vue
git commit -m "feat(ai): 新增 AiStandaloneView — 独立 AI 窗口视图"
```

---

### Task 5: 主窗口改造 — Bot 按钮改为打开独立窗口

**Files:**
- Modify: `src/views/AiChatView.vue`

- [ ] **Step 1: 修改 `handleNewAiTab` 为调用 `create_ai_window`**

将 `AiChatView.vue` 中的 `handleNewAiTab` 函数替换为：

```typescript
/** 打开独立 AI 窗口 */
async function handleNewAiWindow() {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    await invoke('create_ai_window')
  } catch (e) {
    chat.error.value = String(e)
  }
}
```

- [ ] **Step 2: 更新模板中的按钮绑定**

将模板中 `@click="handleNewAiTab"` 改为 `@click="handleNewAiWindow"`。

- [ ] **Step 3: 验证类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: 提交**

```bash
git add src/views/AiChatView.vue
git commit -m "feat(ai): 主窗口 Bot 按钮改为打开独立窗口"
```

---

### Task 6: 构建验证

- [ ] **Step 1: 前端完整类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: 前端构建**

Run: `npx vite build`
Expected: 构建成功

- [ ] **Step 3: 后端编译**

Run: `cd src-tauri && cargo check`
Expected: 0 errors

- [ ] **Step 4: 手动测试清单**

| 场景 | 预期 |
|------|------|
| 主窗口点击 Bot 按钮 | 弹出独立 AI 窗口（800×700） |
| 独立窗口选择工作目录 | 窗口标题更新为 "AI - {目录名}" |
| 独立窗口发送消息 | 正常对话，不影响主窗口 |
| 同时开 2 个独立窗口 | 各自独立对话，不互相干扰 |
| 尝试开第 6 个窗口 | 收到错误提示"最多同时打开 5 个 AI 窗口" |
| 关闭独立窗口 | 会话自动保存到历史列表 |
| 全局快捷键 Ctrl+Shift+N | 弹出新 AI 窗口 |
| 截图快捷键 Ctrl+Shift+A | 仍触发截图（不受影响） |
