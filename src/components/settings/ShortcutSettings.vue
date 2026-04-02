<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { RotateCcw } from 'lucide-vue-next'

const { t } = useI18n()
const settingsStore = useSettingsStore()

// 可自定义快捷键的 ID 到 i18n key 的映射（完整覆盖所有快捷键）
const shortcutLabels: Record<string, string> = {
  // 连接管理
  newConnection: 'shortcutNewConnection',
  duplicateConnection: 'shortcutDuplicateConnection',
  editConnection: 'shortcutEditConnection',
  disconnectConnection: 'shortcutDisconnectConnection',
  reconnectConnection: 'shortcutReconnectConnection',
  refreshObjectTree: 'shortcutRefreshObjectTree',
  testConnection: 'shortcutTestConnection',
  connectionInfo: 'shortcutConnectionInfo',
  // 标签页管理
  newTab: 'shortcutNewTab',
  closeTab: 'shortcutCloseTab',
  nextTab: 'shortcutNextTab',
  prevTab: 'shortcutPrevTab',
  closeAllTabs: 'shortcutCloseAllTabs',
  reopenTab: 'shortcutReopenTab',
  switchToTab1: 'shortcutSwitchToTab1',
  // 编辑器操作
  executeQuery: 'shortcutExecuteQuery',
  executeCurrentLine: 'shortcutExecuteCurrentLine',
  explainQuery: 'shortcutExplainQuery',
  commentLine: 'shortcutCommentLine',
  formatSQL: 'shortcutFormatSQL',
  triggerAutocomplete: 'shortcutTriggerAutocomplete',
  saveFile: 'shortcutSaveFile',
  find: 'shortcutFind',
  replace: 'shortcutReplace',
  gotoLine: 'shortcutGotoLine',
  // 视图控制
  toggleSidebar: 'shortcutToggleSidebar',
  toggleBottomPanel: 'shortcutToggleBottomPanel',
  focusObjectTree: 'shortcutFocusObjectTree',
  focusEditor: 'shortcutFocusEditor',
  toggleMessageCenter: 'shortcutToggleMessageCenter',
  toggleFullscreen: 'shortcutToggleFullscreen',
  // 通用操作
  commandPalette: 'shortcutCommandPalette',
  toggleTheme: 'shortcutToggleTheme',
  settings: 'shortcutSettings',
  help: 'shortcutHelp',
  quit: 'shortcutQuit',
}

/** 快捷键参考分组定义（只读展示） */
interface ShortcutRefItem {
  keys: string
  descKey: string
}

interface ShortcutRefGroup {
  titleKey: string
  items: ShortcutRefItem[]
}

const shortcutRefGroups: ShortcutRefGroup[] = [
  {
    titleKey: 'settings.shortcutRefSqlEditor',
    items: [
      { keys: 'Ctrl+Enter', descKey: 'settings.shortcutRefExecCurrent' },
      { keys: 'Ctrl+Shift+Enter', descKey: 'settings.shortcutRefExecAll' },
      { keys: 'F5', descKey: 'settings.shortcutRefExecCurrent' },
      { keys: 'Ctrl+Shift+F', descKey: 'settings.shortcutRefFormatSql' },
      { keys: 'Shift+Alt+F', descKey: 'settings.shortcutRefFormatSql' },
      { keys: 'Ctrl+S', descKey: 'settings.shortcutRefSaveSnippet' },
    ],
  },
  {
    titleKey: 'settings.shortcutRefGlobal',
    items: [
      { keys: 'Ctrl+T', descKey: 'settings.shortcutRefNewTab' },
      { keys: 'Ctrl+W', descKey: 'settings.shortcutRefCloseTab' },
      { keys: 'Ctrl+Tab', descKey: 'settings.shortcutRefSwitchTab' },
    ],
  },
  {
    titleKey: 'settings.shortcutRefDataGrid',
    items: [
      { keys: 'Ctrl+C', descKey: 'settings.shortcutRefCopy' },
      { keys: 'Ctrl+F', descKey: 'settings.shortcutRefSearch' },
      { keys: 'Ctrl+G', descKey: 'settings.shortcutRefGotoRow' },
    ],
  },
]

const editingId = ref<string | null>(null)
const conflictId = ref<string | null>(null)

function startEditing(id: string) {
  editingId.value = id
  conflictId.value = null
}

function cancelEditing() {
  editingId.value = null
  conflictId.value = null
}

function handleKeyCapture(e: KeyboardEvent) {
  if (!editingId.value) return

  e.preventDefault()
  e.stopPropagation()

  // Ignore modifier-only presses
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return

  // Escape cancels editing
  if (e.key === 'Escape') {
    cancelEditing()
    return
  }

  // Build key string
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')

  // Normalize key name
  let keyName = e.key
  if (keyName === ' ') keyName = 'Space'
  else if (keyName.length === 1) keyName = keyName.toUpperCase()
  else if (keyName === 'Tab') keyName = 'Tab'

  parts.push(keyName)
  const newKeys = parts.join('+')

  // Must include at least one modifier
  if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) return

  // Check for conflicts
  const conflict = settingsStore.settings.shortcuts.find(
    s => s.id !== editingId.value && s.keys === newKeys
  )

  if (conflict) {
    conflictId.value = conflict.id
    // Still allow the change after showing conflict briefly
    setTimeout(() => {
      conflictId.value = null
    }, 2000)
    return
  }

  // Apply the new shortcut
  settingsStore.updateShortcut(editingId.value, newKeys)
  editingId.value = null
  conflictId.value = null
}
</script>

<template>
  <div class="space-y-4" @keydown="handleKeyCapture">
    <template v-for="(shortcut, index) in settingsStore.settings.shortcuts" :key="shortcut.id">
      <div class="flex items-center justify-between">
        <Label class="text-sm">{{ t(`settings.${shortcutLabels[shortcut.id]}`) }}</Label>
        <div class="flex items-center gap-2">
          <Badge
            :variant="editingId === shortcut.id ? 'default' : conflictId === shortcut.id ? 'destructive' : 'outline'"
            class="cursor-pointer font-mono text-xs select-none"
            :class="{ 'animate-pulse': editingId === shortcut.id }"
            role="button"
            tabindex="0"
            :aria-label="editingId === shortcut.id ? t('settings.pressKeys') : `${t(`settings.${shortcutLabels[shortcut.id]}`)} ${shortcut.keys}`"
            @click="startEditing(shortcut.id)"
            @blur="cancelEditing"
          >
            {{ editingId === shortcut.id ? t('settings.pressKeys') : shortcut.keys }}
          </Badge>
        </div>
      </div>
      <Separator v-if="index < settingsStore.settings.shortcuts.length - 1" />
    </template>

    <Separator />
    <div class="flex justify-end">
      <Button variant="outline" size="sm" class="gap-1.5 text-xs" @click="settingsStore.resetShortcuts()">
        <RotateCcw class="h-3 w-3" />
        {{ t('settings.resetShortcuts') }}
      </Button>
    </div>

    <!-- 快捷键参考列表（只读） -->
    <Separator />
    <div class="pt-2">
      <Label class="text-base font-bold tracking-tight">{{ t('settings.shortcutRefTitle') }}</Label>
      <p class="text-xs text-muted-foreground/60 mt-1">{{ t('settings.shortcutRefDesc') }}</p>
    </div>

    <div v-for="group in shortcutRefGroups" :key="group.titleKey" class="space-y-2">
      <Label class="text-sm font-semibold text-muted-foreground">{{ t(group.titleKey) }}</Label>
      <div class="rounded-xl border border-border/20 bg-muted/10 overflow-hidden">
        <div
          v-for="(item, idx) in group.items"
          :key="item.keys"
          class="flex items-center justify-between px-4 py-2.5"
          :class="{ 'border-t border-border/10': idx > 0 }"
        >
          <span class="text-sm text-foreground/80">{{ t(item.descKey) }}</span>
          <Badge variant="outline" class="font-mono text-xs select-none pointer-events-none">
            {{ item.keys }}
          </Badge>
        </div>
      </div>
    </div>
  </div>
</template>
