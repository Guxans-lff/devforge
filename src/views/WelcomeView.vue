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
  <div class="relative flex h-full overflow-hidden bg-background selection:bg-primary/20">
    <!-- 大师级动态光晕背景 (Masterpiece Animated Blobs) -->
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <div class="absolute -top-[10%] -left-[10%] h-[40%] w-[40%] rounded-full bg-primary/10 blur-[120px] animate-blob-slow"></div>
      <div class="absolute top-[20%] -right-[5%] h-[35%] w-[35%] rounded-full bg-blue-500/10 blur-[120px] animate-blob-slow delay-700"></div>
      <div class="absolute -bottom-[10%] left-[20%] h-[30%] w-[30%] rounded-full bg-emerald-500/10 blur-[120px] animate-blob-slow delay-1000"></div>
    </div>
    
    <!-- 极细度网格层 -->
    <div class="absolute inset-0 bg-[linear-gradient(rgba(128,128,128,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(128,128,128,0.02)_1px,transparent_1px)] bg-[size:40px_40px]"></div>

    <!-- 主容器 -->
    <div class="relative z-10 m-auto flex w-full max-w-5xl flex-col gap-10 px-8 py-16">
      
      <!-- Hero Section (Dashboard Style) -->
      <div class="flex flex-col items-start gap-1.5 animate-in fade-in slide-in-from-left-8 duration-1000">
        <div class="flex items-center gap-4">
          <div class="relative group">
            <div class="absolute -inset-1 rounded-xl bg-gradient-to-r from-primary to-blue-500 opacity-20 blur-sm group-hover:opacity-40 transition-opacity"></div>
            <div class="relative flex h-12 w-12 items-center justify-center rounded-xl bg-background border border-primary/20 text-primary shadow-2xl">
              <Zap class="h-7 w-7 fill-primary/10" />
            </div>
          </div>
          <div class="flex flex-col gap-2">
            <h1 class="text-3xl font-black tracking-tight text-foreground/90 tabular-nums">
              {{ greeting }}, <span class="bg-gradient-to-br from-primary to-primary/60 bg-clip-text text-transparent">DevForge</span>
            </h1>
            <p class="text-[10px] font-black text-muted-foreground/40 uppercase tracking-[0.3em]">
              {{ t('welcome.subtitle') }}
            </p>
          </div>
        </div>
      </div>

      <!-- 内容网格 -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        
        <!-- 左侧：旗舰级快速入口 -->
        <div class="lg:col-span-8 flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-300 fill-mode-both">
          
          <div class="grid grid-cols-3 gap-4">
            <button
              v-for="action in quickActions"
              :key="action.type"
              class="group relative flex flex-col items-start gap-5 rounded-2xl border border-border/50 bg-card/40 backdrop-blur-xl p-5 transition-all duration-500 hover:border-primary/30 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] hover:-translate-y-1 active:scale-[0.97]"
              @click="handleQuickAction(action.type)"
            >
              <!-- Glass Effect Highlight -->
              <div class="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              
              <div class="flex h-11 w-11 items-center justify-center rounded-xl border border-border/50 bg-muted/20 transition-all duration-500 group-hover:border-primary/20 group-hover:bg-primary/5 group-hover:rotate-3">
                <component :is="action.icon" class="h-6 w-6 text-muted-foreground/60 group-hover:text-primary transition-colors" />
              </div>
              <div class="flex flex-col gap-1 text-left relative z-10">
                <span class="text-sm font-black text-foreground/80 tracking-tight group-hover:text-primary transition-colors">{{ t(`welcome.${action.type === 'file-manager' ? 'files' : action.type}`) }}</span>
                <span class="text-[11px] font-medium text-muted-foreground/50 leading-relaxed">{{ t(`welcome.${action.type === 'file-manager' ? 'filesDesc' : action.type + 'Desc'}`) }}</span>
              </div>
            </button>
          </div>

          <!-- 最近连接面板 (Dashboard Refined) -->
          <div class="flex flex-col rounded-2xl border border-border/50 bg-card/40 backdrop-blur-xl overflow-hidden shadow-sm transition-all duration-500 hover:shadow-md">
            <div class="flex h-12 items-center justify-between border-b border-border/40 bg-muted/20 px-5">
              <div class="flex items-center gap-2.5">
                <div class="h-1.5 w-1.5 rounded-full bg-primary/40 animate-pulse"></div>
                <span class="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">
                  {{ t('welcome.recentConnections') }}
                </span>
              </div>
              <button
                class="group flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[10px] font-black text-background transition-all hover:bg-primary active:scale-95"
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

            <div v-else class="grid grid-cols-1 md:grid-cols-2 p-3 gap-2 overflow-y-auto max-h-[260px] custom-scrollbar">
              <button
                v-for="conn in recentConnections"
                :key="conn.record.id"
                class="group flex items-center gap-3.5 rounded-xl border border-transparent p-3 transition-all duration-300 hover:bg-primary/5 hover:border-primary/10"
                @click="openConnection(conn)"
              >
                <div class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/20 group-hover:bg-background group-hover:border-primary/20 group-hover:shadow-sm transition-all duration-300">
                  <component 
                    :is="conn.record.type === 'database' ? Database : (conn.record.type === 'ssh' ? Terminal : FolderOpen)" 
                    class="h-5 w-5 text-muted-foreground/50 transition-colors group-hover:text-primary" 
                  />
                  <div class="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-background shadow-sm" :class="statusColorMap[conn.status] ?? 'bg-muted-foreground/40'" />
                </div>
                <div class="min-w-0 flex-1 text-left flex flex-col gap-0.5">
                  <p class="truncate text-[13px] font-black text-foreground/80 group-hover:text-primary transition-colors leading-none pb-1">{{ conn.record.name }}</p>
                  <p class="truncate font-mono text-[9px] font-bold text-muted-foreground/40 tracking-wider transition-colors group-hover:text-muted-foreground/60 uppercase">{{ conn.record.host }}</p>
                </div>
                <ArrowRight class="h-4 w-4 text-primary opacity-0 -translate-x-3 transition-all duration-500 group-hover:opacity-100 group-hover:translate-x-0" />
              </button>
            </div>
          </div>
        </div>

        <!-- 右侧：工业级快捷键面板 -->
        <div class="lg:col-span-4 flex flex-col gap-8 animate-in fade-in slide-in-from-right-8 duration-1000 delay-500 fill-mode-both">
          
          <div class="flex flex-col rounded-2xl border border-border/50 bg-card/40 backdrop-blur-xl overflow-hidden transition-all duration-500 hover:shadow-md">
            <div class="flex h-12 items-center gap-2.5 border-b border-border/40 bg-muted/20 px-5">
              <Keyboard class="h-4 w-4 text-muted-foreground/40" />
              <span class="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">
                  {{ t('welcome.shortcuts') }}
                </span>
            </div>
            
            <div class="flex flex-col p-3 gap-1">
              <div
                v-for="shortcut in shortcuts"
                :key="shortcut.actionKey"
                class="group flex items-center justify-between rounded-lg p-2.5 transition-all hover:bg-primary/5"
              >
                <span class="text-[11px] font-black text-muted-foreground/60 uppercase tracking-tight group-hover:text-foreground/80 transition-colors">{{ t(shortcut.actionKey) }}</span>
                <div class="flex items-center gap-1.5">
                  <kbd
                    v-for="key in shortcut.keys"
                    :key="key"
                    class="flex h-5 min-w-[22px] items-center justify-center rounded border border-border/60 bg-muted/40 px-1.5 text-[9px] font-black text-muted-foreground/40 shadow-sm group-hover:border-primary/20 group-hover:text-primary transition-all uppercase"
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
              <div class="flex items-center gap-2 px-2 py-0.5 rounded-full bg-emerald-500/5 border border-emerald-500/10">
                <div class="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                <span class="text-[9px] font-black text-emerald-500 uppercase tracking-widest">{{ t('bottomPanel.ready') }}</span>
              </div>
            </div>
            <div class="group relative rounded-2xl border border-border/50 bg-muted/10 p-3.5 overflow-hidden transition-all hover:bg-muted/20">
              <div class="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
                <Zap class="h-12 w-12" />
              </div>
              <p class="relative z-10 text-[11px] font-black text-muted-foreground/60 leading-relaxed uppercase tracking-wide">
                DevForge <span class="text-primary font-black">v{{ appVersion }}</span>. 
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

