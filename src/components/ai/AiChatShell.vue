<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiMessage, AiSession, FileAttachment, ModelConfig, ProviderConfig } from '@/types/ai'
import type { ChatMode } from '@/components/ai/AiInputArea.vue'
import AiMessageListVirtual from '@/components/ai/AiMessageListVirtual.vue'
import AiInputArea from '@/components/ai/AiInputArea.vue'
import AiUsageBadge from '@/components/ai/AiUsageBadge.vue'
import AiProviderConfig from '@/components/ai/AiProviderConfig.vue'
import AiSessionDrawer from '@/components/ai/AiSessionDrawer.vue'
import AiMemoryDrawer from '@/components/ai/AiMemoryDrawer.vue'
import AiCompactBanner from '@/components/ai/AiCompactBanner.vue'
import WorkspaceFilePicker from '@/components/ai/WorkspaceFilePicker.vue'
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
import {
  ChevronDown,
  Bot,
  Brain,
  Check,
  FolderOpen,
  History,
  Minimize2,
  Plus,
  Settings,
} from 'lucide-vue-next'

interface MessageListItem {
  key: string
  message: AiMessage
  hideHeader?: boolean
  isGroupEnd?: boolean
  inGroup?: boolean
  stickyCompact?: boolean
}

interface ModeConfig {
  label: string
  desc: string
  icon: unknown
  color: string
  bg: string
}

const props = withDefaults(defineProps<{
  currentView: 'chat' | 'provider-config'
  showSessionDrawer: boolean
  showMemoryDrawer: boolean
  showFilePicker: boolean
  messageItems: MessageListItem[]
  sessionId?: string
  messagesCount: number
  hasProviders: boolean
  providers: ProviderConfig[]
  sessions: AiSession[]
  activeSessionId?: string | null
  selectedProviderId?: string | null
  selectedModelId?: string | null
  chatMode: ChatMode
  attachments: FileAttachment[]
  currentModel?: ModelConfig | null
  promptTokens?: number
  completionTokens?: number
  cacheReadTokens?: number
  isStreaming?: boolean
  isLoading?: boolean
  canLoadMoreHistory?: boolean
  historyRemainingRecords?: number
  historyLoadMorePending?: boolean
  historyLoadMoreError?: string | null
  workDir?: string
  availableWorkDirs?: Array<{ label: string; value: string }>
  workDirDisplay?: string
  placeholder?: string
  error?: string | null
  compactVisible?: boolean
  contextUsagePercent?: number
  primaryActionLabel: string
  secondaryActionLabel: string
  emptyDescriptionReady: string
  emptyDescriptionMissingProvider: string
  modeSummary?: ModeConfig | null
  showExitImmersive?: boolean
  toolbarBorder?: boolean
  backgroundClass?: string
  repositoryFocusLayout?: boolean
  showSideRailToggle?: boolean
  sideRailOpen?: boolean
  sideRailCount?: number
  sideRailLabel?: string
}>(), {
  sessionId: undefined,
  activeSessionId: null,
  selectedProviderId: null,
  selectedModelId: null,
  currentModel: null,
  promptTokens: 0,
  completionTokens: 0,
  cacheReadTokens: 0,
  isStreaming: false,
  isLoading: false,
  canLoadMoreHistory: false,
  historyRemainingRecords: 0,
  historyLoadMorePending: false,
  historyLoadMoreError: null,
  workDir: '',
  availableWorkDirs: () => [],
  workDirDisplay: '',
  placeholder: '',
  error: null,
  compactVisible: false,
  contextUsagePercent: 0,
  modeSummary: null,
  showExitImmersive: false,
  toolbarBorder: false,
  backgroundClass: '',
  repositoryFocusLayout: false,
  showSideRailToggle: false,
  sideRailOpen: false,
  sideRailCount: 0,
  sideRailLabel: '后台任务',
})

const emit = defineEmits<{
  (e: 'update:showSessionDrawer', value: boolean): void
  (e: 'update:showMemoryDrawer', value: boolean): void
  (e: 'update:showFilePicker', value: boolean): void
  (e: 'primaryAction'): void
  (e: 'secondaryAction'): void
  (e: 'openConfig'): void
  (e: 'closeConfig'): void
  (e: 'selectWorkDir'): void
  (e: 'setWorkDir', value: string): void
  (e: 'continue'): void
  (e: 'bumpMaxOutput', value: number): void
  (e: 'loadMoreHistory'): void
  (e: 'scrollMessages', event: Event): void
  (e: 'forkMessage', messageId: string): void
  (e: 'rewindMessage', messageId: string): void
  (e: 'send', value: string): void
  (e: 'abort'): void
  (e: 'clearSession'): void
  (e: 'update:selectedProviderId', value: string): void
  (e: 'update:selectedModelId', value: string): void
  (e: 'update:chatMode', value: ChatMode): void
  (e: 'selectFiles'): void
  (e: 'dropFiles', files: FileList): void
  (e: 'dropFilePath', path: string): void
  (e: 'removeAttachment', id: string): void
  (e: 'mentionFile', path: string): void
  (e: 'compact'): void
  (e: 'selectSession', id: string): void
  (e: 'createSession'): void
  (e: 'deleteSession', id: string): void
  (e: 'preloadSession', id: string): void
  (e: 'filePickerConfirm', paths: string[]): void
  (e: 'exitImmersive'): void
  (e: 'toggleSideRail'): void
}>()

const { t } = useI18n()

const messageListRef = ref<InstanceType<typeof AiMessageListVirtual> | null>(null)
const inputAreaRef = ref<InstanceType<typeof AiInputArea> | null>(null)
const shellClass = computed(() => ['flex h-full min-h-0 flex-col', props.backgroundClass].filter(Boolean).join(' '))
const showSideRail = computed(() => props.repositoryFocusLayout && props.sideRailOpen)

defineExpose({
  scrollContainer: computed(() => messageListRef.value?.scrollContainer ?? null),
  focusInput: () => inputAreaRef.value?.focus(),
  setInputDraft: (value: string, options?: { append?: boolean; focus?: boolean }) => inputAreaRef.value?.setDraft(value, options),
})
</script>

<template>
  <div :class="shellClass">
    <template v-if="currentView === 'provider-config'">
      <AiProviderConfig @back="emit('closeConfig')" />
    </template>

    <template v-else>
      <!-- 顶部轻量工作区头部 -->
      <div
        class="flex shrink-0 items-center justify-between px-4 py-1.5"
        :class="toolbarBorder ? 'border-b border-border/25' : ''"
      >
        <div class="flex min-w-0 items-center gap-2">
          <!-- 在线状态 + 标题 -->
          <div class="flex items-center gap-1.5">
            <span class="h-1.5 w-1.5 rounded-full bg-emerald-500/80" />
            <span class="text-[11px] font-medium text-foreground/70 truncate max-w-[180px]">
              {{ workDir ? workDirDisplay : t('ai.messages.title') }}
            </span>
          </div>

          <!-- 工作区路径 Dropdown -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                class="flex min-w-0 items-center gap-1 rounded-md border border-border/20 bg-muted/[0.04] px-2 py-0.5 text-[10px] transition-colors"
                :class="workDir
                  ? 'text-muted-foreground/70 hover:border-border/40 hover:bg-muted/15 hover:text-foreground'
                  : 'text-muted-foreground/40 hover:border-border/30 hover:bg-muted/10 hover:text-muted-foreground/60'"
                :title="workDir || t('ai.messages.workDirTitle')"
              >
                <FolderOpen class="h-3 w-3 shrink-0" />
                <span class="max-w-[100px] truncate">
                  {{ workDir ? workDirDisplay : t('ai.messages.workDirUnset') }}
                </span>
                <ChevronDown class="h-3 w-3 shrink-0 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="w-64">
              <DropdownMenuLabel class="text-[11px] text-muted-foreground">
                {{ t('ai.messages.workDirRoots') }}
              </DropdownMenuLabel>
              <DropdownMenuItem
                v-for="root in availableWorkDirs"
                :key="root.value"
                class="flex items-center justify-between gap-2 text-[12px]"
                @select="emit('setWorkDir', root.value)"
              >
                <span class="truncate" :title="root.value">{{ root.label }}</span>
                <Check v-if="workDir === root.value" class="h-3.5 w-3.5 shrink-0 text-primary" />
              </DropdownMenuItem>
              <div
                v-if="availableWorkDirs.length === 0"
                class="px-2 py-1.5 text-[11px] text-muted-foreground"
              >
                {{ t('ai.messages.workDirEmpty') }}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem class="text-[12px]" @select="emit('selectWorkDir')">
                <FolderOpen class="mr-2 h-3.5 w-3.5" />
                {{ t('ai.messages.workDirBrowse') }}
              </DropdownMenuItem>
              <DropdownMenuItem
                v-if="workDir"
                class="text-[12px] text-muted-foreground"
                @select="emit('setWorkDir', '')"
              >
                {{ t('ai.messages.workDirClear') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div class="flex items-center gap-1.5">
          <!-- 新会话 -->
          <TooltipProvider :delay-duration="300">
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  type="button"
                  class="inline-flex h-6 items-center gap-1 rounded-md border border-border/20 bg-muted/[0.04] px-2 text-[10px] text-muted-foreground/70 transition-colors hover:border-border/40 hover:bg-muted/15 hover:text-foreground"
                  @click="emit('primaryAction')"
                >
                  <Plus class="h-3 w-3" />
                  <span class="hidden sm:inline">{{ primaryActionLabel }}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">{{ primaryActionLabel }}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <!-- 历史 / 更多 -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                class="inline-flex h-6 items-center gap-1 rounded-md border border-border/20 bg-muted/[0.04] px-2 text-[10px] text-muted-foreground/70 transition-colors hover:border-border/40 hover:bg-muted/15 hover:text-foreground"
              >
                <History class="h-3 w-3" />
                <span class="hidden sm:inline">{{ t('ai.messages.history') }}</span>
                <ChevronDown class="h-3 w-3 shrink-0 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-48">
              <DropdownMenuItem
                v-if="!showSessionDrawer"
                class="text-[12px]"
                @select="emit('update:showSessionDrawer', true)"
              >
                <History class="mr-2 h-3.5 w-3.5" />
                {{ t('ai.messages.history') }}
              </DropdownMenuItem>
              <DropdownMenuItem class="text-[12px]" @select="emit('update:showMemoryDrawer', true)">
                <Brain class="mr-2 h-3.5 w-3.5" />
                {{ t('ai.messages.memory') }}
              </DropdownMenuItem>
              <DropdownMenuItem class="text-[12px]" @select="emit('openConfig')">
                <Settings class="mr-2 h-3.5 w-3.5" />
                {{ t('ai.messages.providerSettings') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <!-- 后台任务开关 -->
          <TooltipProvider v-if="showSideRailToggle" :delay-duration="300">
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  type="button"
                  class="run-inspector-chip inline-flex h-[30px] items-center gap-2 overflow-hidden rounded-full border border-emerald-400/25 bg-[linear-gradient(180deg,rgba(52,211,153,0.075),rgba(52,211,153,0.035))] px-2.5 font-mono text-[12px] text-emerald-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition-colors hover:border-emerald-300/35 hover:text-emerald-100"
                  @click="emit('toggleSideRail')"
                >
                  <span class="h-[7px] w-[7px] rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.55)]" />
                  <span class="hidden md:inline">{{ sideRailOpen ? 'Run Inspector' : `已完成 · ctx ${contextUsagePercent}%` }}</span>
                  <span class="rounded-full border border-emerald-300/20 bg-black/20 px-1.5 py-px font-mono text-[10px] text-emerald-100/90">
                    {{ sideRailCount }}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">
                {{ sideRailOpen ? `收起${sideRailLabel}` : `展开${sideRailLabel}` }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <!-- 用量 -->
          <AiUsageBadge
            v-if="currentModel && !repositoryFocusLayout"
            :prompt-tokens="promptTokens"
            :completion-tokens="completionTokens"
            :cache-read-tokens="cacheReadTokens"
            :max-context="currentModel.capabilities.maxContext"
            :pricing="currentModel.capabilities.pricing"
          />

          <!-- 退出沉浸 -->
          <TooltipProvider v-if="showExitImmersive" :delay-duration="300">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-6 w-6" @click="emit('exitImmersive')">
                  <Minimize2 class="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">{{ t('ai.messages.exitImmersive') }}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <div
        class="grid min-h-0 flex-1 overflow-hidden transition-[grid-template-columns] duration-200 ease-out"
        :class="showSideRail ? 'xl:grid-cols-[minmax(0,1fr)_348px]' : 'grid-cols-1'"
      >
        <div class="relative flex min-h-0 min-w-0 flex-col overflow-hidden" :class="showSideRail ? 'xl:border-r xl:border-border/25' : ''">
          <!-- 消息列表区（唯一主要滚动区域） -->
          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              v-if="messagesCount === 0 && !isLoading"
              :class="repositoryFocusLayout ? 'h-full overflow-auto' : 'flex h-full flex-col items-center justify-center px-6 text-center'"
            >
              <slot name="empty-state">
                <div class="flex h-full flex-col items-center justify-center px-6 text-center">
                  <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/[0.04]">
                    <Bot class="h-6 w-6 text-primary/30" />
                  </div>
                  <h2 class="mb-1.5 text-base font-semibold text-foreground/70">{{ t('ai.messages.title') }}</h2>
                  <p class="max-w-md text-sm leading-relaxed text-muted-foreground/60">
                    {{ hasProviders ? emptyDescriptionReady : emptyDescriptionMissingProvider }}
                  </p>
                  <Button
                    v-if="!hasProviders"
                    variant="outline"
                    size="sm"
                    class="mt-5"
                    @click="emit('openConfig')"
                  >
                    <Settings class="mr-2 h-3.5 w-3.5" />
                    {{ t('ai.messages.configureProvider') }}
                  </Button>
                  <slot name="empty-state-extra" />
                </div>
              </slot>
            </div>

            <AiMessageListVirtual
              v-else
              ref="messageListRef"
              :items="messageItems"
              :session-id="sessionId"
              :is-loading="isLoading"
              :can-load-more-history="canLoadMoreHistory"
              :history-remaining-records="historyRemainingRecords"
              :history-load-more-pending="historyLoadMorePending"
              :history-load-more-error="historyLoadMoreError"
              @continue="emit('continue')"
              @bump-max-output="emit('bumpMaxOutput', $event)"
              @load-more-history="emit('loadMoreHistory')"
              @scroll="emit('scrollMessages', $event)"
              @fork="emit('forkMessage', $event)"
              @rewind="emit('rewindMessage', $event)"
            />
          </div>

          <AiCompactBanner :visible="compactVisible" />

          <slot name="after-compact" />

          <div v-if="error" class="mx-auto mb-1.5 max-w-3xl px-4">
            <div class="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
              {{ error }}
            </div>
          </div>

          <slot name="before-input" />

          <!-- 底部输入区（固定可见） -->
          <div class="shrink-0">
            <AiInputArea
              ref="inputAreaRef"
              :is-streaming="isStreaming"
              :disabled="!hasProviders || !currentModel"
              :loading="isLoading"
              :providers="providers"
              :selected-provider-id="selectedProviderId"
              :selected-model-id="selectedModelId"
              :chat-mode="chatMode"
              :attachments="attachments"
              :context-usage-percent="contextUsagePercent"
              :placeholder="placeholder"
              @send="emit('send', $event)"
              @abort="emit('abort')"
              @clear-session="emit('clearSession')"
              @update:selected-provider-id="emit('update:selectedProviderId', $event)"
              @update:selected-model-id="emit('update:selectedModelId', $event)"
              @update:chat-mode="emit('update:chatMode', $event)"
              @open-config="emit('openConfig')"
              @select-files="emit('update:showFilePicker', true)"
              @drop-files="emit('dropFiles', $event)"
              @drop-file-path="emit('dropFilePath', $event)"
              @remove-attachment="emit('removeAttachment', $event)"
              @mention-file="emit('mentionFile', $event)"
              @compact="emit('compact')"
            />
          </div>
        </div>

        <aside
          v-if="showSideRail"
          class="run-inspector-panel hidden min-w-0 overflow-hidden border-l border-white/[0.08] bg-[linear-gradient(180deg,#111116,#0d0d11)] shadow-[-28px_0_80px_rgba(0,0,0,0.32)] xl:block"
        >
          <slot name="side-rail" />
        </aside>
      </div>
    </template>

    <AiSessionDrawer
      v-if="showSessionDrawer"
      :open="showSessionDrawer"
      :sessions="sessions"
      :active-session-id="activeSessionId"
      @update:open="emit('update:showSessionDrawer', $event)"
      @select="emit('selectSession', $event)"
      @create="emit('createSession')"
      @delete="emit('deleteSession', $event)"
      @preload="emit('preloadSession', $event)"
    />

    <WorkspaceFilePicker
      v-if="showFilePicker"
      @confirm="emit('filePickerConfirm', $event)"
      @close="emit('update:showFilePicker', false)"
    />

    <AiMemoryDrawer
      v-if="showMemoryDrawer"
      :open="showMemoryDrawer"
      @update:open="emit('update:showMemoryDrawer', $event)"
    />
  </div>
</template>

<style scoped>
@keyframes runInspectorBreathe {
  0%, 100% { border-color: rgb(56 189 248 / 0.22); }
  50% { border-color: rgb(125 211 252 / 0.42); }
}

@keyframes runInspectorDot {
  0%, 100% { box-shadow: 0 0 12px rgb(52 211 153 / 0.32), 0 0 0 0 rgb(52 211 153 / 0.18); }
  50% { box-shadow: 0 0 18px rgb(52 211 153 / 0.55), 0 0 0 6px rgb(52 211 153 / 0); }
}

@keyframes runInspectorSlideIn {
  from { opacity: 0; transform: translateX(18px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes runInspectorScan {
  0% { transform: translateX(-105%); }
  100% { transform: translateX(105%); }
}

.run-inspector-chip {
  position: relative;
}

.run-inspector-chip::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.08), transparent);
  opacity: 0.35;
  pointer-events: none;
}

.run-inspector-chip > span:first-child {
  box-shadow: 0 0 12px rgb(52 211 153 / 0.32);
}

.run-inspector-panel {
  animation: runInspectorSlideIn 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
}

@media (prefers-reduced-motion: reduce) {
  .run-inspector-panel {
    animation: none;
  }
}
</style>
