<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCommandPaletteStore, type CommandItem as CommandItemType } from '@/stores/command-palette'
import { useCommandPaletteSearch } from '@/composables/useCommandPaletteSearch'
import { CommandDialog } from '@/components/ui/command'
import CommandInput from '@/components/ui/command/CommandInput.vue'
import CommandList from '@/components/ui/command/CommandList.vue'
import CommandEmpty from '@/components/ui/command/CommandEmpty.vue'
import CommandGroup from '@/components/ui/command/CommandGroup.vue'
import CommandItem from '@/components/ui/command/CommandItem.vue'
import CommandSeparator from '@/components/ui/command/CommandSeparator.vue'
import {
  Database,
  Terminal,
  FolderOpen,
  Plus,
  RefreshCw,
  PanelLeft,
  PanelBottom,
  Settings,
  X,
  XCircle,
  Clock,
  Table2,
  Columns3,
} from 'lucide-vue-next'

const { t } = useI18n()
const commandPaletteStore = useCommandPaletteStore()
const { searchInput, isPrefixMode, prefixResults, parsedPrefix } = useCommandPaletteSearch()

const iconMap: Record<string, any> = {
  Database,
  Terminal,
  FolderOpen,
  Plus,
  RefreshCw,
  PanelLeft,
  PanelBottom,
  Settings,
  X,
  XCircle,
  Clock,
  Table2,
  Columns3,
}

/** 监听 CommandDialog 内输入变化（通过 DOM 事件冒泡） */
function handleInputEvent(e: Event) {
  const target = e.target as HTMLInputElement
  if (target?.tagName === 'INPUT') {
    searchInput.value = target.value
  }
}

/** 关闭时清空前缀搜索状态 */
watch(() => commandPaletteStore.isOpen, (isOpen) => {
  if (!isOpen) {
    searchInput.value = ''
  }
})

// 分组命令
const groupedCommands = computed(() => {
  const groups: { recent: CommandItemType[]; connection: CommandItemType[]; view: CommandItemType[]; settings: CommandItemType[]; action: CommandItemType[] } = {
    recent: [],
    connection: [],
    view: [],
    settings: [],
    action: [],
  }

  for (const cmd of commandPaletteStore.allCommands) {
    const arr = (groups as Record<string, CommandItemType[]>)[cmd.category]
    if (arr) {
      arr.push(cmd)
    }
  }

  return groups
})

// 最近项目命令
const recentCommands = computed(() => {
  return commandPaletteStore.recentItems.map(item => {
    const conn = commandPaletteStore.connectionCommands.find(c => c.id === `conn-${item.id}`)
    if (conn) {
      return {
        ...conn,
        category: 'recent' as const,
      }
    }
    return null
  }).filter((x): x is NonNullable<typeof x> => x !== null)
})

/** 前缀模式标题 */
const prefixTitle = computed(() => {
  switch (parsedPrefix.value) {
    case '@': return t('search.tables')
    case '.': return t('search.columns')
    case ':': return t('search.history')
    case '#': return t('search.connections')
    default: return ''
  }
})

function getIcon(iconName?: string) {
  if (!iconName) return null
  return iconMap[iconName] || null
}
</script>

<template>
  <CommandDialog
    v-model:open="commandPaletteStore.isOpen"
    :title="t('command.palette')"
    :description="t('command.searchPlaceholder')"
  >
    <div @input="handleInputEvent">
      <CommandInput :placeholder="t('command.searchPlaceholder')" />
    </div>
    <CommandList class="max-h-[450px] p-2">
      <CommandEmpty class="py-12 text-center text-sm text-muted-foreground">
        <XCircle class="mx-auto mb-4 h-8 w-8 opacity-20" />
        {{ t('command.noResults') }}
      </CommandEmpty>

      <!-- 前缀搜索模式 -->
      <template v-if="isPrefixMode">
        <CommandGroup
          v-if="prefixResults.length > 0"
          :heading="prefixTitle"
        >
          <CommandItem
            v-for="cmd in prefixResults"
            :key="cmd.id"
            :value="`${cmd.label} ${cmd.description || ''}`"
            @select="cmd.action"
          >
            <component :is="getIcon(cmd.icon)" v-if="cmd.icon" class="mr-2 h-4 w-4" />
            <div class="flex flex-col min-w-0 flex-1">
              <span class="truncate">{{ cmd.label }}</span>
              <span v-if="cmd.description" class="text-[10px] text-muted-foreground truncate">
                {{ cmd.description }}
              </span>
            </div>
          </CommandItem>
        </CommandGroup>
      </template>

      <!-- 普通模式 -->
      <template v-else>
        <!-- 最近使用 -->
        <CommandGroup
          v-if="recentCommands.length > 0"
          :heading="t('command.recentItems')"
        >
          <CommandItem
            v-for="cmd in recentCommands"
            :key="cmd.id"
            :value="cmd.label"
            @select="cmd.action"
          >
            <component :is="getIcon(cmd.icon)" v-if="cmd.icon" class="mr-2 h-4 w-4" />
            <span>{{ cmd.label }}</span>
            <span v-if="cmd.description" class="ml-auto text-xs text-muted-foreground">
              {{ cmd.description }}
            </span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator v-if="recentCommands.length > 0" />

        <!-- 连接 -->
        <CommandGroup
          v-if="groupedCommands.connection.length > 0"
          :heading="t('command.connections')"
        >
          <CommandItem
            v-for="cmd in groupedCommands.connection"
            :key="cmd.id"
            :value="`${cmd.label} ${cmd.description || ''}`"
            @select="cmd.action"
          >
            <component :is="getIcon(cmd.icon)" v-if="cmd.icon" class="mr-2 h-4 w-4" />
            <div class="flex flex-col">
              <span>{{ cmd.label }}</span>
              <span v-if="cmd.description" class="text-xs text-muted-foreground">
                {{ cmd.description }}
              </span>
            </div>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator v-if="groupedCommands.connection.length > 0" />

        <!-- 操作 -->
        <CommandGroup
          v-if="groupedCommands.action.length > 0"
          :heading="t('command.actions')"
        >
          <CommandItem
            v-for="cmd in groupedCommands.action"
            :key="cmd.id"
            :value="`${cmd.label} ${cmd.description || ''}`"
            @select="cmd.action"
          >
            <component :is="getIcon(cmd.icon)" v-if="cmd.icon" class="mr-2 h-4 w-4" />
            <span>{{ cmd.label }}</span>
            <span v-if="cmd.description" class="ml-auto text-xs text-muted-foreground">
              {{ cmd.description }}
            </span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup
          v-if="groupedCommands.view.length > 0"
          :heading="t('command.view')"
        >
          <CommandItem
            v-for="cmd in groupedCommands.view"
            :key="cmd.id"
            :value="`${cmd.label} ${cmd.description || ''}`"
            @select="cmd.action"
          >
            <component :is="getIcon(cmd.icon)" v-if="cmd.icon" class="mr-2 h-4 w-4" />
            <span>{{ cmd.label }}</span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup
          v-if="groupedCommands.settings.length > 0"
          :heading="t('command.settings')"
        >
          <CommandItem
            v-for="cmd in groupedCommands.settings"
            :key="cmd.id"
            :value="`${cmd.label} ${cmd.description || ''}`"
            @select="cmd.action"
          >
            <component :is="getIcon(cmd.icon)" v-if="cmd.icon" class="mr-2 h-4 w-4" />
            <span>{{ cmd.label }}</span>
          </CommandItem>
        </CommandGroup>
      </template>
    </CommandList>

    <!-- Spotlight Footer -->
    <div class="flex items-center gap-5 border-t border-border/40 bg-muted/10 px-6 py-3.5 text-[10px] text-muted-foreground/50 rounded-b-xl">
      <div class="flex items-center gap-2">
        <kbd class="flex h-5 min-w-5 items-center justify-center rounded-md border border-border/60 bg-muted/60 px-1.5 font-sans text-[10px] font-bold text-muted-foreground/80 shadow-[0_1px_0_1px_rgba(0,0,0,0.1)]">↵</kbd>
        <span class="font-medium tracking-wide uppercase">{{ t('common.confirm') }}</span>
      </div>
      <!-- 前缀提示 -->
      <div class="flex items-center gap-3 text-[9px] font-mono">
        <span class="opacity-60">@</span><span>{{ t('search.tables') }}</span>
        <span class="opacity-60">.</span><span>{{ t('search.columns') }}</span>
        <span class="opacity-60">:</span><span>{{ t('search.history') }}</span>
        <span class="opacity-60">#</span><span>{{ t('search.connections') }}</span>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <kbd class="flex h-5 min-w-8 items-center justify-center rounded-md border border-border/60 bg-muted/60 px-1.5 font-sans text-[9px] font-bold text-muted-foreground/80 shadow-[0_1px_0_1px_rgba(0,0,0,0.1)]">ESC</kbd>
        <span class="font-medium tracking-wide uppercase">{{ t('common.close') }}</span>
      </div>
    </div>
  </CommandDialog>
</template>
