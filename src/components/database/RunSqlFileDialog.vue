<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { parseBackendError } from '@/types/error'
import { useI18n } from 'vue-i18n'
import * as dbApi from '@/api/database'
import type { SqlFileProgress } from '@/api/database'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  CheckCircle2, XCircle, Loader2, Play, Database, FileText,
  Check, FolderOpen, Zap, ShieldCheck, Timer, ArrowRight, Copy
} from 'lucide-vue-next'
import { open as openFileDialog } from '@tauri-apps/plugin-dialog'

const props = defineProps<{
  connectionId: string
  database?: string
  filePath?: string
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [val: boolean]
  'success': []
}>()

const { t } = useI18n()

const isExecuting = ref(false)
const isPaused = ref(false)

// [DEBUG] 监控 isPaused 变化，追踪是谁触发的
watch(isPaused, (newVal, oldVal) => {
  if (newVal && !oldVal) {
    console.trace(`[DEBUG] isPaused changed: ${oldVal} → ${newVal}`)
  }
})
const isCancelling = ref(false)
const importId = ref('')
const progressData = ref<SqlFileProgress | null>(null)
const errorLog = ref<string[]>([])
const startTime = ref<number | null>(null)
const elapsedTime = ref('0.0')
const selectedFilePath = ref(props.filePath || '')

watch(() => props.filePath, (newPath) => {
  if (newPath) selectedFilePath.value = newPath
})

watch(selectedFilePath, () => {
  if (!isExecuting.value) {
    progressData.value = null
    errorLog.value = []
    progressPercent.value = 0
    startTime.value = null
    elapsedTime.value = '0.0'
  }
})

const progressPercent = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

// 节流：避免高频进度回调阻塞主线程导致计时器卡顿
let pendingProgress: SqlFileProgress | null = null
let progressRafId: number | null = null

const importOptions = ref({
  continueOnError: true,
  multipleQueries: true,
  disableAutoCommit: true
})

const copyStates = ref<Record<string, boolean>>({})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  if (progressRafId) { cancelAnimationFrame(progressRafId); progressRafId = null }
})

watch(() => props.open, (val) => {
  if (val) {
    isExecuting.value = false
    isPaused.value = false
    isCancelling.value = false
    progressData.value = null
    errorLog.value = []
    progressPercent.value = 0
    startTime.value = null
    elapsedTime.value = '0.0'
    pendingProgress = null
    if (progressRafId) { cancelAnimationFrame(progressRafId); progressRafId = null }
    selectedFilePath.value = props.filePath || ''
    importOptions.value = {
      continueOnError: true,
      multipleQueries: true,
      disableAutoCommit: true
    }
  }
})

async function handleStart() {
  if (!selectedFilePath.value) return
  
  isExecuting.value = true
  isPaused.value = false
  isCancelling.value = false
  importId.value = `import_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  progressData.value = null
  errorLog.value = []
  progressPercent.value = 0
  startTime.value = Date.now()
  
  timer = setInterval(() => {
    if (startTime.value && !isPaused.value) {
      elapsedTime.value = ((Date.now() - startTime.value) / 1000).toFixed(1)
    }
  }, 100)
  
  try {
    await dbApi.dbRunSqlFileStream(
      props.connectionId,
      importId.value,
      selectedFilePath.value,
      {
        continueOnError: importOptions.value.continueOnError,
        multipleQueries: importOptions.value.multipleQueries,
        disableAutoCommit: importOptions.value.disableAutoCommit
      },
      (progress) => {
        // 收集错误日志（无论暂停与否）
        if (progress.error) {
          errorLog.value.push(`[${new Date().toLocaleTimeString()}] ${progress.error}`)
        }
        // 完成信号必须立即处理，不走节流
        if (progress.isFinished) {
          if (progressRafId) { cancelAnimationFrame(progressRafId); progressRafId = null }
          pendingProgress = null
          progressData.value = progress
          if (progress.totalStatements > 0) {
            progressPercent.value = Math.min(100, Math.floor((progress.executed / progress.totalStatements) * 100))
          }
          isExecuting.value = false
          isPaused.value = false
          isCancelling.value = false
          if (timer) { clearInterval(timer); timer = null }
          return
        }
        // 暂停期间只处理错误，冻结进度数字
        if (isPaused.value) {
          return
        }
        // 用 requestAnimationFrame 节流，避免高频回调阻塞主线程
        pendingProgress = progress
        if (!progressRafId) {
          progressRafId = requestAnimationFrame(() => {
            progressRafId = null
            if (pendingProgress) {
              progressData.value = pendingProgress
              if (pendingProgress.totalStatements > 0) {
                progressPercent.value = Math.min(100, Math.floor((pendingProgress.executed / pendingProgress.totalStatements) * 100))
              } else {
                progressPercent.value = 100
              }
              pendingProgress = null
            }
          })
        }
      },
      props.database
    )
    // 后端流结束，确保状态清理（可能已在 progress callback 的 isFinished 中处理）
    isExecuting.value = false
    isPaused.value = false
    if (timer) { clearInterval(timer); timer = null }
    if (progressRafId) { cancelAnimationFrame(progressRafId); progressRafId = null }
    const finalProgress = progressData.value as SqlFileProgress | null
    if (finalProgress && finalProgress.fail === 0 && finalProgress.isFinished) {
       emit('success')
    }
  } catch (e: unknown) {
    isExecuting.value = false
    isPaused.value = false
    if (timer) { clearInterval(timer); timer = null }
    if (progressRafId) { cancelAnimationFrame(progressRafId); progressRafId = null }
    errorLog.value.push(`[Fatal] ${parseBackendError(e).message}`)
    // 确保切换到进度视图以展示错误信息
    if (!progressData.value) {
      progressData.value = {
        totalStatements: 0,
        executed: 0,
        success: 0,
        fail: 1,
        currentSql: '',
        isFinished: true,
        error: String(e),
      }
    }
  }
}

async function handlePause() {
  isPaused.value = true
  await dbApi.dbPauseSqlImport(importId.value)
}

async function handleResume() {
  isPaused.value = false
  await dbApi.dbResumeSqlImport(importId.value)
}

async function handleCancel() {
  if (isExecuting.value) {
    isCancelling.value = true
    await dbApi.dbCancelSqlImport(importId.value)
    // 不立即关闭对话框，等待后端发送 isFinished 进度回调
    return
  }
  emit('update:open', false)
}

function formatNumber(num: number) {
  return new Intl.NumberFormat().format(num)
}

function handleCopyLog(id: string, event: MouseEvent, text?: string) {
  event.stopPropagation()
  event.preventDefault()

  const content = text || errorLog.value.join('\n')

  // 关键：在 Dialog 内部创建 textarea 做复制，避免焦点逃出 FocusScope
  // 如果 textarea 放到 document.body，select() 会让焦点移到 Dialog 外，
  // 触发 reka-ui FocusScope 的焦点回退，导致暂停按钮被意外激活
  const target = event.currentTarget as HTMLElement
  const container = target.closest('[data-slot="dialog-content"]') || target.parentElement!

  try {
    const textarea = document.createElement('textarea')
    textarea.value = content
    textarea.style.cssText = 'position:absolute;left:-9999px;top:-9999px;opacity:0;pointer-events:none'
    container.appendChild(textarea)
    textarea.focus({ preventScroll: true })
    textarea.select()
    document.execCommand('copy')
    container.removeChild(textarea)
    // 把焦点还给触发按钮，确保 FocusScope 不乱跳
    target.focus({ preventScroll: true })

    copyStates.value[id] = true
    setTimeout(() => {
      copyStates.value[id] = false
    }, 2000)
  } catch (err) {
    console.error('Failed to copy log:', err)
  }
}

async function handleSelectFile() {
  try {
    const selected = await openFileDialog({
      title: t('dataImport.selectFile'),
      filters: [{ name: 'SQL', extensions: ['sql', 'txt'] }],
      multiple: false,
    })
    if (selected) {
      selectedFilePath.value = selected
    }
  } catch (e) {
    console.error('Failed to select file:', e)
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(val) => !isExecuting && emit('update:open', val)">
    <DialogContent class="sm:max-w-[720px] p-0 overflow-hidden border border-white/10 bg-background/95 backdrop-blur-xl shadow-[0_32px_64px_-16px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.05)] rounded-2xl transition-[opacity,transform] duration-700 ease-in-out">
      <!-- 3D Layered Header with Metallic Gradient -->
      <div class="px-8 pt-8 pb-7 border-b border-white/5 bg-gradient-to-b from-muted/30 to-muted/5 industrial-grid text-muted-foreground/5 noise-texture relative overflow-hidden">
        <!-- Technical Crosshair Decoration -->
        <div class="absolute top-4 right-12 flex gap-1.5 opacity-20 pointer-events-none select-none">
          <div class="w-2 h-[1px] bg-foreground"></div>
          <div class="w-[1px] h-2 bg-foreground -mt-[3px]"></div>
          <div class="text-[8px] font-mono tracking-tighter text-foreground ml-1">ST-64/RUN</div>
        </div>

        <div class="relative z-20 flex items-center justify-between mb-8">
          <div class="flex items-center gap-4">
            <div class="h-11 w-11 rounded-xl bg-primary/5 border border-primary/20 flex items-center justify-center text-primary shadow-[0_0_15px_rgba(var(--primary),0.1)] transition-transform duration-700 hover:rotate-6">
              <Database class="w-5.5 h-5.5" />
            </div>
            <div>
              <div class="flex items-center gap-2.5">
                <h2 class="text-[13px] font-black uppercase tracking-[0.15em] text-foreground/90">{{ t('sqlImport.title') }}</h2>
                <div class="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-primary/20 bg-primary/5 text-[8px] font-bold text-primary/80 tracking-tighter uppercase backdrop-blur-sm">
                  <div class="w-1 h-1 rounded-full bg-primary animate-pulse"></div>
                  CORE_ENGINE
                </div>
              </div>
              <p class="text-[10px] font-medium text-muted-foreground/70 mt-1.5 tracking-tight">{{ t('sqlImport.subtitle') }}</p>
            </div>
          </div>
          <div v-if="database" class="px-3 py-1.5 rounded-lg bg-foreground/5 text-foreground/80 text-[9px] font-black uppercase tracking-[0.2em] border border-white/10 shadow-inner group transition-[background-color,border-color,color] duration-500 hover:bg-primary/5 hover:border-primary/20 hover:text-primary">
            <span class="opacity-40 mr-1.5">DB:</span>{{ database }}
          </div>
        </div>

        <!-- Integrated Resource Module ("Plug-in" look) -->
        <div 
          class="relative z-20 group rounded-xl border border-white/5 bg-background p-2 flex items-center gap-3 transition-[border-color,box-shadow] duration-700 shadow-[inset_0_2px_4px_rgba(0,0,0,0.05),0_4px_12px_rgba(0,0,0,0.1)]"
          :class="selectedFilePath ? 'border-primary/30 ring-4 ring-primary/5' : 'hover:border-primary/20'"
        >
          <div class="pl-3 flex items-center gap-2.5 text-muted-foreground shrink-0 border-r border-white/5 pr-3 mr-1">
             <FileText class="w-4 h-4 transition-colors duration-500 group-hover:text-primary" />
          </div>
          <div class="flex-1 min-w-0 font-mono text-[11px] overflow-hidden">
             <span v-if="selectedFilePath" class="text-foreground/90 font-bold truncate block tracking-tight">{{ selectedFilePath }}</span>
             <span v-else class="text-muted-foreground/60 font-medium italic block tracking-tighter">{{ t('sqlImport.filePlaceholder') }}</span>
          </div>
          <Button 
            v-if="!isExecuting" 
            variant="default" 
            size="sm" 
            class="h-8 px-4 rounded-lg font-bold text-[10px] uppercase tracking-widest bg-foreground text-background hover:bg-foreground/90 transition-colors duration-500 shadow-md relative overflow-hidden group/btn"
            @click="handleSelectFile"
          >
            <FolderOpen class="w-3.5 h-3.5 mr-2 transition-transform duration-500 group-hover/btn:scale-110" />
            {{ t('sqlImport.selectFile') }}
          </Button>
          <div v-else class="h-8 px-4 flex items-center gap-2.5 text-[9px] font-black uppercase tracking-widest text-primary bg-primary/5 rounded-lg border border-primary/10">
            <Loader2 class="w-3.5 h-3.5 animate-spin" />
            {{ t('sqlImport.fileLocked') }}
          </div>
        </div>
      </div>

      <div class="px-10 py-4 relative overflow-hidden">
        <!-- Sub-surface decorative line -->
        <div class="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-white/5 to-transparent"></div>

        <!-- Dashboard / Options View -->
        <div v-if="!isExecuting && !progressData" class="space-y-7 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
          
          <div class="space-y-5">
             <div class="flex items-center gap-4 px-1">
                <div class="flex gap-1 items-center">
                  <div class="w-1.5 h-1.5 rounded-full bg-primary" />
                  <div class="w-3 h-[1px] bg-primary/40" />
                </div>
                <h4 class="text-[10px] font-black text-foreground/40 uppercase tracking-[0.25em]">{{ t('sqlImport.accelerationMatrix') }}</h4>
             </div>

             <div class="grid grid-cols-1 sm:grid-cols-3 gap-5">
                <!-- Card Option 1 -->
                <div 
                  class="relative group cursor-pointer"
                  @click="importOptions.continueOnError = !importOptions.continueOnError"
                >
                  <div 
                    class="h-full rounded-2xl border border-white/5 p-6 flex flex-col items-center text-center gap-5 transition-[border-color,box-shadow,scale,opacity] duration-700 bg-gradient-to-br from-background to-muted/5 relative overflow-hidden"
                    :class="importOptions.continueOnError 
                      ? 'border-primary/40 shadow-[0_20px_40px_-12px_rgba(var(--primary),0.15)] ring-1 ring-primary/20 scale-[1.02]' 
                      : 'hover:border-white/10 opacity-60 hover:opacity-90'"
                  >
                    <!-- Background Gloss Overlay -->
                    <div class="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.02] to-transparent pointer-events-none"></div>

                    <div 
                      class="h-14 w-14 rounded-2xl flex items-center justify-center transition-[background-color,color,border-color,box-shadow] duration-700 border"
                      :class="importOptions.continueOnError 
                        ? 'bg-primary text-primary-foreground border-primary shadow-[0_8px_16px_rgba(var(--primary),0.2)]' 
                        : 'bg-muted/30 text-muted-foreground/30 border-white/5'"
                    >
                      <ShieldCheck class="w-7 h-7 transition-transform duration-700" :class="importOptions.continueOnError ? 'scale-110' : 'scale-90'" />
                    </div>
                    <div class="space-y-2 relative z-10">
                      <div class="text-[11px] font-black uppercase tracking-widest transition-colors duration-500" :class="importOptions.continueOnError ? 'text-foreground' : 'text-muted-foreground'">
                        {{ t('sqlImport.options.continueOnError') }}
                      </div>
                      <p class="text-[9px] font-medium leading-relaxed px-2 transition-colors duration-500" :class="importOptions.continueOnError ? 'text-muted-foreground/90' : 'text-muted-foreground/40'">
                        {{ t('sqlImport.options.continueOnErrorDesc') }}
                      </p>
                    </div>
                    
                    <!-- Selection Indicator (Sleek Tech Bar) -->
                    <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-1 rounded-t-full transition-[background-color,box-shadow] duration-700"
                      :class="importOptions.continueOnError ? 'bg-primary shadow-[0_0_12px_rgba(var(--primary),0.6)]' : 'bg-transparent'"
                    />
                  </div>
                </div>

                <!-- Card Option 2 -->
                <div 
                  class="relative group cursor-pointer"
                  @click="importOptions.multipleQueries = !importOptions.multipleQueries"
                >
                  <div 
                    class="h-full rounded-2xl border border-white/5 p-6 flex flex-col items-center text-center gap-5 transition-[border-color,box-shadow,scale,opacity] duration-700 bg-gradient-to-br from-background to-muted/5 relative overflow-hidden"
                    :class="importOptions.multipleQueries 
                      ? 'border-primary/40 shadow-[0_20px_40px_-12px_rgba(var(--primary),0.15)] ring-1 ring-primary/20 scale-[1.02]' 
                      : 'hover:border-white/10 opacity-60 hover:opacity-90'"
                  >
                    <div class="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.02] to-transparent pointer-events-none"></div>
                    <div 
                      class="h-14 w-14 rounded-2xl flex items-center justify-center transition-[background-color,color,border-color,box-shadow] duration-700 border"
                      :class="importOptions.multipleQueries 
                        ? 'bg-primary text-primary-foreground border-primary shadow-[0_8px_16px_rgba(var(--primary),0.2)]' 
                        : 'bg-muted/30 text-muted-foreground/30 border-white/5'"
                    >
                      <Zap class="w-7 h-7 transition-transform duration-700" :class="importOptions.multipleQueries ? 'scale-110' : 'scale-90'" />
                    </div>
                    <div class="space-y-2 relative z-10">
                      <div class="text-[11px] font-black uppercase tracking-widest transition-colors duration-500" :class="importOptions.multipleQueries ? 'text-foreground' : 'text-muted-foreground'">
                        {{ t('sqlImport.options.multipleQueries') }}
                      </div>
                      <p class="text-[9px] font-medium leading-relaxed px-2 transition-colors duration-500" :class="importOptions.multipleQueries ? 'text-muted-foreground/90' : 'text-muted-foreground/40'">
                        {{ t('sqlImport.options.multipleQueriesDesc') }}
                      </p>
                    </div>
                    <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-1 rounded-t-full transition-[background-color,box-shadow] duration-700"
                      :class="importOptions.multipleQueries ? 'bg-primary shadow-[0_0_12px_rgba(var(--primary),0.6)]' : 'bg-transparent'"
                    />
                  </div>
                </div>

                <!-- Card Option 3 -->
                <div 
                  class="relative group cursor-pointer"
                  @click="importOptions.disableAutoCommit = !importOptions.disableAutoCommit"
                >
                  <div 
                    class="h-full rounded-2xl border border-white/5 p-6 flex flex-col items-center text-center gap-5 transition-[border-color,box-shadow,scale,opacity] duration-700 bg-gradient-to-br from-background to-muted/5 relative overflow-hidden"
                    :class="importOptions.disableAutoCommit 
                      ? 'border-primary/40 shadow-[0_20px_40px_-12px_rgba(var(--primary),0.15)] ring-1 ring-primary/20 scale-[1.02]' 
                      : 'hover:border-white/10 opacity-60 hover:opacity-90'"
                  >
                    <div class="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.02] to-transparent pointer-events-none"></div>
                    <div 
                      class="h-14 w-14 rounded-2xl flex items-center justify-center transition-[background-color,color,border-color,box-shadow] duration-700 border"
                      :class="importOptions.disableAutoCommit 
                        ? 'bg-primary text-primary-foreground border-primary shadow-[0_8px_16px_rgba(var(--primary),0.2)]' 
                        : 'bg-muted/30 text-muted-foreground/30 border-white/5'"
                    >
                      <Timer class="w-7 h-7 transition-transform duration-700" :class="importOptions.disableAutoCommit ? 'scale-110' : 'scale-90'" />
                    </div>
                    <div class="space-y-2 relative z-10">
                      <div class="text-[11px] font-black uppercase tracking-widest transition-colors duration-500" :class="importOptions.disableAutoCommit ? 'text-foreground' : 'text-muted-foreground'">
                        {{ t('sqlImport.options.disableAutoCommit') }}
                      </div>
                      <p class="text-[9px] font-medium leading-relaxed px-2 transition-colors duration-500" :class="importOptions.disableAutoCommit ? 'text-muted-foreground/90' : 'text-muted-foreground/40'">
                        {{ t('sqlImport.options.disableAutoCommitDesc') }}
                      </p>
                    </div>
                    <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-1 rounded-t-full transition-[background-color,box-shadow] duration-700"
                      :class="importOptions.disableAutoCommit ? 'bg-primary shadow-[0_0_12px_rgba(var(--primary),0.6)]' : 'bg-transparent'"
                    />
                  </div>
                </div>
             </div>
          </div>
        </div>

        <!-- Professional Simplified Progress View -->
        <div v-else class="space-y-6 animate-in fade-in slide-in-from-bottom-6 duration-700 ease-out">
           
           <!-- High-Depth Stats Module -->
           <div class="flex items-center gap-12 px-2 py-4 bg-muted/10 rounded-2xl border border-white/5 shadow-inner relative overflow-hidden">
             <!-- Technical Label Background -->
             <div class="absolute -right-4 -bottom-6 text-[48px] font-black text-white/[0.02] select-none pointer-events-none tracking-tighter">ANALYTICS</div>

            <div class="space-y-1 py-1 pl-6">
                <span class="text-[8px] font-black uppercase tracking-[0.2em] text-muted-foreground/50 block">{{ t('sqlImport.stats.total') }}</span>
                <div class="text-2xl font-black font-mono tracking-tight tabular-nums text-foreground/90">{{ formatNumber(progressData?.totalStatements || 0) }}</div>
             </div>
             
             <div class="w-px h-10 bg-white/5" />
 
             <div class="space-y-1 py-1">
                <span class="text-[8px] font-black uppercase tracking-[0.2em] text-df-success/60 block">{{ t('sqlImport.stats.success') }}</span>
                <div class="text-2xl font-black font-mono tracking-tight tabular-nums text-df-success drop-shadow-[0_0_12px_var(--df-success)]">{{ formatNumber(progressData?.success || 0) }}</div>
             </div>
 
             <div class="w-px h-10 bg-white/5" />
 
             <div class="space-y-1 py-1">
                <span class="text-[8px] font-black uppercase tracking-[0.2em] text-destructive/60 block">{{ t('sqlImport.stats.fail') }}</span>
                <div class="text-2xl font-black font-mono tracking-tight tabular-nums text-destructive drop-shadow-[0_0_12px_rgba(var(--destructive),0.2)]">{{ formatNumber(progressData?.fail || 0) }}</div>
             </div>
             
             <div class="flex-1" />
             
             <div class="mr-6 px-4 py-2.5 rounded-xl bg-background/50 border border-white/5 backdrop-blur-md shadow-lg flex items-center gap-3">
                <Timer class="w-4 h-4 text-primary animate-pulse" />
                <span class="text-[12px] font-mono font-black text-foreground/80 tracking-tight">
                  {{ t('sqlImport.stats.elapsedTime', { time: elapsedTime }) }}
                </span>
             </div>
           </div>

           <!-- Multi-Layered Sleek Progress System -->
           <div class="space-y-4">
             <div class="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/60 px-1">
               <div class="flex items-center gap-3">
                 <span class="text-primary/70">{{ t('sqlImport.progress.streaming') }}</span>
                 <span class="font-mono text-foreground bg-foreground/5 px-2 py-0.5 rounded border border-white/5">{{ progressPercent }}%</span>
               </div>
               <div class="font-mono text-foreground/40 flex items-center gap-2">
                 <span>METRICS:</span>
                 <span class="text-foreground/70">{{ formatNumber(progressData?.executed || 0) }} / {{ formatNumber(progressData?.totalStatements || 0) }}</span>
               </div>
             </div>
             <div class="relative h-2.5 w-full bg-muted/20 rounded-full overflow-hidden border border-white/5 p-[2px] shadow-inner">
                <div 
                  class="h-full bg-gradient-to-r from-primary/80 to-primary rounded-full transition-[width] duration-1000 ease-out shadow-[0_0_15px_rgba(var(--primary),0.3)] relative"
                  :style="{ width: `${progressPercent}%` }"
                >
                  <!-- Moving Shine Effect -->
                  <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[indeterminate_2.5s_infinite] opacity-30"></div>
                </div>
             </div>
           </div>

            <!-- Integrated Log/Stack Terminal -->
            <div class="grid grid-cols-1 gap-4">
               <div 
                 class="rounded-3xl border border-white/5 bg-muted/5 p-4 relative overflow-hidden group shadow-[inset_0_2px_8px_rgba(0,0,0,0.2)] transition-[background-color,box-shadow,border-color] duration-700"
                 :class="errorLog.length > 0 ? 'bg-muted/2 shadow-none border-transparent' : 'bg-muted/5'"
               >
                  <!-- Grid Decoration -->
                  <div class="absolute inset-0 industrial-grid text-white/[0.01] pointer-events-none"></div>
                  
                  <div v-if="errorLog.length === 0" class="text-[8px] font-black uppercase tracking-[0.2em] text-muted-foreground/30 mb-2 flex items-center gap-2 animate-in fade-in duration-700">
                    <div class="w-1.5 h-1.5 rounded-full bg-primary/20" />
                    {{ t('sqlImport.progress.currentStack') }}
                  </div>
                  <div 
                    class="font-mono text-foreground/70 break-all font-medium leading-relaxed relative z-10 transition-[color,opacity] duration-700"
                    :class="errorLog.length > 0 ? 'text-[9px] line-clamp-1 min-h-0 opacity-40 italic mt-0' : 'text-[11px] line-clamp-2 min-h-[2.8em]'"
                  >
                     <span v-if="errorLog.length > 0" class="mr-2 text-primary/30 font-black"># PREVIEW:</span>
                     {{ progressData?.currentSql || t('sqlImport.progress.preparing') }}
                  </div>
               </div>

              <div v-if="errorLog.length > 0" class="rounded-[32px] border border-destructive/20 bg-background/50 overflow-hidden shadow-2xl animate-in fade-in slide-in-from-top-4 duration-500 ease-out">
                <div class="px-6 py-3.5 flex items-center justify-between border-b border-destructive/10 bg-destructive/5 backdrop-blur-md rounded-t-[31px]">
                  <div class="flex items-center gap-3 text-destructive/80">
                    <XCircle class="w-4 h-4" />
                    <span class="text-[10px] font-black uppercase tracking-[0.2em]">{{ t('sqlImport.logs.title') }}</span>
                  </div>
                  <div class="flex items-center gap-3">
                    <span class="text-[9px] font-black font-mono text-white bg-destructive/80 px-2.5 py-1 rounded-full shadow-lg shadow-destructive/20">{{ errorLog.length }} ISSUES</span>
                    <button
                      type="button"
                      class="h-7 w-7 rounded-full flex items-center justify-center transition-colors duration-300 cursor-pointer active:scale-90 outline-none border-none bg-transparent"
                      :class="copyStates['all'] ? 'bg-df-success/10 text-df-success' : 'hover:bg-destructive/10 text-destructive/60 hover:text-destructive'"
                      @mousedown.stop.prevent="handleCopyLog('all', $event)"
                    >
                      <Check v-if="copyStates['all']" class="w-3.5 h-3.5 animate-in zoom-in duration-300" />
                      <Copy v-else class="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <ScrollArea class="h-[180px] bg-muted/5 rounded-b-[31px]">
                   <div class="p-5 font-mono text-[10px] leading-6 text-destructive/90 font-medium select-text">
                      <div v-for="(err, i) in errorLog" :key="i" class="py-3 border-b border-destructive/5 last:border-0 pl-4 pr-12 relative group transition-colors duration-300 hover:bg-destructive/[0.03]">
                        <div class="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-destructive shadow-[0_0_8px_rgba(var(--destructive),0.4)]" />
                        <div class="break-all">{{ err }}</div>
                        <button
                          type="button"
                          class="absolute right-3 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full flex items-center justify-center transition-colors duration-300 cursor-pointer active:scale-90 outline-none border-none bg-transparent"
                          :class="[
                            copyStates[i] ? 'opacity-100 bg-df-success/10 text-df-success' : 'opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-destructive/60 hover:text-destructive'
                          ]"
                          @mousedown.stop.prevent="handleCopyLog(i.toString(), $event, err)"
                        >
                          <Check v-if="copyStates[i]" class="w-3.5 h-3.5 animate-in zoom-in duration-300" />
                          <Copy v-else class="w-3.5 h-3.5" />
                        </button>
                      </div>
                   </div>
                </ScrollArea>
              </div>
           </div>
        </div>
      </div>

      <!-- Industrial Slab Footer -->
      <footer class="h-20 px-10 flex items-center justify-between border-t border-white/5 bg-gradient-to-t from-muted/20 to-transparent industrial-grid text-muted-foreground/[0.02] overflow-hidden relative">
        <div class="flex items-center gap-5 relative z-10">
          <div class="flex items-center gap-3.5 px-4 py-2 rounded-full bg-muted/10 border border-white/10 shadow-[inset_0_1px_2px_rgba(255,255,255,0.05),0_4px_12px_rgba(0,0,0,0.1)] backdrop-blur-md transition-[background-color,border-color,box-shadow] duration-700">
             <div 
               class="h-2.5 w-2.5 rounded-full transition-[background-color,box-shadow] duration-700 relative"
               :class="{
                 'bg-destructive shadow-[0_0_15px_rgba(var(--destructive),0.6)] animate-pulse': isCancelling,
                 'bg-df-success shadow-[0_0_15px_var(--df-success)]': isExecuting && !isPaused && !isCancelling,
                 'bg-df-warning shadow-[0_0_15px_var(--df-warning)] animate-pulse': isPaused && !isCancelling,
                 'bg-white/10': !isExecuting && !progressData?.isFinished && !isCancelling,
                 'bg-primary shadow-[0_0_15px_rgba(var(--primary),0.6)]': !isExecuting && progressData?.isFinished
               }" 
             >
                <!-- Outer Glow Ring -->
                <div v-if="isExecuting || progressData?.isFinished" class="absolute -inset-1 rounded-full border border-current opacity-20 animate-ping duration-[2000ms]"></div>
             </div>
             <span class="text-[10px] font-black uppercase tracking-[0.25em] text-foreground/80 font-mono">
               {{ isCancelling ? t('sqlImport.status.cancelling') : (isPaused ? t('sqlImport.status.paused') : (isExecuting ? t('sqlImport.status.active') : t('sqlImport.status.ready'))) }}
             </span>
          </div>
          <div v-if="!isExecuting && progressData?.isFinished" class="flex items-center gap-2.5 text-primary px-4 py-2 rounded-xl border border-primary/20 bg-primary/5 text-[10px] font-black uppercase tracking-[0.15em] backdrop-blur-sm animate-in fade-in slide-in-from-left-4 duration-700">
             <CheckCircle2 class="w-4 h-4 shadow-[0_0_10px_rgba(var(--primary),0.3)]" />
             {{ t('sqlImport.status.missionSuccess') }}
          </div>
        </div>

        <div class="flex items-center gap-4 relative z-10 shrink-0 ml-auto">
          <Button
            variant="ghost"
            @click="handleCancel"
            :disabled="isCancelling"
            class="h-10 px-6 rounded-xl font-black text-[10px] text-muted-foreground/60 hover:text-foreground hover:bg-white/5 uppercase tracking-[0.2em] transition-colors duration-500"
          >
            <Loader2 v-if="isCancelling" class="w-3.5 h-3.5 mr-2.5 animate-spin" />
            {{ isCancelling ? t('sqlImport.status.cancelling') : ((!isExecuting && progressData?.isFinished) ? t('sqlImport.actions.finish') : t('sqlImport.actions.cancel')) }}
          </Button>
 
          <div class="h-6 w-[1px] bg-white/5 mx-2"></div>
 
          <template v-if="isExecuting && !isCancelling">
            <Button v-if="!isPaused" variant="default" @click="handlePause" class="h-10 rounded-full px-7 font-black text-[10px] bg-df-warning/90 text-white hover:bg-df-warning shadow-[0_8px_20px_-6px_var(--df-warning)] hover:shadow-[0_12px_24px_-6px_var(--df-warning)] transition-[background-color,box-shadow] duration-500 uppercase tracking-[0.2em] group border-transparent">
              <Timer class="w-4 h-4 mr-2.5 transition-transform duration-500 group-hover:rotate-12" /> {{ t('sqlImport.actions.pause') }}
            </Button>
            <Button v-else variant="default" @click="handleResume" class="h-10 rounded-full px-7 font-black text-[10px] bg-df-success hover:bg-df-success/90 shadow-lg shadow-df-success/20 gap-2.5 uppercase tracking-[0.2em] text-white transition-[background-color,box-shadow] duration-500 active:scale-95 group">
              <Play class="w-3.5 h-3.5 fill-current transition-transform duration-500 group-hover:scale-110" /> {{ t('sqlImport.actions.resume') }}
            </Button>
          </template>
 
          <Button
            v-if="!isExecuting && !progressData"
            variant="default"
            class="h-11 rounded-full px-10 font-black text-[11px] bg-primary text-primary-foreground shadow-[0_12px_24px_-8px_rgba(var(--primary),0.4)] transition-[box-shadow,scale] duration-700 hover:shadow-[0_16px_32px_-8px_rgba(var(--primary),0.5)] hover:scale-[1.02] active:scale-95 group uppercase tracking-[0.2em] relative overflow-hidden"
            :disabled="!selectedFilePath"
            @click="handleStart"
          >
            <!-- Sleek Button Glare -->
            <div class="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
            <span class="relative z-10 flex items-center gap-3">
              {{ t('sqlImport.actions.start') }}
              <ArrowRight class="w-4.5 h-4.5 group-hover:translate-x-1.5 transition-transform duration-700" />
            </span>
          </Button>
        </div>
      </footer>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.shadow-soft {
  shadow: 0 4px 12px -2px rgba(0, 0, 0, 0.05);
}
.shadow-glow {
  filter: drop-shadow(0 0 5px rgba(var(--primary), 0.4));
}
</style>
