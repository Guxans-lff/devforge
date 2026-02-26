<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSettingsStore } from '@/stores/settings'
import { Database, Terminal, FolderOpen, Keyboard } from 'lucide-vue-next'
import type { TabType } from '@/types/workspace'

const { t } = useI18n()
const workspace = useWorkspaceStore()
const settingsStore = useSettingsStore()

function openNewTab(type: TabType) {
  const id = `${type}-${Date.now()}`
  const titleMap: Record<string, string> = {
    database: t('tab.newQuery'),
    terminal: t('tab.terminal'),
    'file-manager': t('tab.files'),
  }
  workspace.addTab({
    id,
    type,
    title: titleMap[type] ?? type,
    closable: true,
  })
}

// Map shortcut IDs to i18n keys and display keys from user settings
const shortcutDisplayMap: Record<string, string> = {
  newConnection: 'welcome.newConnection',
  newTab: 'welcome.newTab',
  closeTab: 'welcome.closeTab',
  toggleBottomPanel: 'welcome.toggleTerminal',
  settings: 'welcome.commandPalette',
  toggleSidebar: 'welcome.toggleSidebar',
}

const shortcuts = computed(() =>
  settingsStore.settings.shortcuts
    .filter(s => shortcutDisplayMap[s.id])
    .map(s => ({
      keys: s.keys.split('+').map(k => k.trim()),
      actionKey: shortcutDisplayMap[s.id]!,
    }))
)
</script>

<template>
  <div class="flex h-full items-center justify-center">
    <div class="flex max-w-xl flex-col items-center gap-8 px-8">
      <!-- Logo & Title -->
      <div class="flex flex-col items-center gap-3">
        <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <span class="text-3xl font-bold text-primary">D</span>
        </div>
        <h1 class="text-2xl font-semibold tracking-tight text-foreground">
          {{ t('welcome.title') }}
        </h1>
        <p class="text-center text-sm text-muted-foreground">
          {{ t('welcome.subtitle') }}
        </p>
      </div>

      <!-- Quick Actions -->
      <div class="grid w-full grid-cols-3 gap-3">
        <button
          class="group flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 transition-all duration-[var(--df-duration-normal)] hover:border-primary/50 hover:bg-accent"
          @click="openNewTab('database')"
        >
          <Database class="h-6 w-6 text-muted-foreground transition-colors group-hover:text-primary" />
          <span class="text-xs font-medium text-foreground">{{ t('welcome.database') }}</span>
        </button>

        <button
          class="group flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 transition-all duration-[var(--df-duration-normal)] hover:border-primary/50 hover:bg-accent"
          @click="openNewTab('terminal')"
        >
          <Terminal class="h-6 w-6 text-muted-foreground transition-colors group-hover:text-primary" />
          <span class="text-xs font-medium text-foreground">{{ t('welcome.terminal') }}</span>
        </button>

        <button
          class="group flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 transition-all duration-[var(--df-duration-normal)] hover:border-primary/50 hover:bg-accent"
          @click="openNewTab('file-manager')"
        >
          <FolderOpen class="h-6 w-6 text-muted-foreground transition-colors group-hover:text-primary" />
          <span class="text-xs font-medium text-foreground">{{ t('welcome.files') }}</span>
        </button>
      </div>

      <!-- Keyboard Shortcuts -->
      <div class="w-full rounded-lg border border-border bg-card p-4">
        <div class="mb-3 flex items-center gap-2">
          <Keyboard class="h-4 w-4 text-muted-foreground" />
          <span class="text-xs font-medium text-foreground">{{ t('welcome.shortcuts') }}</span>
        </div>
        <div class="grid grid-cols-2 gap-x-6 gap-y-1.5">
          <div
            v-for="shortcut in shortcuts"
            :key="shortcut.actionKey"
            class="flex items-center justify-between"
          >
            <span class="text-xs text-muted-foreground">{{ t(shortcut.actionKey) }}</span>
            <div class="flex items-center gap-0.5">
              <kbd
                v-for="key in shortcut.keys"
                :key="key"
                class="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                {{ key }}
              </kbd>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
