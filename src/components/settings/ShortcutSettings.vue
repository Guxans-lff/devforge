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

// Map shortcut IDs to i18n keys
const shortcutLabels: Record<string, string> = {
  newConnection: 'shortcutNewConnection',
  newTab: 'shortcutNewTab',
  closeTab: 'shortcutCloseTab',
  nextTab: 'shortcutNextTab',
  settings: 'shortcutSettings',
  toggleSidebar: 'shortcutToggleSidebar',
  toggleBottomPanel: 'shortcutToggleBottomPanel',
}

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
            tabindex="0"
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
  </div>
</template>
