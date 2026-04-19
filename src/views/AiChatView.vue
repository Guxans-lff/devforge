<script setup lang="ts">
/**
 * AI 对话主视图 — 沉浸式体验
 *
 * 全屏居中消息流，底部输入区集成模型/模式切换，
 * 历史对话通过 Sheet 抽屉访问，支持多 Tab 独立对话。
 */
import { ref, computed, onMounted, onActivated, watch, shallowRef } from 'vue'
import { useAiChatStore } from '@/stores/ai-chat'
import { useAiChat } from '@/composables/useAiChat'
import { useAiMemoryStore } from '@/stores/ai-memory'
import { useFileAttachment, stripMentionMarkers } from '@/composables/useFileAttachment'
import { checkTokenLimit } from '@/utils/file-markers'
import { buildToolGuide } from '@/utils/ai-prompts'
import { setApprovalMode, setActiveSessionId } from '@/composables/useToolApproval'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import { getCredential } from '@/api/connection'
import type { ProviderConfig, ModelConfig, AiSession } from '@/types/ai'
import type { ChatMode } from '@/components/ai/AiInputArea.vue'
import AiMessageBubble from '@/components/ai/AiMessageBubble.vue'
import AiInputArea from '@/components/ai/AiInputArea.vue'
import AiUsageBadge from '@/components/ai/AiUsageBadge.vue'
import AiProviderConfig from '@/components/ai/AiProviderConfig.vue'
import AiSessionDrawer from '@/components/ai/AiSessionDrawer.vue'
import AiMemoryDrawer from '@/components/ai/AiMemoryDrawer.vue'
import AiCompactBanner from '@/components/ai/AiCompactBanner.vue'
import AiPlanGateBar from '@/components/ai/AiPlanGateBar.vue'
import AiPhaseBar from '@/components/ai/AiPhaseBar.vue'
import AiSpawnedTasksPanel from '@/components/ai/AiSpawnedTasksPanel.vue'
import WorkspaceFilePicker from '@/components/ai/WorkspaceFilePicker.vue'
import {
  Bot,
  Settings,
  History,
  Plus,
  Minimize2,
  Sparkles,
  Zap,
  MessageSquareText,
  FolderOpen,
  Brain,
  Check,
} from 'lucide-vue-next'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const store = useAiChatStore()
const workspace = useWorkspaceStore()
const wsFiles = useWorkspaceFilesStore()
const fileAttachment = useFileAttachment()
const memoryStore = useAiMemoryStore()

// ─────────────────────── 视图状态 ───────────────────────

/** 当前视图：对话 or 配置 */
const currentView = ref<'chat' | 'provider-config'>('chat')

/** 历史对话抽屉是否打开 */
const showSessionDrawer = ref(false)

/** 记忆管理抽屉是否打开 */
const showMemoryDrawer = ref(false)

/** 工作区文件选择器是否打开 */
const showFilePicker = ref(false)

// 当前选中的 Provider 和 Model
const selectedProviderId = ref<string | null>(null)
const selectedModelId = ref<string | null>(null)
const systemPrompt = ref<string | undefined>(undefined)

// 对话模式
const chatMode = ref<ChatMode>('normal')

// 将 chatMode 映射到 useToolApproval 的三态审批模式：
// - auto → 全自动放行（大哥明确授权）
// - plan → 全拒绝副作用（只读规划）
// - normal → 正常弹窗
watch(chatMode, (m) => {
  setApprovalMode(m === 'auto' ? 'auto' : m === 'plan' || m === 'dispatcher' ? 'deny' : 'ask', currentSessionId.value)
  // 规划模式自动开启门控；离开规划模式时关闭
  if (m === 'plan') {
    chat.planGateEnabled.value = true
    chat.planApproved.value = false
  } else {
    chat.planGateEnabled.value = false
    chat.planApproved.value = false
  }
}, { immediate: true })

/** 模式对应的 system prompt 后缀 */
const MODE_SUFFIXES: Record<ChatMode, string> = {
  normal: '',
  plan: '\n\n【模式：规划模式】\n你现在处于规划模式。对于用户的任何请求：\n1. 先详细分析需求，列出关键点\n2. 提出实施方案（如有多个方案则对比优劣）\n3. 列出具体步骤计划\n4. 等待用户确认后才给出最终的代码或执行方案\n不要直接给出代码，先让用户审核你的计划。',
  auto: '\n\n【模式：全自动模式】\n你现在处于全自动模式。对于用户的请求：\n1. 直接完整地分析问题并给出最终解决方案\n2. 包括完整的代码实现、配置、命令等\n3. 主动考虑边界情况、错误处理、性能优化\n4. 给出可直接使用的结果，无需用户二次确认\n以最高效率给出完整、可执行的解决方案。',
  dispatcher: '\n\n【模式：Dispatcher 调度模式】\n你现在处于调度模式。你的角色是协调者，不直接操作文件：\n1. 将用户的需求拆解为多个独立子任务\n2. 用 [SPAWN:子任务描述] 标记来声明要创建的子任务\n3. 每个子任务应该是自包含的、可独立执行的\n4. 子任务完成后，综合汇报结果\n例如：[SPAWN:分析 src/api 目录下所有文件的接口定义] [SPAWN:检查 package.json 的依赖版本]',
}

// ─────────────────────── 对话核心 ───────────────────────

const scrollContainer = ref<HTMLElement | null>(null)

const LAST_SESSION_KEY = 'devforge:ai:lastSessionId'

/**
 * 锁定到 setup 时刻所属的 Tab —— 每个 KeepAlive 缓存的实例都有自己的 ownTabId，
 * 不再跟随全局 workspace.activeTab 漂移（修复多 Tab 互相串扰 / 互停 bug）
 */
const ownTabId = workspace.activeTabId
const ownTab = workspace.tabs.find(t => t.id === ownTabId)

/** 该实例锁定的 sessionId（只在初始化时计算一次） */
const currentSessionId = ref<string>(
  (ownTab?.meta?.sessionId as string | undefined)
    ?? localStorage.getItem(LAST_SESSION_KEY)
    ?? `session-${randomUUID()}`,
)

// 监听自己 tab 的 meta.sessionId 变化（用户在抽屉里切换历史会话时）
watch(
  () => workspace.tabs.find(t => t.id === ownTabId)?.meta?.sessionId,
  (sid) => {
    if (typeof sid === 'string' && sid && sid !== currentSessionId.value) {
      currentSessionId.value = sid
    }
  },
)

const chat = useAiChat({
  sessionId: currentSessionId,
  scrollContainer,
})

// sessionId 变化时：1) 写入 localStorage；2) workspace 恢复后切换到真实 sessionId 时重新加载历史
// immediate: true 确保初始值写入 localStorage
// oldId 有值说明是运行时切换（如 workspace.restoreState 完成后的响应式更新），需重新加载
let _watchLoadTimer: ReturnType<typeof setTimeout> | null = null
watch(currentSessionId, (id, oldId) => {
  if (id) localStorage.setItem(LAST_SESSION_KEY, id)
  if (id && oldId && id !== oldId) {
    // 防抖 50ms：workspace 恢复可能连续触发多次响应式更新，只取最后一次
    if (_watchLoadTimer) clearTimeout(_watchLoadTimer)
    _watchLoadTimer = setTimeout(() => {
      _watchLoadTimer = null
      chat.loadHistory(id).catch((e) => console.warn('[AiChatView] watch loadHistory failed:', e))
    }, 50)
  }
}, { immediate: true })

// ─────────────────────── 消息分组（时间线聚合） ───────────────────────

/**
 * 将连续的 assistant 消息聚合成组，组内共享头像/名字，用时间线竖线连接。
 * user / error / divider 消息各自独立（groupSize=1）。
 */
interface MessageGroup {
  /** 组内第一条消息的索引，用于判断是否显示头像 */
  isGroupStart: boolean
  /** 是否是组内最后一条（最后一条不画竖线） */
  isGroupEnd: boolean
  /** 组的长度（>1 代表连续 assistant） */
  groupSize: number
  msg: typeof chat.messages.value[0]
}

const groupedMessages = computed<MessageGroup[]>(() => {
  const msgs = chat.messages.value
  const result: MessageGroup[] = []
  let i = 0
  while (i < msgs.length) {
    const msg = msgs[i]!
    // divider / user / error 独立行
    if (msg.type === 'divider' || msg.role === 'user' || msg.role === 'error') {
      result.push({ isGroupStart: true, isGroupEnd: true, groupSize: 1, msg })
      i++
      continue
    }
    // 收集连续 assistant 组
    let j = i
    while (j < msgs.length && msgs[j]!.role === 'assistant' && msgs[j]!.type !== 'divider') {
      j++
    }
    const groupSize = j - i
    for (let k = i; k < j; k++) {
      result.push({
        isGroupStart: k === i,
        isGroupEnd: k === j - 1,
        groupSize,
        msg: msgs[k]!,
      })
    }
    i = j
  }
  return result
})

/** 最新一条 user 消息的 id（用于吸顶） */
const latestUserMsgId = computed(() => {
  const msgs = chat.messages.value
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]!.role === 'user') return msgs[i]!.id
  }
  return null
})

/** 当前选中的 Provider 配置 */
const currentProvider = computed<ProviderConfig | null>(() =>
  store.providers.find(p => p.id === selectedProviderId.value) ?? null,
)

/** 当前选中的模型配置 */
const currentModel = computed<ModelConfig | null>(() =>
  currentProvider.value?.models.find(m => m.id === selectedModelId.value) ?? null,
)

// ─────────────────────── 初始化 ───────────────────────

onMounted(async () => {
  // 设置当前活跃 session
  if (currentSessionId.value) setActiveSessionId(currentSessionId.value)

  try {
    await store.init()
  } catch (e) {
    chat.error.value = '初始化失败，请刷新重试'
    console.error('[AiChatView] 初始化失败:', e)
    return
  }

  // 自动选中默认 Provider
  const dp = store.defaultProvider
  if (dp) {
    selectedProviderId.value = dp.id
    const firstModel = dp.models[0]
    if (firstModel) {
      selectedModelId.value = firstModel.id
    }
  }

  // 没有 Provider → 自动打开配置页
  if (store.providers.length === 0) {
    currentView.value = 'provider-config'
    return
  }

  // 加载当前会话的历史
  if (currentSessionId.value) {
    await chat.loadHistory()
  }

  // 初始化记忆 store（使用当前工作目录）
  if (chat.workDir.value) {
    memoryStore.setWorkspace(chat.workDir.value)
    // 加载工作区 AI 配置
    await store.loadWorkspaceConfig(chat.workDir.value)
    // 若 workspace config 有首选模型，覆盖当前选择
    const wsCfg = store.currentWorkspaceConfig
    if (wsCfg?.preferredModel) {
      const found = store.providers.flatMap(p => p.models).find(m => m.id === wsCfg.preferredModel)
      if (found) {
        const provider = store.providers.find(p => p.models.some(m => m.id === found.id))
        if (provider) { selectedProviderId.value = provider.id; selectedModelId.value = found.id }
      }
    }
  }
})

// KeepAlive 激活时按当前 sessionId 重载历史，避免缓存实例显示空白
// 关键：流式中 / 已有消息时跳过重载，否则会把正在流式的消息（DB 还没保存）擦掉
onActivated(async () => {
  const sid = currentSessionId.value
  if (!sid) return
  // Tab 激活时，更新活跃 sessionId（使审批弹窗绑定到当前 Tab）
  setActiveSessionId(sid)
  // Tab 切换回来后强制滚到底（用户期望看到最新消息，而非记忆滚动位置）
  requestAnimationFrame(() => {
    chat.scrollToBottom()
    // 二次保险：等虚拟列表 measure 完成
    setTimeout(() => chat.scrollToBottom(), 60)
  })
  if (chat.isStreaming.value) return
  if (chat.messages.value.length > 0) return
  try {
    await chat.loadHistory(sid)
  } catch (e) {
    console.warn('[AiChatView] onActivated loadHistory failed:', e)
  }
})

// Provider 列表变化时自动选中
watch(() => store.providers, (providers) => {
  if (providers.length > 0 && !selectedProviderId.value) {
    const dp = store.defaultProvider
    if (dp) {
      selectedProviderId.value = dp.id
      const firstModel = dp.models[0]
      if (firstModel) {
        selectedModelId.value = firstModel.id
      }
    }
  }
}, { deep: true })

// ─────────────────────── 操作 ───────────────────────

/** 计算实际的 system prompt（拼接模式后缀 + 工具行为指引） */
const effectiveSystemPrompt = computed(() => {
  const base = systemPrompt.value ?? ''
  const suffix = MODE_SUFFIXES[chatMode.value]

  // 工具行为指引（模型支持 Tool Use + 有工作目录时追加）
  const enableTools = currentModel.value?.capabilities.toolUse && !!chat.workDir.value
  const toolGuide = enableTools
    ? buildToolGuide({
        workDir: chat.workDir.value,
        chatMode: chatMode.value,
        modelId: currentModel.value?.id,
        ideContext: wsFiles.activeEditor,
      })
    : ''

  const result = base + (suffix || '') + toolGuide
  return result || undefined
})

// ─────────────────────── G15：消息队列 ───────────────────────
/** 流式进行中时暂存的待发消息队列 */
const messageQueue = ref<string[]>([])
const queueAttachments = ref<ReturnType<typeof fileAttachment.getReadyAttachments>[]>([])

/** 发送消息（支持队列） */
async function handleSend(content: string) {
  if (!currentProvider.value || !currentModel.value) return

  // 如果正在流式：将消息加入队列，不立即发送
  if (chat.isStreaming.value) {
    const pendingAttachments = fileAttachment.getReadyAttachments()
    fileAttachment.clearAttachments()
    messageQueue.value.push(content)
    queueAttachments.value.push(pendingAttachments)
    return
  }

  await _doSend(content, fileAttachment.getReadyAttachments())
  fileAttachment.clearAttachments()

  // 消费队列中的下一条
  while (messageQueue.value.length > 0 && !chat.isStreaming.value) {
    const next = messageQueue.value.shift()!
    const nextAttachments = queueAttachments.value.shift() ?? []
    await _doSend(next, nextAttachments)
  }
}

async function _doSend(content: string, attachments: ReturnType<typeof fileAttachment.getReadyAttachments>) {
  if (!currentProvider.value || !currentModel.value) return

  const cleanContent = stripMentionMarkers(content)

  // 从系统密钥环读取 API Key
  const apiKey = await getCredential(`ai-provider-${currentProvider.value.id}`) ?? ''
  if (!apiKey) {
    chat.error.value = '未配置 API Key，请在服务商配置中设置'
    return
  }

  // Token 超限检查
  if (currentModel.value.capabilities.maxContext > 0) {
    const totalText = cleanContent + attachments.map(f => f.content ?? '').join('')
    const check = checkTokenLimit(totalText, chat.totalTokens.value, currentModel.value.capabilities.maxContext)
    if (check.warn) {
      console.warn(`[AI] Token 接近上限: 预估 ${check.usage} / 上限 ${check.limit}`)
      // 仅警告，不阻止发送
    }
  }

  await chat.send(
    cleanContent,
    currentProvider.value,
    currentModel.value,
    apiKey,
    effectiveSystemPrompt.value,
    attachments,
  )

  // 第一条消息发出后自动生成短标题
  const tab = workspace.tabs.find(t => t.id === ownTabId)
  if (tab && tab.title === 'AI 对话' && cleanContent.trim()) {
    const meaningful = cleanContent.trim().replace(/^[A-Za-z]:\\[^\s]*/g, '').trim() || cleanContent.trim()
    const short = meaningful.replace(/\s+/g, ' ').slice(0, 12)
    workspace.updateTabTitle(tab.id, short)
  }
}

/** 继续生成（基于最后一条用户消息重新发起一轮流式） */
async function handleContinue() {
  if (!currentProvider.value || !currentModel.value) return
  const apiKey = await getCredential(`ai-provider-${currentProvider.value.id}`) ?? ''
  if (!apiKey) {
    chat.error.value = '未配置 API Key'
    return
  }
  await chat.regenerate(currentProvider.value, currentModel.value, apiKey, effectiveSystemPrompt.value)
}

/** 一键调大当前模型 maxOutput 并继续刚才未完成的任务
 * 策略：改配置 + 移除最后的 error → 追加一条引导消息继续推进（保留全部上下文）
 * 不走 regenerate 因为那会删除最后一条 user 消息让模型从头重新规划。
 */
async function handleBumpMaxOutput(value: number) {
  if (!currentProvider.value || !currentModel.value) return
  const apiKey = await getCredential(`ai-provider-${currentProvider.value.id}`) ?? ''
  if (!apiKey) {
    chat.error.value = '未配置 API Key'
    return
  }
  const provider = currentProvider.value
  const modelId = currentModel.value.id
  const next: ProviderConfig = {
    ...provider,
    models: provider.models.map(m =>
      m.id === modelId
        ? { ...m, capabilities: { ...m.capabilities, maxOutput: value } }
        : m,
    ),
  }
  await store.saveProvider(next)
  // 移除最后一条 error（max_tokens 截断错误），保留之前所有 user/assistant/tool 上下文
  chat.removeLastError()
  // 追加引导消息让 MiMo 继续上一轮 todo 推进到下一步
  const nextProvider = store.providers.find(p => p.id === provider.id) ?? next
  const nextModel = nextProvider.models.find(m => m.id === modelId) ?? currentModel.value
  await chat.send(
    '已调大输出预算，请接着上一轮未完成的任务清单继续推进，不要重复已完成步骤',
    nextProvider,
    nextModel,
    apiKey,
    effectiveSystemPrompt.value,
  )
}

// ─────────────────────── Plan Gate 处理 ───────────────────────

/** 用户确认 AI 计划 — 向 AI 发送继续执行指令 */
async function handlePlanApprove() {
  if (!currentProvider.value || !currentModel.value) return
  const apiKey = await getCredential(`ai-provider-${currentProvider.value.id}`) ?? ''
  chat.approvePlan()
  // 发送确认消息触发 AI 开始执行计划
  await chat.send(
    '[用户已确认执行计划，请按照计划开始执行，可以使用工具完成任务。]',
    currentProvider.value,
    currentModel.value,
    apiKey,
    effectiveSystemPrompt.value,
  )
}

/** 用户拒绝计划 — 重置状态，让 AI 重新规划 */
function handlePlanReject() {
  chat.rejectPlan()
}

// ─────────────────────── Dispatcher 子任务 ───────────────────────

/** 执行 Dispatcher 子任务：在新 Tab 中创建新 session 并发送任务描述 */
async function handleSpawnRun(taskId: string) {
  if (!currentProvider.value || !currentModel.value) return
  const task = chat.spawnedTasks.value.find(t => t.id === taskId)
  if (!task) return

  // 更新任务状态为 running
  const idx = chat.spawnedTasks.value.findIndex(t => t.id === taskId)
  if (idx !== -1) {
    chat.spawnedTasks.value[idx] = { ...chat.spawnedTasks.value[idx]!, status: 'running' }
  }

  // 新建 Tab + session
  const tabId = `ai-chat-${Date.now()}`
  const newSessionId = `session-${Date.now()}`
  workspace.addTab({
    id: tabId,
    type: 'ai-chat',
    title: `[子任务] ${task.description.slice(0, 20)}`,
    closable: true,
    meta: { sessionId: newSessionId, initialMessage: task.description },
  })

  // 标记完成（子 session 独立运行）
  setTimeout(() => {
    const i = chat.spawnedTasks.value.findIndex(t => t.id === taskId)
    if (i !== -1) {
      chat.spawnedTasks.value[i] = { ...chat.spawnedTasks.value[i]!, status: 'done' }
    }
  }, 500)
}

/** 新建 AI Chat Tab */
function handleNewAiTab() {
  const tabId = `ai-chat-${Date.now()}`
  const newSessionId = `session-${Date.now()}`
  workspace.addTab({
    id: tabId,
    type: 'ai-chat',
    title: 'AI 对话',
    closable: true,
    meta: { sessionId: newSessionId },
  })
}

/** 切换模型（有消息时插入分割线） */
function handleModelChange(newModelId: string) {
  const oldModelId = selectedModelId.value
  selectedModelId.value = newModelId
  if (!oldModelId || !newModelId || oldModelId === newModelId) return
  if (chat.messages.value.length === 0) return
  const newModel = currentProvider.value?.models.find(m => m.id === newModelId)
  const label = newModel?.name ?? newModelId
  chat.messages.value.push({
    id: `divider-${Date.now()}`,
    role: 'system',
    type: 'divider',
    dividerText: `切换模型 · ${label}`,
    content: '',
    timestamp: Date.now(),
  })
}

/** 手动压缩对话历史 */
async function handleCompact() {
  if (!currentProvider.value || !currentModel.value) return
  const apiKey = await getCredential(`ai-provider-${currentProvider.value.id}`) ?? ''
  if (!apiKey) { chat.error.value = '未配置 API Key'; return }
  const ok = await chat.manualCompact(currentProvider.value, currentModel.value, apiKey)
  if (!ok) {
    chat.error.value = '压缩失败：消息太少或模型不可用'
  } else {
    chat.scrollToBottom()
  }
}

/** 新建会话（在当前 Tab 内新建） */
function handleCreateSession() {
  const newSessionId = `session-${Date.now()}`
  const tab = workspace.tabs.find(t => t.id === ownTabId)
  if (tab) {
    workspace.updateTabMeta(tab.id, { sessionId: newSessionId })
  }
  // 同步更新本实例锁定的 sessionId
  currentSessionId.value = newSessionId
  store.setActiveSession(newSessionId)
  chat.clearMessages()
  currentView.value = 'chat'
}

/** 选择历史会话 */
async function handleSelectSession(id: string) {
  // 通过 store 方法更新 Tab meta（不可变）
  const tab = workspace.tabs.find(t => t.id === ownTabId)
  if (tab) {
    workspace.updateTabMeta(tab.id, { sessionId: id })
  }
  currentSessionId.value = id
  store.setActiveSession(id)
  currentView.value = 'chat'
  // 显式传入 sessionId，避免 computed 响应式延迟
  await chat.loadHistory(id)
}

/** 删除会话 */
async function handleDeleteSession(id: string) {
  await store.removeSession(id)
}

/** 打开独立 AI 窗口 */
async function handleNewAiWindow() {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    await invoke('create_ai_window')
  } catch (e) {
    chat.error.value = String(e)
  }
}

/** 是否有 Provider 配置 */
const hasProviders = computed(() => store.providers.length > 0)

/** G24：上下文用量百分比，超 80% 显示警告条 */
const contextUsagePercent = computed(() => {
  const max = currentModel.value?.capabilities.maxContext ?? 0
  if (!max) return 0
  return Math.min((chat.totalTokens.value / max) * 100, 100)
})

/** @ 引用文件 */
function handleMentionFile(path: string) {
  fileAttachment.addFile(path)
}

/** 工作区文件选择器确认 */
function handleFilePickerConfirm(paths: string[]) {
  showFilePicker.value = false
  for (const p of paths) {
    fileAttachment.addFile(p)
  }
}

/** 打开/关闭配置页 */
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
      if (firstModel) {
        selectedModelId.value = firstModel.id
      }
    }
  }
}

/** 退出沉浸式模式 */
function exitImmersive() {
  workspace.exitImmersive()
}

/** 选择工作目录 */
async function handleSelectWorkDir() {
  const dir = await openDialog({ directory: true, multiple: false })
  if (dir) setWorkDir(dir as string)
}

/** 直接切换到某个已知工作目录（传空串表示清除） */
function setWorkDir(dir: string) {
  chat.workDir.value = dir
  if (dir) {
    memoryStore.setWorkspace(dir)
    store.loadWorkspaceConfig(dir).catch(e => console.warn('[AiChatView] 加载 workspace config 失败:', e))
  }
  const sid = currentSessionId.value
  if (sid && currentProvider.value && currentModel.value) {
    const session: AiSession = {
      id: sid,
      title: '新对话',
      providerId: currentProvider.value.id,
      model: currentModel.value.id,
      systemPrompt: systemPrompt.value,
      messageCount: chat.messages.value.filter(m => m.role !== 'error').length,
      totalTokens: chat.totalTokens.value,
      estimatedCost: 0,
      createdAt: chat.messages.value[0]?.timestamp ?? Date.now(),
      updatedAt: Date.now(),
      workDir: dir || undefined,
    }
    store.saveSession(session).catch(e => console.warn('[AI] 保存工作目录失败:', e))
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

/** 模式配置（用于空状态显示） */
const CHAT_MODE_CONFIG = {
  normal: { label: '普通对话', desc: '标准问答交互', icon: MessageSquareText, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  plan: { label: '规划模式', desc: 'AI 先分析规划，确认后执行', icon: Sparkles, color: 'text-violet-500', bg: 'bg-violet-500/10' },
  auto: { label: '全自动', desc: 'AI 自主分析、决策、执行', icon: Zap, color: 'text-amber-500', bg: 'bg-amber-500/10' },
} as const

</script>

<template>
  <div class="flex h-full flex-col">
    <!-- ==================== Provider 配置页 ==================== -->
    <template v-if="currentView === 'provider-config'">
      <AiProviderConfig @back="handleBackFromConfig" />
    </template>

    <!-- ==================== 沉浸式对话页 ==================== -->
    <template v-else>
      <!-- 极简顶栏 -->
      <div class="flex items-center justify-between px-4 py-2 shrink-0">
        <div class="flex items-center gap-1">
          <TooltipProvider :delay-duration="300">
            <!-- 新建 Tab -->
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="handleNewAiTab">
                  <Plus class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">新建 Tab</TooltipContent>
            </Tooltip>

            <!-- 新建窗口 -->
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="handleNewAiWindow">
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
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button
                class="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors"
                :class="chat.workDir.value
                  ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  : 'text-muted-foreground/40 hover:text-muted-foreground/60 hover:bg-muted/50'"
                :title="chat.workDir.value || '设置工作目录（启用 AI 文件操作）'"
              >
                <FolderOpen class="h-3.5 w-3.5" />
                <span v-if="chat.workDir.value">{{ workDirDisplay }}</span>
                <span v-else>设置工作目录</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="w-64">
              <DropdownMenuLabel class="text-[11px] text-muted-foreground">资源管理器中的目录</DropdownMenuLabel>
              <DropdownMenuItem
                v-for="root in chat.availableWorkDirs.value"
                :key="root.value"
                class="flex items-center justify-between gap-2 text-[12px]"
                @select="setWorkDir(root.value)"
              >
                <span class="truncate" :title="root.value">{{ root.label }}</span>
                <Check v-if="chat.workDir.value === root.value" class="h-3.5 w-3.5 text-primary shrink-0" />
              </DropdownMenuItem>
              <div
                v-if="chat.availableWorkDirs.value.length === 0"
                class="px-2 py-1.5 text-[11px] text-muted-foreground"
              >资源管理器尚未添加文件夹</div>
              <DropdownMenuSeparator />
              <DropdownMenuItem class="text-[12px]" @select="handleSelectWorkDir">
                <FolderOpen class="mr-2 h-3.5 w-3.5" />
                浏览其他目录…
              </DropdownMenuItem>
              <DropdownMenuItem
                v-if="chat.workDir.value"
                class="text-[12px] text-muted-foreground"
                @select="setWorkDir('')"
              >
                清除工作目录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div class="flex items-center gap-2">
          <!-- Token 用量 -->
          <AiUsageBadge
            v-if="currentModel"
            :prompt-tokens="chat.totalTokens.value"
            :max-context="currentModel.capabilities.maxContext"
            :pricing="currentModel.capabilities.pricing"
          />

          <!-- 退出沉浸式 -->
          <TooltipProvider :delay-duration="300">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="exitImmersive">
                  <Minimize2 class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">退出沉浸式</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <!-- 消息区域（居中） -->
      <div
        ref="scrollContainer"
        class="flex-1 overflow-y-auto"
        @scroll="chat.handleScroll"
      >
        <!-- 空状态 -->
        <div
          v-if="chat.messages.value.length === 0 && !chat.isLoading.value"
          class="flex h-full flex-col items-center justify-center text-center px-6"
        >
          <div class="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/5 mb-6">
            <Bot class="h-10 w-10 text-primary/40" />
          </div>
          <h2 class="text-xl font-semibold text-foreground/80 mb-2">AI 助手</h2>
          <p class="text-sm text-muted-foreground/70 max-w-md leading-relaxed">
            {{ hasProviders ? '有什么可以帮你的？选择模型后开始对话。' : '请先配置 AI 服务商和 API Key。' }}
          </p>
          <Button
            v-if="!hasProviders"
            variant="outline"
            size="sm"
            class="mt-6"
            @click="openProviderConfig"
          >
            <Settings class="mr-2 h-4 w-4" />
            配置服务商
          </Button>

          <!-- 模式三宫格 -->
          <div v-if="hasProviders" class="mt-8 grid grid-cols-3 gap-3 w-full max-w-md">
            <button
              v-for="(cfg, mode) in CHAT_MODE_CONFIG"
              :key="mode"
              class="rounded-xl border px-4 py-4 text-left transition-all"
              :class="chatMode === mode
                ? 'border-primary/40 bg-primary/5 shadow-sm'
                : 'border-border/30 hover:border-border/60 hover:bg-muted/40'"
              @click="chatMode = mode"
            >
              <component :is="cfg.icon" class="h-4 w-4 mb-2" :class="cfg.color" />
              <p class="text-xs font-semibold leading-tight">{{ cfg.label }}</p>
              <p class="text-[10px] text-muted-foreground/60 mt-0.5 leading-tight">{{ cfg.desc }}</p>
            </button>
          </div>
        </div>

        <!-- 消息列表 -->
        <div v-else class="py-2">
          <div
            v-for="(item, idx) in groupedMessages"
            :key="item.msg.id"
            :data-index="idx"
            class="px-4"
            :class="[
              item.msg.role === 'user'
                ? 'pt-5'
                : item.isGroupStart
                  ? 'pt-4'
                  : 'pt-3',
              // 最新 user 消息：sticky 吸顶
              item.msg.id === latestUserMsgId ? 'sticky top-0 z-10' : '',
            ]"
            :style="item.msg.id === latestUserMsgId ? { background: 'var(--background)' } : {}"
          >
            <!-- 分割线（换模型标记） -->
            <template v-if="item.msg.type === 'divider'">
              <div class="flex items-center gap-3 py-1.5 select-none">
                <div class="flex-1 h-px bg-border/40" />
                <span class="text-[10px] text-muted-foreground/40 font-medium shrink-0">
                  {{ item.msg.dividerText }}
                </span>
                <div class="flex-1 h-px bg-border/40" />
              </div>
            </template>
            <AiMessageBubble
              v-else
              :message="item.msg"
              :session-id="currentSessionId"
              :hide-header="!item.isGroupStart"
              :is-group-end="item.isGroupEnd"
              :in-group="item.groupSize > 1"
              :sticky-compact="item.msg.id === latestUserMsgId"
              @continue="handleContinue"
              @bump-max-output="handleBumpMaxOutput"
            />
          </div>
        </div>
      </div>

      <!-- 压缩提示 -->
      <AiCompactBanner :visible="chat.isCompacting?.value ?? false" />

      <!-- Phase Tracking 进度条 -->
      <div v-if="chat.currentPhase.value" class="mx-auto max-w-4xl px-5">
        <AiPhaseBar
          :current="chat.currentPhase.value.current"
          :total="chat.currentPhase.value.total"
          :label="chat.currentPhase.value.label"
          :is-streaming="chat.isStreaming.value"
        />
      </div>

      <!-- Plan Gate 确认条 -->
      <div v-if="chat.awaitingPlanApproval.value" class="mx-auto max-w-4xl px-5">
        <AiPlanGateBar
          :plan="chat.pendingPlan.value"
          @approve="handlePlanApprove"
          @reject="handlePlanReject"
        />
      </div>

      <!-- Dispatcher 子任务面板 -->
      <div v-if="chat.spawnedTasks.value.length" class="mx-auto max-w-4xl px-5">
        <AiSpawnedTasksPanel
          :tasks="chat.spawnedTasks.value"
          @run="handleSpawnRun"
        />
      </div>

      <!-- 错误提示 -->
      <div
        v-if="chat.error.value"
        class="mx-auto max-w-4xl px-5 mb-2"
      >
        <div class="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {{ chat.error.value }}
        </div>
      </div>

      <!-- G22：Context Bar — 附件摘要 + 队列指示（workDir 已在顶部工具栏显示，不重复） -->
      <div
        v-if="fileAttachment.attachments.value.length > 0 || messageQueue.length > 0"
        class="mx-auto w-full max-w-4xl px-5 mb-0.5"
      >
        <div class="flex items-center gap-2 px-2 py-1 rounded-lg bg-muted/30 border border-border/30 text-[10px] text-muted-foreground/60">
          <span v-if="fileAttachment.attachments.value.length > 0">
            {{ fileAttachment.attachments.value.length }} 个文件已附加
          </span>
          <!-- G15 队列指示器 -->
          <span v-if="messageQueue.length > 0" class="ml-auto text-amber-500">
            ⏳ 队列中 {{ messageQueue.length }} 条
          </span>
        </div>
      </div>
      <!-- G15 队列指示器（无 workDir 且无附件时独立显示） -->
      <div
        v-else-if="messageQueue.length > 0"
        class="mx-auto w-full max-w-4xl px-5 mb-0.5"
      >
        <div class="flex items-center gap-2 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-600 dark:text-amber-400">
          ⏳ 已排队 {{ messageQueue.length }} 条消息，AI 回复后将自动发送
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
          :context-usage-percent="contextUsagePercent"
          :placeholder="chatMode === 'plan' ? '描述你的需求，AI 将先给出规划方案…' : chatMode === 'auto' ? '描述任务，AI 将自动分析并给出完整方案…' : '发送消息…'"
          @send="handleSend"
          @abort="chat.abort"
          @clear-session="handleCreateSession"
          @update:selected-provider-id="selectedProviderId = $event"
          @update:selected-model-id="handleModelChange"
          @update:chat-mode="chatMode = $event"
          @open-config="openProviderConfig"
          @select-files="showFilePicker = true"
          @drop-files="fileAttachment.handleDomDrop"
          @drop-file-path="handleMentionFile"
          @remove-attachment="fileAttachment.removeAttachment"
          @mention-file="handleMentionFile"
          @compact="handleCompact"
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
