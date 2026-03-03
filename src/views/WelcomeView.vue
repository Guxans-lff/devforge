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
  <div class="relative flex h-full overflow-hidden bg-background/50 selection:bg-primary/20">
    <!-- 灵动背景渐变 (Premium Mesh Gradient) -->
    <div class="pointer-events-none absolute inset-0 overflow-hidden opacity-40 dark:opacity-20">
      <div class="absolute -top-[10%] -left-[10%] w-[50%] h-[50%] animate-[blob_15s_infinite_ease-in-out] rounded-full bg-primary/20 mix-blend-multiply blur-3xl"></div>
      <div class="absolute top-[10%] -right-[10%] w-[45%] h-[45%] animate-[blob_18s_infinite_ease-in-out_2s] rounded-full bg-indigo-500/15 mix-blend-multiply blur-3xl"></div>
      <div class="absolute -bottom-[10%] left-[10%] w-[55%] h-[55%] animate-[blob_12s_infinite_ease-in-out_4s] rounded-full bg-emerald-500/10 mix-blend-multiply blur-3xl"></div>
      <div class="absolute bottom-[20%] right-[20%] w-[40%] h-[40%] animate-[blob_20s_infinite_ease-in-out_6s] rounded-full bg-amber-500/10 mix-blend-multiply blur-3xl"></div>
    </div>

    <!-- 主容器 -->
    <div class="relative z-10 m-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-8">
      
      <!-- Hero Section -->
      <div class="flex flex-col items-center justify-center gap-3 text-center">
        <div class="relative group cursor-default animate-in fade-in zoom-in-50 duration-1000">
          <div class="absolute -inset-5 rounded-full bg-gradient-to-br from-primary/30 to-indigo-500/20 blur-2xl opacity-40 transition-opacity duration-1000 group-hover:opacity-100 animate-pulse"></div>
          <div class="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-background/80 to-background/40 shadow-xl ring-1 ring-white/20 backdrop-blur-xl transition-all duration-700 group-hover:rotate-[360deg] group-hover:scale-105">
            <Zap class="h-7 w-7 text-primary drop-shadow-[0_0_10px_rgba(var(--color-primary),0.5)]" />
          </div>
        </div>
        
        <div class="space-y-1">
          <div class="flex items-center justify-center gap-2 animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-300 fill-mode-both">
            <component :is="GreetingIcon" class="h-4 w-4 text-primary/60" />
            <h1 class="text-2xl font-black tracking-tight text-foreground">
              {{ greeting }}, <span class="bg-gradient-to-r from-primary to-indigo-500 bg-clip-text text-transparent">DevForge</span>
            </h1>
          </div>
          <p class="text-xs font-semibold text-muted-foreground/70 max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-500 fill-mode-both">
            {{ t('welcome.subtitle') }}
          </p>
        </div>
      </div>

      <!-- 快速操作 (居中卡片式) -->
      <div class="grid grid-cols-3 gap-3 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-700 fill-mode-both">
        <button
          v-for="(action, index) in quickActions"
          :key="action.type"
          class="group relative flex flex-col items-center gap-3 overflow-hidden rounded-2xl py-4 px-3 text-center transition-all duration-500 hover:-translate-y-1.5 border border-border/10 bg-background/40 backdrop-blur-xl shadow-lg hover:shadow-xl"
          :class="[action.borderHover]"
          :style="{ transitionDelay: `${index * 80}ms` }"
          @click="handleQuickAction(action.type)"
        >
          <!-- 悬浮扫光 -->
          <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 skew-x-12"></div>
          
          <!-- 图标 -->
          <div class="relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-500 group-hover:scale-110 group-hover:rotate-3 shadow-inner" :class="action.bg">
            <component :is="action.icon" class="relative z-10 h-5 w-5" :class="action.color" />
          </div>

          <div class="relative z-10 flex flex-col gap-0.5">
            <span class="text-xs font-black text-foreground group-hover:text-primary transition-colors">{{ t(`welcome.${action.type === 'file-manager' ? 'files' : action.type}`) }}</span>
            <span class="text-[10px] font-bold text-muted-foreground/75 px-1 leading-snug">{{ t(`welcome.${action.type === 'file-manager' ? 'filesDesc' : action.type + 'Desc'}`) }}</span>
          </div>
        </button>
      </div>

      <!-- 最近连接 + 快捷键 -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-0 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-700 fill-mode-both">
        
        <!-- 最近连接 -->
        <div class="group/panel relative flex flex-col overflow-hidden rounded-2xl border border-border/10 bg-background/40 backdrop-blur-xl p-4 shadow-xl transition-all duration-500 hover:border-primary/20">
          <div class="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover/panel:opacity-100 transition-opacity duration-500"></div>
          
          <div class="relative z-10 mb-3 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
                <Database class="h-3.5 w-3.5" />
              </div>
              <span class="text-[10px] font-black uppercase tracking-widest text-foreground/70">
                {{ t('welcome.recentConnections') }}
              </span>
            </div>
            <button
              class="group/btn flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-all duration-300 hover:scale-105 active:scale-95"
              @click="showConnectionDialog = true"
            >
              <Plus class="h-3 w-3" />
              {{ t('welcome.newConn') }}
            </button>
          </div>
 
          <div v-if="recentConnections.length === 0" class="relative z-10 flex flex-1 flex-col items-center justify-center py-10 text-center">
            <div class="relative mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted/20 ring-1 ring-border">
              <Database class="h-6 w-6 text-muted-foreground/30" />
            </div>
            <p class="text-xs font-bold text-muted-foreground/70">{{ t('welcome.noConnections') }}</p>
          </div>
 
          <div v-else class="relative z-10 flex flex-1 flex-col gap-2 overflow-y-auto pr-1 qr-scroll-area">
            <button
              v-for="(conn, idx) in recentConnections"
              :key="conn.record.id"
              class="group flex items-center gap-4 rounded-2xl border border-transparent bg-background/20 p-2.5 transition-all duration-300 hover:border-primary/20 hover:bg-background/60 hover:shadow-xl hover:-translate-y-0.5"
              @click="openConnection(conn)"
            >
              <!-- Icon with status indicator overflow -->
              <div class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/10 ring-1 ring-border/50 transition-all duration-500 group-hover:bg-primary/10 group-hover:scale-105 group-hover:rotate-3 shadow-inner">
                <component 
                  :is="conn.record.type === 'database' ? Database : (conn.record.type === 'ssh' ? Terminal : FolderOpen)" 
                  class="h-5 w-5 text-muted-foreground/60 transition-colors group-hover:text-primary" 
                />
                <div class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background shadow-sm" :class="statusColorMap[conn.status] ?? 'bg-muted-foreground/40'" />
              </div>
 
              <div class="min-w-0 flex-1 flex flex-col gap-0.5 text-left items-start">
                <p class="truncate text-[13px] font-black tracking-tight text-foreground/90 group-hover:text-foreground">{{ conn.record.name }}</p>
                <div class="flex items-center gap-2">
                  <span class="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-muted/20 text-muted-foreground/70 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                    {{ conn.record.type }}
                  </span>
                  <p class="truncate font-mono text-[10px] font-bold text-muted-foreground/40 group-hover:text-muted-foreground/60">{{ conn.record.host }}</p>
                </div>
              </div>
              
              <div class="flex h-7 w-7 items-center justify-center rounded-full text-primary opacity-0 -translate-x-2 transition-all duration-500 group-hover:bg-primary/10 group-hover:opacity-100 group-hover:translate-x-0">
                <ArrowRight class="h-4 w-4" />
              </div>
            </button>
          </div>
        </div>

        <!-- 快捷键 -->
        <div class="relative flex flex-col rounded-2xl border border-border/10 bg-background/30 backdrop-blur-xl p-4 shadow-xl transition-all duration-500 hover:border-primary/10">
          <div class="relative z-10 mb-4 flex items-center gap-2">
            <div class="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
              <Keyboard class="h-3.5 w-3.5" />
            </div>
            <span class="text-[10px] font-black uppercase tracking-widest text-foreground/70">
                {{ t('welcome.shortcuts') }}
              </span>
          </div>
          
          <div class="relative z-10 flex flex-col gap-0.5">
            <div
              v-for="(shortcut, idx) in shortcuts"
              :key="shortcut.actionKey"
              class="group flex items-center justify-between rounded-lg p-1.5 transition-all hover:bg-background/60"
            >
              <span class="text-[11px] font-bold text-muted-foreground/70 group-hover:text-foreground">{{ t(shortcut.actionKey) }}</span>
              <div class="flex items-center gap-1">
                <kbd
                  v-for="key in shortcut.keys"
                  :key="key"
                  class="flex min-w-[24px] items-center justify-center rounded-md border border-border/40 bg-background/60 px-1.5 py-0.5 text-[9px] font-black text-foreground/60 shadow-sm transition-all duration-300 group-hover:border-primary/50 group-hover:text-primary"
                >
                  {{ key }}
                </kbd>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 版本号 -->
      <div class="flex justify-center relative z-10 animate-in fade-in duration-1000 delay-[1000ms] fill-mode-both">
        <div class="flex items-center gap-2 rounded-full border border-border/20 bg-background/30 px-4 py-1 backdrop-blur-lg transition-all hover:border-border/40">
          <div class="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]"></div>
          <span class="text-[10px] font-bold text-muted-foreground/70 tracking-[0.12em] uppercase font-mono">DevForge <span class="text-primary font-black">v{{ appVersion }}</span></span>
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

