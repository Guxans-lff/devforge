<script setup lang="ts">
/**
 * Activity Bar — 最左侧 48px 图标栏
 *
 * 上部：面板切换图标（连接/文件/搜索/AI）
 * 底部：本地终端、更多菜单、设置、主题切换、折叠按钮
 */
import { computed, onMounted, ref, unref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useConnectionStore } from '@/stores/connections'
import { useAiChatStore } from '@/stores/ai-chat'
import { useTheme } from '@/composables/useTheme'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Database,
  FolderOpen,
  Search,
  Bot,
  Sparkles,
  Terminal,
  MoreHorizontal,
  Settings,
  Sun,
  Moon,
  Monitor,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  GitBranch,
  Camera,
  Cable,
} from 'lucide-vue-next'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import type { SidePanelId } from '@/types/workspace'
import AiPromptEnhancer from '@/components/ai/AiPromptEnhancer.vue'

const { t } = useI18n()
const workspace = useWorkspaceStore()
const connectionStore = useConnectionStore()
const aiStore = useAiChatStore()
const { themeMode, toggleTheme } = useTheme()
const showPromptEnhancer = ref(false)

const promptEnhancerProvider = computed(() => unref(aiStore.defaultProvider))
const promptEnhancerModel = computed(() => promptEnhancerProvider.value?.models?.[0] ?? null)

// 主题图标
const themeIcon = computed(() => {
  if (themeMode.value === 'dark') return Moon
  if (themeMode.value === 'light') return Sun
  return Monitor
})

// 面板是否折叠
const isPanelCollapsed = computed(() => !workspace.panelState.activeSidePanel)

// 在线连接数（用于角标）
const onlineCount = computed(() => {
  let n = 0
  for (const c of connectionStore.connections.values()) {
    if (c.status === 'connected') n++
  }
  return n
})

// 上部面板切换图标
onMounted(() => {
  void aiStore.init().catch(() => {})
})

const panelItems: { id: SidePanelId; icon: typeof Database; label: string }[] = [
  { id: 'connections', icon: Database, label: 'sidebar.connections' },
  { id: 'files', icon: FolderOpen, label: 'tab.files' },
  { id: 'search', icon: Search, label: 'sidebar.searchConnections' },
  { id: 'ai', icon: Bot, label: 'AI' },
]

/** 打开本地终端 */
function openLocalTerminal() {
  const localCount = workspace.tabs.filter(tab => tab.type === 'terminal' && tab.meta?.isLocal).length
  const title = `${t('sidebar.localTerminal')}${localCount > 0 ? ` ${localCount + 1}` : ''}`
  workspace.addTab({
    id: `local-terminal-${Date.now()}`,
    type: 'terminal',
    title,
    closable: true,
    meta: { isLocal: 'true' },
  })
}

/** 打开 Git 仓库 */
async function handleOpenGitRepo() {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: t('git.selectRepository'),
  })
  if (!selected) return
  const repoPath = typeof selected === 'string' ? selected : selected[0]
  if (!repoPath) return
  const tabId = `git-${repoPath.replace(/[\\/:]/g, '_')}`
  const folderName = repoPath.split(/[\\/]/).filter(Boolean).pop() ?? repoPath
  workspace.addTab({
    id: tabId,
    type: 'git',
    title: folderName,
    closable: true,
    meta: { repositoryPath: repoPath },
  })
}
</script>

<template>
  <div class="flex w-12 shrink-0 flex-col items-center justify-between bg-muted/20 dark:bg-df-shell-bg py-2">
    <TooltipProvider :delay-duration="300">
      <!-- 上部：面板切换图标 -->
      <div class="flex flex-col items-center gap-0.5">
        <template v-for="item in panelItems" :key="item.id">
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="relative flex h-10 w-10 items-center justify-center rounded-md transition-colors"
                :class="workspace.panelState.activeSidePanel === item.id
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'"
                @click="workspace.toggleSidePanel(item.id)"
              >
                <!-- 左侧激活指示条 -->
                <div
                  v-if="workspace.panelState.activeSidePanel === item.id"
                  class="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-primary"
                />
                <component :is="item.icon" class="h-5 w-5" />
                <!-- 连接在线数角标 -->
                <span
                  v-if="item.id === 'connections' && onlineCount > 0"
                  class="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground"
                >
                  {{ onlineCount > 9 ? '9+' : onlineCount }}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" class="text-[11px] font-medium">
              <p>{{ item.id === 'ai' ? 'AI' : t(item.label) }}</p>
            </TooltipContent>
          </Tooltip>
        </template>
      </div>

      <!-- 底部：工具按钮 -->
      <div class="flex flex-col items-center gap-0.5">
        <!-- 本地终端 -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              data-testid="activity-prompt-optimizer-open"
              variant="ghost"
              size="icon"
              class="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-primary/10"
              @click="showPromptEnhancer = true"
            >
              <Sparkles class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" class="text-[11px] font-medium"><p>{{ t('welcome.promptOptimizer') }}</p></TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-primary/10" @click="openLocalTerminal">
              <Terminal class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" class="text-[11px] font-medium"><p>{{ t('sidebar.localTerminal') }}</p></TooltipContent>
        </Tooltip>

        <!-- 更多菜单 -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-primary/10 data-[state=open]:bg-primary/10 data-[state=open]:text-foreground"
              :title="t('sidebar.more')"
            >
              <MoreHorizontal class="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" class="min-w-[180px]">
            <DropdownMenuItem @click="workspace.addTab({ id: 'multi-exec', type: 'multi-exec', title: t('tab.multiExec'), closable: true })">
              <LayoutGrid class="mr-2 h-4 w-4" />
              {{ t('tooltip.multiExec') }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="handleOpenGitRepo">
              <GitBranch class="mr-2 h-4 w-4" />
              {{ t('git.openRepository') }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="workspace.addTab({ id: 'screenshot', type: 'screenshot', title: t('tab.screenshot'), closable: true })">
              <Camera class="mr-2 h-4 w-4" />
              {{ t('tooltip.screenshot') }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="workspace.addTab({ id: 'tunnel', type: 'tunnel', title: t('tunnel.title'), closable: true })">
              <Cable class="mr-2 h-4 w-4" />
              {{ t('tunnel.title') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <!-- 设置 -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-primary/10"
              @click="workspace.addTab({ id: 'settings', type: 'settings', title: t('tab.settings'), closable: true })"
            >
              <Settings class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" class="text-[11px] font-medium"><p>{{ t('tooltip.settings') }}</p></TooltipContent>
        </Tooltip>

        <!-- 主题切换 -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-primary/10" @click="toggleTheme()">
              <component :is="themeIcon" class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" class="text-[11px] font-medium"><p>{{ t(`theme.${themeMode}`) }}</p></TooltipContent>
        </Tooltip>

        <!-- 折叠/展开 SidePanel -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors active:scale-95"
              @click="workspace.toggleSidebar()"
            >
              <component
                :is="isPanelCollapsed ? ChevronRight : ChevronLeft"
                class="h-4 w-4"
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" class="text-[11px] font-medium">
            <p>{{ isPanelCollapsed ? t('sidebar.expand') : t('sidebar.collapse') }}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>

    <AiPromptEnhancer
      v-model:open="showPromptEnhancer"
      original-text=""
      :provider="promptEnhancerProvider"
      :model="promptEnhancerModel"
    />
  </div>
</template>
