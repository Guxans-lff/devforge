<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTransferStore } from '@/stores/transfer'
import Sidebar from '@/components/layout/Sidebar.vue'
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
      return tab.connectionId ? TerminalView : null
    case 'file-manager':
      return tab.connectionId ? FileManagerView : null
    case 'settings':
      return SettingsView
    case 'multi-exec':
      return MultiExecView
    case 'terminal-player':
      return TerminalPlayerView
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
</script>

<template>
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-muted/20 dark:bg-[#0c0c0e]">
    <!-- 自定义标题栏 -->
    <TitleBar />

    <div class="flex flex-1 min-h-0">
    <!-- Sidebar -->
    <Sidebar />

    <!-- Main Content Area: Floating and elevated -->
    <div class="flex flex-1 flex-col overflow-hidden bg-background sm:rounded-tl-xl border-t border-l border-border/40 shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.15)] dark:shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.6)] relative z-10 transition-all duration-300">
      <!-- Tab Bar -->
      <TabBar />

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

      <!-- Bottom Panel -->
      <BottomPanel />
    </div>
    </div>

    <!-- Command Palette -->
    <CommandPalette />
  </div>
</template>
