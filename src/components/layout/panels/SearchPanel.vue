<script setup lang="ts">
/**
 * Search Panel — 全局搜索面板
 *
 * 搜索 Tab 标题 + 连接名，点击结果跳转。
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useConnectionStore } from '@/stores/connections'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Search,
  Database,
  Terminal,
  FolderOpen,
  Container,
  GitBranch,
  FileCode,
  Settings,
  Bot,
  LayoutGrid,
  Camera,
  Cable,
} from 'lucide-vue-next'
import type { TabType } from '@/types/workspace'

const { t } = useI18n()
const workspace = useWorkspaceStore()
const connectionStore = useConnectionStore()

const query = ref('')

// Tab 类型图标映射
const tabTypeIcons: Record<TabType, typeof Database> = {
  database: Database,
  terminal: Terminal,
  'file-manager': FolderOpen,
  redis: Container,
  git: GitBranch,
  settings: Settings,
  welcome: FileCode,
  'multi-exec': LayoutGrid,
  'terminal-player': Terminal,
  screenshot: Camera,
  tunnel: Cable,
  'ai-chat': Bot,
}

// 连接类型图标
const connTypeIcons: Record<string, typeof Database> = {
  database: Database,
  ssh: Terminal,
  sftp: FolderOpen,
  redis: Container,
  git: GitBranch,
}

/** 搜索结果 */
const results = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return { tabs: [], connections: [] }

  const matchedTabs = workspace.tabs.filter(tab =>
    tab.title.toLowerCase().includes(q)
  )

  const matchedConnections = connectionStore.connectionList.filter(conn =>
    conn.record.name.toLowerCase().includes(q) ||
    conn.record.host?.toLowerCase().includes(q)
  )

  return { tabs: matchedTabs, connections: matchedConnections }
})

const hasResults = computed(() =>
  results.value.tabs.length > 0 || results.value.connections.length > 0
)

function activateTab(tabId: string) {
  workspace.setActiveTab(tabId)
}

function openConnection(conn: { record: { id: string; name: string; type: string; host: string } }) {
  const typeToTab: Record<string, TabType> = {
    database: 'database',
    ssh: 'terminal',
    sftp: 'file-manager',
    redis: 'redis',
    git: 'git',
  }
  const tabType = typeToTab[conn.record.type] ?? 'database'
  if (conn.record.type === 'git') {
    const repoPath = conn.record.host
    workspace.addTab({
      id: `git-${repoPath.replace(/[\\/:]/g, '_')}`,
      type: 'git',
      title: conn.record.name,
      closable: true,
      meta: { repositoryPath: repoPath },
    })
    return
  }
  workspace.addTab({
    id: `${tabType}-${conn.record.id}`,
    type: tabType,
    title: conn.record.name,
    connectionId: conn.record.id,
    closable: true,
  })
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 搜索框 -->
    <div class="px-3 pt-3 pb-2">
      <div class="group relative flex items-center">
        <div class="absolute inset-0 rounded-full bg-muted/60 dark:bg-black/20 shadow-[inset_0_2px_4px_rgba(0,0,0,0.03),inset_0_0_0_1px_rgba(0,0,0,0.04)] transform-gpu transition-[background-color,box-shadow] duration-300 group-focus-within:bg-background group-focus-within:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05),0_0_0_2px_rgba(var(--primary-rgb),0.15)]" />
        <Search class="absolute left-3.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary z-10" />
        <Input
          v-model="query"
          class="h-[34px] w-full border-none bg-transparent pl-10 pr-3 text-[13px] font-medium text-foreground placeholder:text-muted-foreground shadow-none focus-visible:ring-0 z-10"
          :placeholder="t('sidebar.searchConnections')"
          @keydown.escape="query = ''"
        />
      </div>
    </div>

    <!-- 结果列表 -->
    <ScrollArea class="flex-1 min-h-0">
      <!-- 无搜索时提示 -->
      <div v-if="!query.trim()" class="flex flex-col items-center justify-center py-10 text-center">
        <Search class="h-8 w-8 text-muted-foreground/20 mb-2" />
        <p class="text-xs text-muted-foreground/60">{{ t('sidebar.searchConnections') }}</p>
      </div>

      <!-- 无结果 -->
      <div v-else-if="!hasResults" class="flex flex-col items-center justify-center py-10 text-center">
        <p class="text-xs text-muted-foreground/60">无匹配结果</p>
      </div>

      <div v-else class="px-1 py-1">
        <!-- Tab 结果 -->
        <div v-if="results.tabs.length > 0" class="mb-3">
          <div class="px-3 py-1 text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest">标签页</div>
          <button
            v-for="tab in results.tabs"
            :key="tab.id"
            class="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors"
            :class="{ 'bg-primary/5 text-primary': tab.id === workspace.activeTabId }"
            @click="activateTab(tab.id)"
          >
            <component :is="tabTypeIcons[tab.type] ?? FileCode" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span class="truncate">{{ tab.title }}</span>
          </button>
        </div>

        <!-- 连接结果 -->
        <div v-if="results.connections.length > 0">
          <div class="px-3 py-1 text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest">连接</div>
          <button
            v-for="conn in results.connections"
            :key="conn.record.id"
            class="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors"
            @click="openConnection(conn)"
          >
            <component :is="connTypeIcons[conn.record.type] ?? Database" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div class="min-w-0 flex-1">
              <div class="truncate">{{ conn.record.name }}</div>
              <div class="truncate text-[10px] text-muted-foreground/50">{{ conn.record.host }}</div>
            </div>
          </button>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
