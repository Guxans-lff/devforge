<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useConnectionStore } from '@/stores/connections'
import { useSettingsStore } from '@/stores/settings'
import { getVersion } from '@tauri-apps/api/app'
import { ref } from 'vue'
import {
  Database,
  Terminal,
  FolderOpen,
  Keyboard,
  Plus,
  ArrowRight,
  Zap,
} from 'lucide-vue-next'
import type { TabType } from '@/types/workspace'
import ConnectionDialog from '@/components/connection/ConnectionDialog.vue'


const { t } = useI18n()
const workspace = useWorkspaceStore()
const connectionStore = useConnectionStore()
const settingsStore = useSettingsStore()

const appVersion = ref('')
const showConnectionDialog = ref(false)
const presetConnectionType = ref<'database' | 'ssh' | 'sftp' | 'redis' | 'git'>('database')

// 动态欢迎语
const currentTime = ref(new Date())
const greeting = computed(() => {
  const hour = currentTime.value.getHours()
  if (hour < 6) return t('welcome.greetingNight') || '夜深了'
  if (hour < 12) return t('welcome.greetingMorning') || '早安'
  if (hour < 14) return t('welcome.greetingNoon') || '午安'
  if (hour < 18) return t('welcome.greetingAfternoon') || '下午好'
  return t('welcome.greetingEvening') || '晚上好'
})

onMounted(async () => {
  connectionStore.loadConnections()
  try {
    appVersion.value = await getVersion()
  } catch {
    appVersion.value = '0.1.0'
  }
})

function handleQuickAction(type: TabType) {
  const typeMap: Record<string, 'database' | 'ssh' | 'sftp'> = {
    database: 'database',
    terminal: 'ssh',
    'file-manager': 'sftp',
  }
  presetConnectionType.value = typeMap[type] ?? 'database'
  showConnectionDialog.value = true
}

function handleConnectionConnect(connectionId: string, connectionName: string) {
  const typeToTab: Record<string, TabType> = {
    database: 'database',
    ssh: 'terminal',
    sftp: 'file-manager',
    redis: 'redis',
    git: 'git',
  }
  const tabType = typeToTab[presetConnectionType.value] ?? 'database'
  // Git 连接不需要 connectionId，而是在 Sidebar 里通过 host 字段获取路径
  workspace.addTab({
    id: `${tabType}-${connectionId}`,
    type: tabType,
    title: connectionName,
    connectionId,
    closable: true,
  })
}

function handleConnectionSaved() {
  connectionStore.loadConnections()
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
  // Git 连接：用 host 字段作为仓库路径
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

const recentConnections = computed(() =>
  connectionStore.connectionList.slice(0, 5),
)

const quickActions = computed(() => [
  {
    type: 'database' as TabType,
    icon: Database,
    color: 'text-df-info',
    bg: 'bg-df-info/10',
    borderHover: 'hover:border-df-info/40',
  },
  {
    type: 'terminal' as TabType,
    icon: Terminal,
    color: 'text-df-success',
    bg: 'bg-df-success/10',
    borderHover: 'hover:border-df-success/40',
  },
  {
    type: 'file-manager' as TabType,
    icon: FolderOpen,
    color: 'text-df-warning',
    bg: 'bg-df-warning/10',
    borderHover: 'hover:border-df-warning/40',
  },
])

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
    })),
)

const statusColorMap = Object.freeze<Record<string, string>>({
  connected: 'bg-df-success',
  disconnected: 'bg-muted-foreground/40',
  connecting: 'bg-df-warning animate-pulse',
  error: 'bg-destructive',
})
</script>

<template>
  <div class="relative flex h-full overflow-hidden bg-background selection:bg-primary/20">
    <!-- 动态光晕背景 -->
    <div class="absolute inset-0 overflow-hidden pointer-events-none motion-reduce:hidden">
      <div class="absolute -top-[10%] -left-[10%] h-[40%] w-[40%] rounded-full bg-primary/10 blur-[120px] animate-blob-slow"></div>
      <div class="absolute top-[20%] -right-[5%] h-[35%] w-[35%] rounded-full bg-primary/5 blur-[120px] animate-blob-slow delay-700"></div>
      <div class="absolute -bottom-[10%] left-[20%] h-[30%] w-[30%] rounded-full bg-muted-foreground/5 blur-[120px] animate-blob-slow delay-1000"></div>
    </div>

    <!-- 技术网格 -->
    <div class="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.02)_1px,transparent_1px)] bg-[size:48px_48px] dark:bg-[linear-gradient(rgba(255,255,255,0.008)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.008)_1px,transparent_1px)]"></div>
    <div class="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background/80 pointer-events-none"></div>

    <!-- 主容器 -->
    <div class="relative z-10 m-auto flex w-full max-w-5xl flex-col gap-10 px-8 py-16">
      
      <!-- Hero Section (Dashboard Style) -->
      <div class="flex flex-col items-start gap-1.5 animate-in fade-in slide-in-from-left-8 duration-700">
        <div class="flex items-center gap-4">
          <div class="relative group">
            <div class="absolute -inset-1 rounded-xl bg-primary/20 blur-sm group-hover:bg-primary/30 transition-colors"></div>
            <div class="relative flex h-12 w-12 items-center justify-center rounded-xl bg-background border border-primary/20 text-primary shadow-2xl">
              <Zap class="h-7 w-7 fill-primary/10" />
            </div>
          </div>
          <div class="flex flex-col gap-2">
            <h1 class="text-3xl font-black tracking-tighter text-foreground/90 tabular-nums">
              {{ greeting }}, <span class="text-primary font-black">{{ t('welcome.titleName') || 'DevForge' }}</span>
            </h1>
            <div class="flex items-center gap-3">
              <div class="h-[1px] w-8 bg-primary/20"></div>
              <p class="text-[10px] font-black text-muted-foreground/30 uppercase tracking-[0.4em]">
                {{ t('welcome.subtitle') }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- 内容网格 -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        
        <!-- 左侧：旗舰级快速入口 -->
        <div class="lg:col-span-8 flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-300 fill-mode-both">
          
          <div class="grid grid-cols-3 gap-4">
            <button
              v-for="action in quickActions"
              :key="action.type"
              :aria-label="t(`welcome.${action.type === 'file-manager' ? 'filesDesc' : action.type + 'Desc'}`)"
              class="group relative flex flex-col items-start gap-5 rounded-xl border border-white/80 bg-white/40 dark:border-white/5 dark:bg-card/40 backdrop-blur-3xl p-6 transition-[border-color,box-shadow,translate,scale] duration-700 hover:border-primary/30 hover:shadow-[0_32px_64px_-16px_rgba(0,0,0,0.08)] hover:-translate-y-1.5 active:scale-[0.98] overflow-hidden focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
              @click="handleQuickAction(action.type)"
            >
              <!-- Metallic Reflection Highlight (Day Mode Optimized) -->
              <div class="absolute inset-0 bg-gradient-to-br from-white/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
              <div class="absolute -right-4 -bottom-4 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity duration-700">
                <component :is="action.icon" class="h-24 w-24 rotate-12" />
              </div>
              
              <div class="flex h-11 w-11 items-center justify-center rounded-xl border border-border/50 bg-muted/20 transition-[border-color,background-color,rotate] duration-500 group-hover:border-primary/20 group-hover:bg-primary/5 group-hover:rotate-3">
                <component :is="action.icon" :class="[action.color, 'h-6 w-6 transition-colors group-hover:text-primary']" />
              </div>
              <div class="flex flex-col gap-1 text-left relative z-10">
                <span class="text-sm font-black text-foreground/80 tracking-tight group-hover:text-primary transition-colors">{{ t(`welcome.${action.type === 'file-manager' ? 'files' : action.type}`) }}</span>
                <span class="text-[11px] font-medium text-muted-foreground/50 leading-relaxed">{{ t(`welcome.${action.type === 'file-manager' ? 'filesDesc' : action.type + 'Desc'}`) }}</span>
              </div>
            </button>
          </div>

          <!-- 最近连接面板 (Frosted Equipment Module) -->
          <div class="flex flex-col rounded-2xl border border-white/60 bg-white/30 dark:border-white/5 dark:bg-card/40 backdrop-blur-3xl overflow-hidden shadow-[0_8px_32px_-8px_rgba(0,0,0,0.04)] transition-shadow duration-700 hover:shadow-[0_16px_48px_-8px_rgba(0,0,0,0.08)]">
            <div class="flex h-12 items-center justify-between border-b border-black/[0.03] dark:border-white/5 bg-black/[0.01] dark:bg-muted/20 px-5">
              <div class="flex items-center gap-3">
                <div class="relative flex h-2 w-2 items-center justify-center">
                  <div class="absolute h-full w-full rounded-full bg-primary/20 animate-ping"></div>
                  <div class="h-1.5 w-1.5 rounded-full bg-primary"></div>
                </div>
                <span class="text-[9px] font-black uppercase tracking-[0.3em] text-foreground/40">
                  {{ t('welcome.recentConnections') }}
                </span>
              </div>
              <button
                :aria-label="t('welcome.newConn')"
                class="group flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[10px] font-black text-background transition-[background-color,scale] hover:bg-primary active:scale-95 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
                @click="showConnectionDialog = true"
              >
                <Plus class="h-3.5 w-3.5 transition-transform group-hover:rotate-90" />
                {{ t('welcome.newConn') }}
              </button>
            </div>

            <div v-if="recentConnections.length === 0" class="flex flex-col items-center justify-center py-16 text-center opacity-30">
              <Database class="h-10 w-10 text-muted-foreground mb-3 stroke-[1]" />
              <p class="text-[11px] font-black uppercase tracking-widest text-muted-foreground">{{ t('welcome.noConnections') }}</p>
            </div>

            <div v-else class="grid grid-cols-1 md:grid-cols-2 p-3 gap-2 overflow-y-auto max-h-[260px] custom-scrollbar" role="list" :aria-label="t('welcome.recentConnections')">
              <button
                v-for="conn in recentConnections"
                :key="conn.record.id"
                role="listitem"
                :aria-label="`${conn.record.name} (${conn.record.host})`"
                class="group flex items-center gap-3.5 rounded-xl border border-transparent p-3 transition-[background-color,border-color] duration-300 hover:bg-primary/5 hover:border-primary/10 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
                @click="openConnection(conn)"
              >
                <div class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/20 group-hover:bg-background group-hover:border-primary/20 group-hover:shadow-sm transition-[background-color,border-color,box-shadow] duration-300">
                  <component 
                    :is="conn.record.type === 'database' ? Database : (conn.record.type === 'ssh' ? Terminal : FolderOpen)" 
                    class="h-5 w-5 text-muted-foreground/50 transition-colors group-hover:text-primary" 
                  />
                  <div class="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-background shadow-sm" :class="statusColorMap[conn.status] ?? 'bg-muted-foreground/40'" />
                </div>
                <div class="min-w-0 flex-1 text-left flex flex-col gap-0.5">
                  <p class="truncate text-[13px] font-black text-foreground/80 group-hover:text-primary transition-colors leading-none pb-1">{{ conn.record.name }}</p>
                  <p class="truncate font-mono text-[10px] font-medium text-muted-foreground/40 tracking-wide transition-colors group-hover:text-muted-foreground/60">{{ conn.record.host }}</p>
                </div>
                <ArrowRight class="h-4 w-4 text-primary opacity-0 -translate-x-3 transition-[opacity,translate] duration-500 group-hover:opacity-100 group-hover:translate-x-0" />
              </button>
            </div>
          </div>
        </div>

        <!-- 右侧：工业级快捷键面板 -->
        <div class="lg:col-span-4 flex flex-col gap-8 animate-in fade-in slide-in-from-right-8 duration-700 delay-500 fill-mode-both">
          
          <div class="flex flex-col rounded-2xl border border-white/60 bg-white/30 dark:border-white/5 dark:bg-card/40 backdrop-blur-3xl overflow-hidden transition-shadow duration-700 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.04)] hover:shadow-[0_16px_48px_-8px_rgba(0,0,0,0.08)]">
            <div class="flex h-12 items-center gap-3.5 border-b border-black/[0.03] dark:border-white/5 bg-black/[0.01] dark:bg-muted/20 px-5">
              <Keyboard class="h-4 w-4 text-foreground/20" />
              <span class="text-[9px] font-black uppercase tracking-[0.3em] text-foreground/40">
                  {{ t('welcome.shortcuts') }}
                </span>
            </div>
            
            <div class="flex flex-col p-3 gap-1">
              <div
                v-for="shortcut in shortcuts"
                :key="shortcut.actionKey"
                class="group flex items-center justify-between rounded-lg p-2.5 transition-colors hover:bg-primary/5"
              >
                <span class="text-[11px] font-black text-muted-foreground/60 uppercase tracking-tight group-hover:text-foreground/80 transition-colors">{{ t(shortcut.actionKey) }}</span>
                <div class="flex items-center gap-1.5">
                  <kbd
                    v-for="key in shortcut.keys"
                    :key="key"
                    class="flex h-5 min-w-[22px] items-center justify-center rounded border border-border/60 bg-muted/40 px-1.5 text-[9px] font-black text-muted-foreground/40 shadow-sm group-hover:border-primary/20 group-hover:text-primary transition-[border-color,color] uppercase"
                  >
                    {{ key }}
                  </kbd>
                </div>
              </div>
            </div>
          </div>

          <!-- 系统状态与版本 -->
          <div class="mt-auto flex flex-col gap-1">
            <div class="flex items-center justify-between px-2">
              <span class="text-[10px] font-black text-muted-foreground/40 uppercase tracking-[0.4em]">{{ t('welcome.systemCore') }}</span>
              <div class="flex items-center gap-2 px-2 py-0.5 rounded-full bg-df-success/5 border border-df-success/10">
                <div class="h-1.5 w-1.5 rounded-full bg-df-success animate-pulse"></div>
                <span class="text-[9px] font-black text-df-success uppercase tracking-widest">{{ t('bottomPanel.ready') }}</span>
              </div>
            </div>
            <div class="group relative rounded-2xl border border-black/[0.03] dark:border-white/5 bg-black/[0.02] dark:bg-muted/10 p-5 overflow-hidden transition-colors duration-500 hover:bg-black/[0.04] dark:hover:bg-muted/20 shadow-inner">
              <div class="absolute top-0 right-0 p-4 opacity-[0.02] group-hover:opacity-[0.04] transition-opacity duration-700">
                <Zap class="h-12 w-12 rotate-6" />
              </div>
              <p class="relative z-10 text-[11px] font-bold text-foreground/40 leading-relaxed uppercase tracking-widest">
                DevForge <span class="text-primary/60 font-black">v{{ appVersion }}</span>.
                {{ t('welcome.appDescription') }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 新建连接对话框 -->
  <ConnectionDialog
    v-model:open="showConnectionDialog"
    :editing-connection="null"
    :default-type="presetConnectionType"
    @saved="handleConnectionSaved"
    @connect="handleConnectionConnect"
  />
</template>

<style scoped>
@keyframes blob-move {
  0% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(10%, 15%) scale(1.1); }
  66% { transform: translate(-5%, 20%) scale(0.95); }
  100% { transform: translate(0, 0) scale(1); }
}

.animate-blob-slow {
  animation: blob-move 20s infinite ease-in-out;
}

.delay-700 {
  animation-delay: 7s;
}

.delay-1000 {
  animation-delay: 10s;
}

.selection\:bg-primary\/20 ::selection {
  background-color: rgba(var(--color-primary), 0.2);
}
</style>

