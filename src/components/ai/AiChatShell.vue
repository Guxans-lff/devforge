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
})

const emit = defineEmits<{
  (e: 'update:showSessionDrawer', value: boolean): void
  (e: 'update:showMemoryDrawer', value: boolean): void
  (e: 'update:showFilePicker', value: boolean): void
  (e: 'primaryAction'): void
  (e: 'secondaryAction'): void
  (e: 'openConfig'): void
  (e: 'selectWorkDir'): void
  (e: 'setWorkDir', value: string): void
  (e: 'continue'): void
  (e: 'bumpMaxOutput', value: number): void
  (e: 'loadMoreHistory'): void
  (e: 'scrollMessages', event: Event): void
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
}>()

const { t } = useI18n()

const messageListRef = ref<InstanceType<typeof AiMessageListVirtual> | null>(null)
const inputAreaRef = ref<InstanceType<typeof AiInputArea> | null>(null)
const shellClass = computed(() => ['flex h-full min-h-0 flex-col', props.backgroundClass].filter(Boolean).join(' '))

defineExpose({
  scrollContainer: computed(() => messageListRef.value?.scrollContainer ?? null),
  focusInput: () => inputAreaRef.value?.focus(),
  setInputDraft: (value: string, options?: { append?: boolean; focus?: boolean }) => inputAreaRef.value?.setDraft(value, options),
})
</script>

<template>
  <div :class="shellClass">
    <template v-if="currentView === 'provider-config'">
      <AiProviderConfig @back="emit('openConfig')" />
    </template>

    <template v-else>
      <div
        class="flex shrink-0 items-center justify-between px-4 py-2"
        :class="toolbarBorder ? 'border-b border-border/30' : ''"
      >
        <div class="flex items-center gap-1">
          <TooltipProvider :delay-duration="300">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="emit('primaryAction')">
                  <Plus class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">{{ primaryActionLabel }}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="emit('secondaryAction')">
                  <Bot class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">{{ secondaryActionLabel }}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="emit('update:showSessionDrawer', true)">
                  <History class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">{{ t('ai.messages.history') }}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="emit('openConfig')">
                  <Settings class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">{{ t('ai.messages.providerSettings') }}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="emit('update:showMemoryDrawer', true)">
                  <Brain class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">{{ t('ai.messages.memory') }}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button
                class="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors"
                :class="workDir
                  ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  : 'text-muted-foreground/40 hover:bg-muted/50 hover:text-muted-foreground/60'"
                :title="workDir || t('ai.messages.workDirTitle')"
              >
                <FolderOpen class="h-3.5 w-3.5" />
                <span v-if="workDir">{{ workDirDisplay }}</span>
                <span v-else>{{ t('ai.messages.workDirUnset') }}</span>
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

        <div class="flex items-center gap-2">
          <AiUsageBadge
            v-if="currentModel"
            :prompt-tokens="promptTokens"
            :completion-tokens="completionTokens"
            :cache-read-tokens="cacheReadTokens"
            :max-context="currentModel.capabilities.maxContext"
            :pricing="currentModel.capabilities.pricing"
          />

          <TooltipProvider v-if="showExitImmersive" :delay-duration="300">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="emit('exitImmersive')">
                  <Minimize2 class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">{{ t('ai.messages.exitImmersive') }}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          v-if="messagesCount === 0 && !isLoading"
          class="flex h-full flex-col items-center justify-center px-6 text-center"
        >
          <div class="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/5">
            <Bot class="h-10 w-10 text-primary/40" />
          </div>
          <h2 class="mb-2 text-xl font-semibold text-foreground/80">{{ t('ai.messages.title') }}</h2>
          <p class="max-w-md text-sm leading-relaxed text-muted-foreground/70">
            {{ hasProviders ? emptyDescriptionReady : emptyDescriptionMissingProvider }}
          </p>
          <Button
            v-if="!hasProviders"
            variant="outline"
            size="sm"
            class="mt-6"
            @click="emit('openConfig')"
          >
            <Settings class="mr-2 h-4 w-4" />
            {{ t('ai.messages.configureProvider') }}
          </Button>
          <slot name="empty-state-extra" />
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
        />
      </div>

      <AiCompactBanner :visible="compactVisible" />

      <slot name="after-compact" />

      <div v-if="error" class="mx-auto mb-2 max-w-4xl px-5">
        <div class="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {{ error }}
        </div>
      </div>

      <slot name="before-input" />

      <div class="mx-auto w-full max-w-4xl px-5">
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
    </template>

    <AiSessionDrawer
      v-if="showSessionDrawer || sessions.length > 0"
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
