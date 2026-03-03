<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCommandPaletteStore } from '@/stores/command-palette'
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
  Clock
} from 'lucide-vue-next'

const { t } = useI18n()
const commandPaletteStore = useCommandPaletteStore()

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
}

// 分组命令
const groupedCommands = computed(() => {
  const groups: Record<string, typeof commandPaletteStore.allCommands.value> = {
    recent: [],
    connection: [],
    view: [],
    settings: [],
    action: [],
  }

  for (const cmd of commandPaletteStore.allCommands) {
    if (groups[cmd.category]) {
      groups[cmd.category].push(cmd)
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
  }).filter(Boolean)
})

function getIcon(iconName?: string) {
  if (!iconName) return null
  return iconMap[iconName] || null
}

// 监听 open 状态
watch(() => commandPaletteStore.isOpen, (isOpen) => {
  if (!isOpen) {
    // 关闭时清空搜索
    // 这里不需要做什么，Command 组件会自动处理
  }
})
</script>

<template>
  <CommandDialog
    v-model:open="commandPaletteStore.isOpen"
    :title="t('command.palette')"
    :description="t('command.searchPlaceholder')"
  >
    <CommandInput :placeholder="t('command.searchPlaceholder')" />
    <CommandList>
      <CommandEmpty>{{ t('command.noResults') }}</CommandEmpty>

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

      <!-- 视图 -->
      <CommandGroup
        v-if="groupedCommands.view.length > 0"
        heading="View"
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

      <!-- 设置 -->
      <CommandGroup
        v-if="groupedCommands.settings.length > 0"
        heading="Settings"
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
    </CommandList>
  </CommandDialog>
</template>
