<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Search, Keyboard } from 'lucide-vue-next'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()
const settingsStore = useSettingsStore()

const searchQuery = ref('')

/** 分类标签 */
const categoryLabels: Record<string, string> = {
  connection: t('shortcut.connection'),
  tab: t('shortcut.tab'),
  editor: t('shortcut.editor'),
  view: t('shortcut.view'),
  general: t('shortcut.general'),
}

/** 快捷键 ID 对应的显示名称 */
const shortcutLabels: Record<string, string> = {
  newConnection: t('shortcut.newConnection'),
  duplicateConnection: t('shortcut.duplicateConnection'),
  editConnection: t('shortcut.editConnection'),
  disconnectConnection: t('shortcut.disconnectConnection'),
  reconnectConnection: t('shortcut.reconnectConnection'),
  refreshObjectTree: t('shortcut.refreshObjectTree'),
  testConnection: t('shortcut.testConnection'),
  connectionInfo: t('shortcut.connectionInfo'),
  newTab: t('shortcut.newTab'),
  closeTab: t('shortcut.closeTab'),
  nextTab: t('shortcut.nextTab'),
  prevTab: t('shortcut.prevTab'),
  closeAllTabs: t('shortcut.closeAllTabs'),
  reopenTab: t('shortcut.reopenTab'),
  switchToTab1: t('shortcut.switchToTab1'),
  executeQuery: t('shortcut.executeQuery'),
  executeCurrentLine: t('shortcut.executeCurrentLine'),
  explainQuery: t('shortcut.explainQuery'),
  commentLine: t('shortcut.commentLine'),
  formatSQL: t('shortcut.formatSQL'),
  triggerAutocomplete: t('shortcut.triggerAutocomplete'),
  saveFile: t('shortcut.saveFile'),
  find: t('shortcut.find'),
  replace: t('shortcut.replace'),
  gotoLine: t('shortcut.gotoLine'),
  toggleSidebar: t('shortcut.toggleSidebar'),
  toggleBottomPanel: t('shortcut.toggleBottomPanel'),
  focusObjectTree: t('shortcut.focusObjectTree'),
  focusEditor: t('shortcut.focusEditor'),
  toggleMessageCenter: t('shortcut.toggleMessageCenter'),
  toggleFullscreen: t('shortcut.toggleFullscreen'),
  commandPalette: t('shortcut.commandPalette'),
  toggleTheme: t('shortcut.toggleTheme'),
  settings: t('shortcut.settings'),
  help: t('shortcut.help'),
  quit: t('shortcut.quit'),
}

/** 按分类分组的快捷键 */
const groupedShortcuts = computed(() => {
  const q = searchQuery.value.toLowerCase()
  const categories = ['connection', 'tab', 'editor', 'view', 'general']

  return categories.map(cat => {
    const items = settingsStore.settings.shortcuts
      .filter(s => s.category === cat)
      .filter(s => {
        if (!q) return true
        const label = shortcutLabels[s.id] ?? s.id
        return label.toLowerCase().includes(q) || s.keys.toLowerCase().includes(q)
      })
      .map(s => ({
        id: s.id,
        label: shortcutLabels[s.id] ?? s.id,
        keys: s.keys,
      }))

    return {
      category: cat,
      label: categoryLabels[cat] ?? cat,
      items,
    }
  }).filter(g => g.items.length > 0)
})

/** 格式化快捷键显示 */
function formatKeys(keys: string): string[] {
  // 处理组合键（如 "Ctrl+K T"）
  if (keys.includes(' ')) {
    return keys.split(' ')
  }
  return [keys]
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-[500px] max-h-[80vh] overflow-hidden p-0">
      <DialogHeader class="px-5 pt-5 pb-0">
        <div class="flex items-center gap-2">
          <Keyboard class="h-4 w-4 text-primary" />
          <DialogTitle class="text-sm font-bold">{{ t('shortcut.title') }}</DialogTitle>
        </div>
        <DialogDescription class="text-[10px] text-muted-foreground">
          {{ t('shortcut.description') }}
        </DialogDescription>
      </DialogHeader>

      <!-- 搜索框 -->
      <div class="px-5 pt-3 pb-2">
        <div class="relative">
          <Search class="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            v-model="searchQuery"
            class="h-8 pl-8 text-xs"
            :placeholder="t('shortcut.searchPlaceholder')"
          />
        </div>
      </div>

      <!-- 快捷键列表 -->
      <div class="overflow-y-auto px-5 pb-5 max-h-[55vh]">
        <div v-for="group in groupedShortcuts" :key="group.category" class="mb-4 last:mb-0">
          <h3 class="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-2">
            {{ group.label }}
          </h3>
          <div class="space-y-0.5">
            <div
              v-for="item in group.items"
              :key="item.id"
              class="flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs hover:bg-muted/50 transition-colors"
            >
              <span class="text-foreground/80">{{ item.label }}</span>
              <div class="flex items-center gap-1">
                <kbd
                  v-for="(part, idx) in formatKeys(item.keys)"
                  :key="idx"
                  class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border/60 bg-muted/60 px-1.5 font-mono text-[10px] font-bold text-muted-foreground/80 shadow-[0_1px_0_rgba(0,0,0,0.05)]"
                >{{ part }}</kbd>
              </div>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="groupedShortcuts.length === 0" class="py-8 text-center text-xs text-muted-foreground/50">
          {{ t('command.noResults') }}
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
