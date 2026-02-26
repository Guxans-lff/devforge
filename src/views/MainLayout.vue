<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTransferStore } from '@/stores/transfer'
import Sidebar from '@/components/layout/Sidebar.vue'
import TabBar from '@/components/layout/TabBar.vue'
import BottomPanel from '@/components/layout/BottomPanel.vue'
import WelcomeView from '@/views/WelcomeView.vue'
import DatabaseView from '@/views/DatabaseView.vue'
import TerminalView from '@/views/TerminalView.vue'
import FileManagerView from '@/views/FileManagerView.vue'
import SettingsView from '@/views/SettingsView.vue'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { Toaster } from 'vue-sonner'

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
    default:
      return null
  }
})

const activeTabProps = computed(() => {
  const tab = workspace.activeTab
  if (!tab) return {}
  if (tab.connectionId) {
    return {
      connectionId: tab.connectionId,
      connectionName: tab.title,
    }
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
  <div class="flex h-screen w-screen overflow-hidden bg-background">
    <!-- Sidebar -->
    <Sidebar />

    <!-- Main Content Area -->
    <div class="flex flex-1 flex-col overflow-hidden">
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

    <!-- Toast Notifications -->
    <Toaster position="top-right" :duration="3000" rich-colors close-button />
  </div>
</template>
