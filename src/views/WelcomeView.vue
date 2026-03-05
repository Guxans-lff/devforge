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
  Moon,
  Sun,
  CloudSun,
} from 'lucide-vue-next'
import type { TabType } from '@/types/workspace'
import ConnectionDialog from '@/components/connection/ConnectionDialog.vue'


const { t } = useI18n()
const workspace = useWorkspaceStore()
const connectionStore = useConnectionStore()
const settingsStore = useSettingsStore()

const appVersion = ref('')
const showConnectionDialog = ref(false)
const presetConnectionType = ref<'database' | 'ssh' | 'sftp'>('database')

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

const GreetingIcon = computed(() => {
  const hour = currentTime.value.getHours()
  if (hour < 6 || hour >= 18) return Moon
  if (hour < 12) return Sun
  return CloudSun
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
  }
  const tabType = typeToTab[presetConnectionType.value] ?? 'database'
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
function openConnection(conn: { record: { id: string; name: string; type: string } }) {
  const typeToTab: Record<string, TabType> = {
    database: 'database',
    ssh: 'terminal',
    sftp: 'file-manager',
  }
  const tabType = typeToTab[conn.record.type] ?? 'database'
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
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
    borderHover: 'hover:border-blue-500/40',
  },
  {
    type: 'terminal' as TabType,
    icon: Terminal,
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
    borderHover: 'hover:border-emerald-500/40',
  },
  {
    type: 'file-manager' as TabType,
    icon: FolderOpen,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
    borderHover: 'hover:border-amber-500/40',
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

const statusColorMap: Record<string, string> = {
  connected: 'bg-emerald-500',
  disconnected: 'bg-muted-foreground/40',
  connecting: 'bg-amber-500 animate-pulse',
  error: 'bg-destructive',
}
</script>

<template>
  <div class="relative flex h-full overflow-hidden bg-background selection:bg-primary/10">
    <!-- 微弱的深度感背景 (Subtle Depth Background) -->
    <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,var(--color-primary-20),transparent_70%)] opacity-30"></div>
    <div class="absolute inset-0 bg-[linear-gradient(rgba(128,128,128,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(128,128,128,0.03)_1px,transparent_1px)] bg-[size:32px_32px]"></div>

    <!-- 主容器 -->
    <div class="relative z-10 m-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-12">
      
      <!-- Hero Section -->
      <div class="flex flex-col items-start justify-center gap-1 animate-in fade-in slide-in-from-left-4 duration-700">
        <div class="flex items-center gap-2.5">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Zap class="h-6 w-6" />
          </div>
          <div class="space-y-0">
            <h1 class="text-2xl font-bold tracking-tight text-foreground">
              {{ greeting }}, <span class="text-primary">DevForge</span>
            </h1>
            <p class="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-widest">
              {{ t('welcome.subtitle') }}
            </p>
          </div>
        </div>
      </div>

      <!-- 内容网格 -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        
        <!-- 左侧：快速入口 -->
        <div class="lg:col-span-8 flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-200 fill-mode-both">
          
          <div class="grid grid-cols-3 gap-3">
            <button
              v-for="(action, index) in quickActions"
              :key="action.type"
              class="group relative flex flex-col items-start gap-4 rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:border-primary/50 hover:shadow-md active:scale-[0.98]"
              @click="handleQuickAction(action.type)"
            >
              <div class="flex h-9 w-9 items-center justify-center rounded-lg border border-border transition-colors group-hover:border-primary/20 group-hover:bg-primary/5">
                <component :is="action.icon" class="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div class="flex flex-col gap-0.5 text-left">
                <span class="text-xs font-bold text-foreground">{{ t(`welcome.${action.type === 'file-manager' ? 'files' : action.type}`) }}</span>
                <span class="text-[10px] text-muted-foreground leading-tight">{{ t(`welcome.${action.type === 'file-manager' ? 'filesDesc' : action.type + 'Desc'}`) }}</span>
              </div>
            </button>
          </div>

          <!-- 最近连接面板 -->
          <div class="flex flex-col rounded-xl border border-border bg-card overflow-hidden shadow-sm">
            <div class="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
              <div class="flex items-center gap-2">
                <Database class="h-3.5 w-3.5 text-muted-foreground" />
                <span class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {{ t('welcome.recentConnections') }}
                </span>
              </div>
              <button
                class="flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[10px] font-bold text-background transition-all hover:opacity-90 active:scale-95"
                @click="showConnectionDialog = true"
              >
                <Plus class="h-3 w-3" />
                {{ t('welcome.newConn') }}
              </button>
            </div>

            <div v-if="recentConnections.length === 0" class="flex flex-col items-center justify-center py-12 text-center">
              <Database class="h-8 w-8 text-muted-foreground/20 mb-2" />
              <p class="text-xs font-medium text-muted-foreground/60">{{ t('welcome.noConnections') }}</p>
            </div>

            <div v-else class="grid grid-cols-1 md:grid-cols-2 p-2 gap-1 overflow-y-auto max-h-[220px] qr-scroll-area">
              <button
                v-for="conn in recentConnections"
                :key="conn.record.id"
                class="group flex items-center gap-3 rounded-lg border border-transparent p-2 transition-all hover:bg-muted/50 hover:border-border"
                @click="openConnection(conn)"
              >
                <div class="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/50 bg-muted/20 group-hover:bg-background group-hover:border-primary/30 transition-all">
                  <component 
                    :is="conn.record.type === 'database' ? Database : (conn.record.type === 'ssh' ? Terminal : FolderOpen)" 
                    class="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" 
                  />
                  <div class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-background" :class="statusColorMap[conn.status] ?? 'bg-muted-foreground/40'" />
                </div>
                <div class="min-w-0 flex-1 text-left items-start overflow-hidden">
                  <p class="truncate text-[12px] font-semibold text-foreground/90">{{ conn.record.name }}</p>
                  <p class="truncate font-mono text-[9px] text-muted-foreground/60">{{ conn.record.host }}</p>
                </div>
                <ArrowRight class="h-3 w-3 text-primary opacity-0 -translate-x-2 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
              </button>
            </div>
          </div>
        </div>

        <!-- 右侧：快捷键 + 状态 -->
        <div class="lg:col-span-4 flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-700 delay-400 fill-mode-both">
          
          <div class="flex flex-col rounded-xl border border-border bg-card overflow-hidden shadow-sm">
            <div class="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
              <Keyboard class="h-3.5 w-3.5 text-muted-foreground" />
              <span class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {{ t('welcome.shortcuts') }}
                </span>
            </div>
            
            <div class="flex flex-col p-2">
              <div
                v-for="shortcut in shortcuts"
                :key="shortcut.actionKey"
                class="group flex items-center justify-between rounded-md p-2 transition-colors hover:bg-muted/30"
              >
                <span class="text-[11px] font-medium text-muted-foreground group-hover:text-foreground">{{ t(shortcut.actionKey) }}</span>
                <div class="flex items-center gap-1">
                  <kbd
                    v-for="key in shortcut.keys"
                    :key="key"
                    class="flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-muted/50 px-1 text-[9px] font-bold text-muted-foreground shadow-xs"
                  >
                    {{ key }}
                  </kbd>
                </div>
              </div>
            </div>
          </div>

          <!-- 版本状态 -->
          <div class="mt-auto flex flex-col gap-4">
            <div class="flex items-center justify-between px-1">
              <span class="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-[0.2em]">System Status</span>
              <div class="flex items-center gap-1.5">
                <div class="h-1.5 w-1.5 rounded-full bg-emerald-500"></div>
                <span class="text-[9px] font-bold text-emerald-500/80 uppercase">Ready</span>
              </div>
            </div>
            <div class="rounded-xl border border-border bg-muted/10 p-4">
              <p class="text-[10px] font-bold text-muted-foreground leading-relaxed text-wrap">
                DevForge <span class="text-foreground">v{{ appVersion }}</span>. 
                专业、高效、现代的数据库与终端管理工具。
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
@keyframes blob {
  0% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(30px, -50px) scale(1.1); }
  66% { transform: translate(-20px, 20px) scale(0.9); }
  100% { transform: translate(0, 0) scale(1); }
}

.ease-out-expo {
  transition-timing-function: cubic-bezier(0.19, 1, 0.22, 1);
}

.qr-scroll-area::-webkit-scrollbar {
  width: 4px;
}
.qr-scroll-area::-webkit-scrollbar-thumb {
  background: rgba(var(--color-border), 0.2);
  border-radius: 10px;
}
.qr-scroll-area::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--color-primary), 0.3);
}
</style>

