<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLogStore, type LogLevel, type LogSource } from '@/stores/log'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Trash2,
  Download,
  Terminal,
  Database,
  Files as FilesIcon,
  Monitor,
  Search,
  ChevronRight,
  ChevronDown,
  ArrowDown
} from 'lucide-vue-next'

const { t } = useI18n()
const logStore = useLogStore()

// 状态控制
const filterLevel = ref<LogLevel | 'ALL'>('ALL')
const filterSource = ref<LogSource | 'ALL'>('ALL')
const searchText = ref('')
const isFollowMode = ref(true)

// 过滤后的日志
const filteredLogs = computed(() => {
  return logStore.logs.filter(log => {
    const levelMatch = filterLevel.value === 'ALL' || log.level === filterLevel.value
    const sourceMatch = filterSource.value === 'ALL' || log.source === filterSource.value
    const textMatch = !searchText.value || 
      log.message.toLowerCase().includes(searchText.value.toLowerCase()) ||
      (typeof log.details === 'string' && log.details.toLowerCase().includes(searchText.value.toLowerCase()))
    
    return levelMatch && sourceMatch && textMatch
  })
})

// 详情展开控制
const expandedIds = ref(new Set<string>())
function toggleExpand(id: string) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  expandedIds.value = next
}

// 自动滚动逻辑
const handleScroll = (e: Event) => {
  const target = e.target as HTMLElement
  if (!target) return
  // 如果向上滚动，取消追随
  const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 10
  if (!isAtBottom) {
    isFollowMode.value = false
  } else {
    isFollowMode.value = true
  }
}

watch(() => logStore.logs.length, () => {
  if (isFollowMode.value) {
    nextTick(() => {
      const el = document.querySelector('.log-scroll-area [data-radix-scroll-area-viewport]')
      if (el) el.scrollTop = el.scrollHeight
    })
  }
})

function formatTime(ts: number) {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' + d.getMilliseconds().toString().padStart(3, '0')
}

function getLevelClass(level: LogLevel) {
  switch (level) {
    case 'DEBUG': return 'text-muted-foreground/30'
    case 'INFO': return 'text-primary/70'
    case 'WARN': return 'text-df-warning/70'
    case 'ERROR': return 'text-destructive/80'
  }
}

function getSourceIcon(source: LogSource) {
  switch (source) {
    case 'SSH': return Terminal
    case 'SFTP': return FilesIcon
    case 'DATABASE': return Database
    case 'SYSTEM': return Monitor
  }
}

function handleDownload() {
  const content = logStore.logs.map(log => 
    `[${new Date(log.timestamp).toISOString()}] [${log.level}] [${log.source}] ${log.message}`
  ).join('\n')
  
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `devforge-logs-${Date.now()}.log`
  a.click()
  URL.revokeObjectURL(url)
}

function clearAll() {
  logStore.clearLogs()
}
</script>

<template>
  <div class="flex h-full flex-col bg-background">
    <!-- Toolbar (Masterpiece Style) -->
    <div class="flex h-8 shrink-0 items-center justify-between border-b border-border/10 px-4 bg-muted/5 select-none">
      <div class="flex items-center gap-4">
        <!-- Level Filters -->
        <div class="flex items-center gap-1.5 p-0.5 rounded-lg bg-muted/20 border border-border/20">
          <button 
            v-for="lv in (['ALL', 'DEBUG', 'INFO', 'WARN', 'ERROR'] as const)" 
            :key="lv"
            class="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-tight transition-[background-color,color,box-shadow] active:scale-95 outline-none focus-visible:ring-1 focus-visible:ring-ring"
            :class="[
              filterLevel === lv 
                ? 'bg-background text-primary shadow-sm' 
                : 'text-muted-foreground/40 hover:text-muted-foreground/70'
            ]"
            @click="filterLevel = lv"
          >
            {{ lv === 'ALL' ? t('log.all') : lv }}
          </button>
        </div>

        <div class="h-3 w-px bg-border/20"></div>

        <!-- Search -->
        <div class="relative group">
          <Search class="absolute left-2 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-muted-foreground/20 group-focus-within:text-primary transition-colors" />
          <input 
            v-model="searchText"
            :placeholder="t('log.filter')"
            class="h-6 w-32 border-none bg-transparent pl-6 text-[9px] font-black tracking-widest text-foreground focus:ring-0 placeholder:text-muted-foreground/20 uppercase"
          />
        </div>
      </div>

      <div class="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          :aria-label="t('log.followMode')"
          class="h-6 w-6 rounded-lg text-muted-foreground/30 hover:text-primary transition-[color,background-color] active:scale-90 outline-none focus-visible:ring-1 focus-visible:ring-ring"
          :class="{ 'text-primary bg-primary/5': isFollowMode }"
          @click="isFollowMode = !isFollowMode"
        >
          <ArrowDown class="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          :aria-label="t('log.download')"
          class="h-6 w-6 rounded-lg text-muted-foreground/30 hover:text-primary transition-[color,background-color] active:scale-90 outline-none focus-visible:ring-1 focus-visible:ring-ring"
          @click="handleDownload"
        >
          <Download class="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          :aria-label="t('log.clear')"
          class="h-6 w-6 rounded-lg text-muted-foreground/30 hover:text-destructive transition-[color,background-color] active:scale-90 outline-none focus-visible:ring-1 focus-visible:ring-ring"
          @click="clearAll"
        >
          <Trash2 class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>

    <!-- Log List -->
    <ScrollArea class="flex-1 min-h-0 log-scroll-area" @scroll.capture="handleScroll">
      <div class="p-4 pt-2 space-y-px font-mono selection:bg-primary/20">
        <div v-if="filteredLogs.length === 0" class="flex flex-col items-center justify-center py-20 text-center opacity-20">
          <Terminal class="h-8 w-8 mb-2 stroke-[1]" />
          <p class="text-[10px] font-black uppercase tracking-widest">{{ t('log.noLog') }}</p>
        </div>

        <div 
          v-for="log in filteredLogs" 
          :key="log.id"
          class="group flex flex-col rounded-sm hover:bg-muted/30 transition-colors"
        >
          <div
            class="flex items-center gap-3 py-0.5 px-2 rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            :class="log.details ? 'cursor-pointer' : ''"
            :tabindex="log.details ? 0 : -1"
            :role="log.details ? 'button' : undefined"
            :aria-expanded="log.details ? expandedIds.has(log.id) : undefined"
            @click="log.details && toggleExpand(log.id)"
            @keydown.enter="log.details && toggleExpand(log.id)"
            @keydown.space.prevent="log.details && toggleExpand(log.id)"
          >
            <!-- Timestamp -->
            <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground/30 font-bold w-20 leading-none">
              {{ formatTime(log.timestamp) }}
            </span>
            
            <!-- Source Icon -->
            <component 
              :is="getSourceIcon(log.source)" 
              class="h-2.5 w-2.5 shrink-0" 
              :class="getLevelClass(log.level)"
            />

            <!-- Message -->
            <span 
              class="flex-1 text-[11px] leading-tight break-all font-medium transition-colors"
              :class="[
                log.level === 'ERROR' ? 'text-destructive/90' : 'text-foreground/85',
                expandedIds.has(log.id) ? 'text-primary/90' : ''
              ]"
            >
              {{ log.message }}
            </span>

            <!-- Actions/Expand -->
            <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
               <span v-if="log.level !== 'INFO' && log.level !== 'DEBUG'" class="text-[8px] font-black px-1 rounded bg-muted/60 text-muted-foreground/60 leading-tight">
                 {{ log.level }}
               </span>
               <component 
                 v-if="log.details"
                 :is="expandedIds.has(log.id) ? ChevronDown : ChevronRight" 
                 class="h-3 w-3 text-muted-foreground/30"
               />
            </div>
          </div>

          <!-- Detail Drawer (Expand) -->
          <div v-if="expandedIds.has(log.id)" class="px-25 ml-24 mr-2 mb-2 p-3 rounded-lg bg-muted/20 border border-border/10 animate-in fade-in slide-in-from-top-1 duration-200">
             <pre class="text-[10px] text-muted-foreground/70 overflow-x-auto custom-scrollbar leading-relaxed whitespace-pre-wrap">
               {{ typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2) }}
             </pre>
          </div>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>

<style scoped>
.log-scroll-area :deep([data-radix-scroll-area-viewport]) {
  scroll-behavior: auto !important;
}
</style>
