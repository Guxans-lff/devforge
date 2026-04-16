<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTransferStore } from '@/stores/transfer'
import ActivityBar from '@/components/layout/ActivityBar.vue'
import SidePanel from '@/components/layout/SidePanel.vue'
import StatusBar from '@/components/layout/StatusBar.vue'
import TabBar from '@/components/layout/TabBar.vue'
import TitleBar from '@/components/layout/TitleBar.vue'
import BottomPanel from '@/components/layout/BottomPanel.vue'
import CommandPalette from '@/components/layout/CommandPalette.vue'
import WelcomeView from '@/views/WelcomeView.vue'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'

// 重型视图组件懒加载，减小首屏 bundle 体积
const DatabaseView = defineAsyncComponent(() => import('@/views/DatabaseView.vue'))
const TerminalView = defineAsyncComponent(() => import('@/views/TerminalView.vue'))
const FileManagerView = defineAsyncComponent(() => import('@/views/FileManagerView.vue'))
const SettingsView = defineAsyncComponent(() => import('@/views/SettingsView.vue'))
const MultiExecView = defineAsyncComponent(() => import('@/views/MultiExecView.vue'))
const TerminalPlayerView = defineAsyncComponent(() => import('@/views/TerminalPlayerView.vue'))
const LocalTerminalView = defineAsyncComponent(() => import('@/views/LocalTerminalView.vue'))
const RedisView = defineAsyncComponent(() => import('@/views/RedisView.vue'))
const GitView = defineAsyncComponent(() => import('@/views/GitView.vue'))
const ScreenshotView = defineAsyncComponent(() => import('@/views/ScreenshotView.vue'))
const TunnelView = defineAsyncComponent(() => import('@/views/TunnelView.vue'))
const AiChatView = defineAsyncComponent(() => import('@/views/AiChatView.vue'))

const { t } = useI18n()
const workspace = useWorkspaceStore()
const transferStore = useTransferStore()

useKeyboardShortcuts()

const activeTabComponent = computed(() => {
  const tab = workspace.activeTab
  if (!tab) return null
  switch (tab.type) {
    case 'welcome':
      return WelcomeView
    case 'database':
      return tab.connectionId ? DatabaseView : null
    case 'terminal':
      // 本地终端（无 connectionId，meta.isLocal）
      if (tab.meta?.isLocal) return LocalTerminalView
      return tab.connectionId ? TerminalView : null
    case 'file-manager':
      return tab.connectionId ? FileManagerView : null
    case 'settings':
      return SettingsView
    case 'multi-exec':
      return MultiExecView
    case 'terminal-player':
      return TerminalPlayerView
    case 'redis':
      return tab.connectionId ? RedisView : null
    case 'git':
      return GitView
    case 'screenshot':
      return ScreenshotView
    case 'tunnel':
      return TunnelView
    case 'ai-chat':
      return AiChatView
    default:
      return null
  }
})

const activeTabProps = computed(() => {
  const tab = workspace.activeTab
  if (!tab) return {}
  if (tab.type === 'terminal-player' && tab.meta?.filePath) {
    return { filePath: tab.meta.filePath }
  }
  // 本地终端：传递 tabId 作为 sessionId
  if (tab.type === 'terminal' && tab.meta?.isLocal) {
    return { sessionId: tab.id }
  }
  // Git：传递仓库路径
  if (tab.type === 'git' && tab.meta?.repositoryPath) {
    return { repositoryPath: tab.meta.repositoryPath }
  }
  if (tab.connectionId) {
    const base: Record<string, string> = {
      connectionId: tab.connectionId,
      connectionName: tab.title,
    }
    // 文件管理器：传递初始远程路径（从终端 cwd 同步）
    if (tab.type === 'file-manager' && tab.meta?.initialRemotePath) {
      base.initialRemotePath = tab.meta.initialRemotePath
    }
    return base
  }
  return {}
})

const activeTabPlaceholder = computed(() => {
  const tab = workspace.activeTab
  if (!tab) return ''
  const placeholders: Record<string, string> = {
    database: t('placeholder.databaseView'),
    terminal: t('placeholder.terminalView'),
    'file-manager': t('placeholder.fileManagerView'),
  }
  return placeholders[tab.type] ?? ''
})

onMounted(() => {
  transferStore.setupListeners()
})

// ===== 沉浸式模式：AI Tab 激活时自动进入/退出 =====
const isImmersive = computed(() => workspace.panelState.immersiveMode)

watch(() => workspace.activeTab?.type, (tabType, oldType) => {
  if (tabType === 'ai-chat' && oldType !== 'ai-chat') {
    workspace.enterImmersive()
  } else if (tabType !== 'ai-chat' && oldType === 'ai-chat') {
    workspace.exitImmersive()
    workspace.resetImmersiveFlag()  // 离开 AI tab 时重置标记，下次进入可以再自动沉浸
  }
})
</script>

<template>
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-muted/20 dark:bg-df-shell-bg">
    <!-- 自定义标题栏 -->
    <TitleBar />

    <div class="flex flex-1 min-h-0">
    <!-- Activity Bar + Side Panel（沉浸式下隐藏） -->
    <ActivityBar v-show="!isImmersive" />
    <SidePanel v-show="!isImmersive" />

    <!-- Main Content Area: Floating and elevated -->
    <div class="flex flex-1 flex-col overflow-hidden bg-background transition-[border-radius] duration-300" :class="isImmersive ? '' : 'sm:rounded-tl-xl border-t border-l border-border/40 shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.15)] dark:shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.6)]'" :style="{ position: 'relative', zIndex: 10 }">
      <!-- Tab Bar（沉浸式下隐藏） -->
      <TabBar v-show="!isImmersive" />

      <!-- Workspace -->
      <main class="flex-1 overflow-hidden">
        <!-- Tab Content with KeepAlive for state preservation -->
        <KeepAlive :max="10">
          <component
            :is="activeTabComponent"
            v-if="activeTabComponent"
            :key="workspace.activeTabId"
            v-bind="activeTabProps"
          />
        </KeepAlive>
        <div
          v-if="!activeTabComponent && workspace.activeTab"
          class="flex h-full items-center justify-center text-muted-foreground"
        >
          <p class="text-sm">{{ activeTabPlaceholder }}</p>
        </div>
      </main>

      <!-- Bottom Panel（沉浸式下隐藏） -->
      <BottomPanel v-show="!isImmersive" />
    </div>
    </div>

    <!-- Status Bar（沉浸式下隐藏） -->
    <StatusBar v-show="!isImmersive && workspace.panelState.showStatusBar" />

    <!-- Command Palette -->
    <CommandPalette />
  </div>
</template>
