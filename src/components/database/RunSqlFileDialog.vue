<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import * as dbApi from '@/api/database'
import type { SqlFileProgress } from '@/api/database'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import Progress from '@/components/ui/progress.vue'
import { ScrollArea } from '@/components/ui/scroll-area'
import { 
  CheckCircle2, XCircle, AlertCircle, Loader2, Play, Database, FileText, 
  FileDown, Check, Settings2, FolderOpen, Zap, ShieldCheck, Timer, ArrowRight 
} from 'lucide-vue-next'
import { Label } from '@/components/ui/label'
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

const progressPercent = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

const importOptions = ref({
  continueOnError: true,
  multipleQueries: true,
  disableAutoCommit: true
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
        // 暂停期间只处理完成信号和错误，冻结进度数字
        if (isPaused.value && !progress.isFinished) {
          return
        }
        progressData.value = progress
        if (progress.totalStatements > 0) {
          progressPercent.value = Math.min(100, Math.floor((progress.executed / progress.totalStatements) * 100))
        } else {
          progressPercent.value = 100
        }
        // 取消完成后，后端发送 isFinished=true，更新前端状态
        if (progress.isFinished) {
          isExecuting.value = false
          isPaused.value = false
          isCancelling.value = false
          if (timer) { clearInterval(timer); timer = null }
        }
      },
      props.database
    )
    // 后端流结束，确保状态清理（可能已在 progress callback 的 isFinished 中处理）
    isExecuting.value = false
    isPaused.value = false
    if (timer) { clearInterval(timer); timer = null }
    if (progressData.value && progressData.value.fail === 0 && progressData.value.isFinished) {
       emit('success')
    }
  } catch (e: any) {
    isExecuting.value = false
    isPaused.value = false
    if (timer) { clearInterval(timer); timer = null }
    errorLog.value.push(`[Fatal] ${String(e)}`)
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

async function handleSelectFile() {
  try {
    const selected = await openFileDialog({
      title: t('dataImport.selectFile'),
      filters: [{ name: 'SQL', extensions: ['sql', 'txt'] }],
      multiple: false,
    })
    if (selected) {
      selectedFilePath.value = typeof selected === 'string' ? selected : selected.path
    }
  } catch (e) {
    console.error('Failed to select file:', e)
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(val) => !isExecuting && emit('update:open', val)">
    <DialogContent class="sm:max-w-[720px] p-0 overflow-hidden border-border/40 shadow-2xl bg-background backdrop-blur-md transition-all duration-500 rounded-[24px]">
      <!-- High Contrast Refined Header -->
      <div class="px-8 pt-8 pb-6 border-b border-border/60 bg-muted/20">
        <div class="flex items-center justify-between mb-6">
          <div class="flex items-center gap-3.5">
            <div class="h-10 w-10 rounded-xl bg-primary/20 border-2 border-primary/40 flex items-center justify-center text-primary shadow-sm">
              <FileDown class="w-5 h-5" />
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-lg font-bold tracking-tight text-foreground">{{ t('sqlImport.title') }}</h2>
                <span v-if="database" class="px-2.5 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-black uppercase tracking-wider border border-primary/40 shadow-sm">
                  {{ database }}
                </span>
              </div>
              <p class="text-[11px] text-foreground/80 font-black uppercase tracking-widest mt-1.5">{{ t('sqlImport.subtitle') }}</p>
            </div>
          </div>
        </div>

        <!-- High-Vis Integrated Resource Bar -->
        <div 
          class="group rounded-xl border-2 bg-background p-1.5 flex items-center gap-3 transition-all duration-300 shadow-sm"
          :class="selectedFilePath ? 'border-primary/60 ring-2 ring-primary/5' : 'border-border hover:border-primary/40'"
        >
          <div class="pl-3 flex items-center gap-2 text-foreground/60 shrink-0">
             <FileText class="w-4 h-4" />
          </div>
          <div class="flex-1 min-w-0 font-mono text-[11px] overflow-hidden">
             <span v-if="selectedFilePath" class="text-foreground font-black truncate block">{{ selectedFilePath }}</span>
             <span v-else class="text-foreground/40 font-bold italic block">{{ t('sqlImport.filePlaceholder') }}</span>
          </div>
          <Button 
            v-if="!isExecuting" 
            variant="secondary" 
            size="sm" 
            class="h-9 px-5 rounded-lg font-black text-[11px] bg-muted/50 border border-border hover:border-primary hover:bg-primary/5 transition-all shadow-sm active:scale-95 group/btn"
            @click="handleSelectFile"
          >
            <FolderOpen class="w-4 h-4 mr-2 text-primary group-hover/btn:scale-110 transition-transform" />
            {{ t('sqlImport.selectFile') }}
          </Button>
          <div v-else class="h-9 px-5 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-primary">
            <Loader2 class="w-4 h-4 animate-spin" />
            {{ t('sqlImport.fileLocked') }}
          </div>
        </div>
      </div>

      <div class="px-8 py-8">
        <!-- Dashboard / Options View -->
        <div v-if="!isExecuting && !progressData" class="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
          
          <div class="space-y-4">
             <div class="flex items-center gap-3 px-1">
                <div class="w-1.5 h-4 bg-primary rounded-full shadow-[0_0_12px_rgba(var(--primary),0.6)]" />
                <h4 class="text-xs font-black text-foreground uppercase tracking-[0.2em]">{{ t('sqlImport.accelerationMatrix') }}</h4>
             </div>

             <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <!-- Card Option 1: Continue on Error -->
                <div 
                  class="relative group cursor-pointer transition-all duration-300"
                  @click="importOptions.continueOnError = !importOptions.continueOnError"
                >
                  <div 
                    class="h-full rounded-2xl border-2 p-5 flex flex-col items-center text-center gap-4 transition-all duration-500 bg-background"
                    :class="importOptions.continueOnError 
                      ? 'border-primary ring-4 ring-primary/5 shadow-2xl shadow-primary/20' 
                      : 'border-border hover:border-primary/40 opacity-60 hover:opacity-100'"
                  >
                    <div 
                      class="h-14 w-14 rounded-2xl flex items-center justify-center transition-all duration-500"
                      :class="importOptions.continueOnError ? 'bg-primary text-white shadow-lg shadow-primary/40' : 'bg-muted text-foreground/40'"
                    >
                      <ShieldCheck class="w-7 h-7" />
                    </div>
                    <div class="space-y-2">
                      <div class="text-sm font-black tracking-tight" :class="importOptions.continueOnError ? 'text-foreground' : 'text-foreground/60'">
                        {{ t('sqlImport.options.continueOnError') }}
                      </div>
                      <p class="text-[10px] font-bold leading-relaxed" :class="importOptions.continueOnError ? 'text-foreground/70' : 'text-foreground/40'">
                        {{ t('sqlImport.options.continueOnErrorDesc') }}
                      </p>
                    </div>
                    <!-- Indicator Dot -->
                    <div class="absolute top-4 right-4 h-2 w-2 rounded-full transition-all duration-500"
                      :class="importOptions.continueOnError ? 'bg-primary shadow-[0_0_8px_rgba(var(--primary),0.8)]' : 'bg-border'"
                    />
                  </div>
                </div>

                <!-- Card Option 2: Multiple Queries -->
                <div 
                  class="relative group cursor-pointer transition-all duration-300"
                  @click="importOptions.multipleQueries = !importOptions.multipleQueries"
                >
                  <div 
                    class="h-full rounded-2xl border-2 p-5 flex flex-col items-center text-center gap-4 transition-all duration-500 bg-background"
                    :class="importOptions.multipleQueries 
                      ? 'border-primary ring-4 ring-primary/5 shadow-2xl shadow-primary/20' 
                      : 'border-border hover:border-primary/40 opacity-60 hover:opacity-100'"
                  >
                    <div 
                      class="h-14 w-14 rounded-2xl flex items-center justify-center transition-all duration-500"
                      :class="importOptions.multipleQueries ? 'bg-primary text-white shadow-lg shadow-primary/40' : 'bg-muted text-foreground/40'"
                    >
                      <Zap class="w-7 h-7" />
                    </div>
                    <div class="space-y-2">
                      <div class="text-sm font-black tracking-tight" :class="importOptions.multipleQueries ? 'text-foreground' : 'text-foreground/60'">
                        {{ t('sqlImport.options.multipleQueries') }}
                      </div>
                      <p class="text-[10px] font-bold leading-relaxed" :class="importOptions.multipleQueries ? 'text-foreground/70' : 'text-foreground/40'">
                        {{ t('sqlImport.options.multipleQueriesDesc') }}
                      </p>
                    </div>
                    <div class="absolute top-4 right-4 h-2 w-2 rounded-full transition-all duration-500"
                      :class="importOptions.multipleQueries ? 'bg-primary shadow-[0_0_8px_rgba(var(--primary),0.8)]' : 'bg-border'"
                    />
                  </div>
                </div>

                <!-- Card Option 3: Disable Auto Commit -->
                <div 
                  class="relative group cursor-pointer transition-all duration-300"
                  @click="importOptions.disableAutoCommit = !importOptions.disableAutoCommit"
                >
                  <div 
                    class="h-full rounded-2xl border-2 p-5 flex flex-col items-center text-center gap-4 transition-all duration-500 bg-background"
                    :class="importOptions.disableAutoCommit 
                      ? 'border-primary ring-4 ring-primary/5 shadow-2xl shadow-primary/20' 
                      : 'border-border hover:border-primary/40 opacity-60 hover:opacity-100'"
                  >
                    <div 
                      class="h-14 w-14 rounded-2xl flex items-center justify-center transition-all duration-500"
                      :class="importOptions.disableAutoCommit ? 'bg-primary text-white shadow-lg shadow-primary/40' : 'bg-muted text-foreground/40'"
                    >
                      <Timer class="w-7 h-7" />
                    </div>
                    <div class="space-y-2">
                      <div class="text-sm font-black tracking-tight" :class="importOptions.disableAutoCommit ? 'text-foreground' : 'text-foreground/60'">
                        {{ t('sqlImport.options.disableAutoCommit') }}
                      </div>
                      <p class="text-[10px] font-bold leading-relaxed" :class="importOptions.disableAutoCommit ? 'text-foreground/70' : 'text-foreground/40'">
                        {{ t('sqlImport.options.disableAutoCommitDesc') }}
                      </p>
                    </div>
                    <div class="absolute top-4 right-4 h-2 w-2 rounded-full transition-all duration-500"
                      :class="importOptions.disableAutoCommit ? 'bg-primary shadow-[0_0_8px_rgba(var(--primary),0.8)]' : 'bg-border'"
                    />
                  </div>
                </div>
             </div>
          </div>
        </div>

        <!-- Professional Simplified Progress View -->
        <div v-else class="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
           
           <!-- High-Contrast Stats Display -->
           <div class="flex items-center gap-12 px-2">
             <div class="space-y-1">
                <span class="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/60 block">{{ t('sqlImport.stats.total') }}</span>
                <div class="text-3xl font-black font-mono tracking-tight tabular-nums">{{ formatNumber(progressData?.totalStatements || 0) }}</div>
             </div>
             
             <div class="w-px h-10 bg-border/80" />

             <div class="space-y-1">
                <span class="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600 block">{{ t('sqlImport.stats.success') }}</span>
                <div class="text-3xl font-black font-mono tracking-tight tabular-nums text-emerald-600 shadow-emerald-500/10">{{ formatNumber(progressData?.success || 0) }}</div>
             </div>

             <div class="w-px h-10 bg-border/80" />

             <div class="space-y-1">
                <span class="text-[10px] font-black uppercase tracking-[0.2em] text-destructive block">{{ t('sqlImport.stats.fail') }}</span>
                <div class="text-3xl font-black font-mono tracking-tight tabular-nums text-destructive shadow-destructive/10">{{ formatNumber(progressData?.fail || 0) }}</div>
             </div>
             
             <div class="flex-1" />
             
             <div class="px-3 py-2 rounded-lg bg-background border-2 border-border shadow-sm flex items-center gap-2">
                <Timer class="w-4 h-4 text-primary" />
                <span class="text-[12px] font-mono font-black text-foreground">{{ t('sqlImport.stats.elapsedTime', { time: elapsedTime }) }}</span>
             </div>
           </div>

           <!-- Multi-Layered Progress Strip -->
           <div class="space-y-4">
             <div class="flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-primary">
               <div class="flex items-center gap-2">
                 <span>{{ t('sqlImport.progress.streaming') }}</span>
                 <span class="text-foreground/40 font-light">/</span>
                 <span class="font-mono text-foreground">{{ progressPercent }}%</span>
               </div>
               <div class="text-foreground font-mono bg-muted/50 px-3 py-1 rounded-full border border-border/40">
                 {{ formatNumber(progressData?.executed || 0) }} ROWS
               </div>
             </div>
             <Progress :model-value="progressPercent" class="h-2 w-full bg-muted border border-border/60 rounded-full overflow-hidden" />
           </div>

           <!-- Integrated Log/Stack Display -->
           <div class="grid grid-cols-1 gap-4">
              <div class="rounded-2xl border-2 border-border/80 bg-background p-5 shadow-sm">
                 <div class="text-[10px] font-black uppercase tracking-widest text-foreground/50 mb-3 border-b border-border/40 pb-2 w-fit">{{ t('sqlImport.progress.currentStack') }}</div>
                 <div class="font-mono text-[12px] text-foreground line-clamp-2 break-all font-bold min-h-[2.4em] leading-relaxed">
                    {{ progressData?.currentSql || t('sqlImport.progress.preparing') }}
                 </div>
              </div>

              <div v-if="errorLog.length > 0" class="rounded-2xl border-2 border-destructive/60 bg-background overflow-hidden shadow-lg">
                <div class="px-5 py-3.5 flex items-center justify-between border-b-2 border-destructive/20 bg-destructive/5">
                  <div class="flex items-center gap-2 text-destructive">
                    <XCircle class="w-4 h-4" />
                    <span class="text-[10px] font-black uppercase tracking-widest">{{ t('sqlImport.logs.title') }}</span>
                  </div>
                  <span class="text-[10px] font-mono font-black text-white bg-destructive px-2 py-0.5 rounded-md">{{ errorLog.length }} ISSUES</span>
                </div>
                <ScrollArea class="h-[200px] bg-muted/10">
                   <div class="p-4 font-mono text-[11px] leading-6 text-destructive font-bold select-text">
                      <div v-for="(err, i) in errorLog" :key="i" class="py-2 border-b border-destructive/10 last:border-0 pl-4 relative hover:bg-destructive/5 transition-colors break-all whitespace-pre-wrap cursor-text">
                        <div class="absolute left-0 top-4 w-1.5 h-1.5 rounded-full bg-destructive shadow-[0_0_8px_rgba(var(--destructive),0.4)]" />
                        {{ err }}
                      </div>
                   </div>
                </ScrollArea>
              </div>
           </div>
        </div>
      </div>

      <!-- High-Contrast Action Footer -->
      <div class="px-8 py-6 border-t-2 border-border bg-muted/30 flex items-center justify-between">
        <div class="flex items-center gap-6">
          <div class="flex items-center gap-3 px-4 py-2 rounded-xl bg-background border-2 border-border shadow-sm">
             <div 
               class="h-2.5 w-2.5 rounded-full transition-all duration-500 shadow-lg ring-2 ring-white/20"
               :class="{
                 'bg-destructive shadow-destructive/60 animate-pulse': isCancelling,
                 'bg-emerald-500 shadow-emerald-500/60': isExecuting && !isPaused && !isCancelling,
                 'bg-amber-500 shadow-amber-500/60 animate-pulse': isPaused && !isCancelling,
                 'bg-border shadow-none': !isExecuting && !progressData?.isFinished && !isCancelling,
                 'bg-primary shadow-primary/60 border-2 border-white/20': !isExecuting && progressData?.isFinished
               }" 
             />
             <span class="text-[11px] font-black uppercase tracking-widest text-foreground">
               {{ isCancelling ? t('sqlImport.status.cancelling') : (isPaused ? t('sqlImport.status.paused') : (isExecuting ? t('sqlImport.status.active') : t('sqlImport.status.ready'))) }}
             </span>
          </div>
          <div v-if="!isExecuting && progressData?.isFinished" class="flex items-center gap-2 text-primary px-4 py-2 rounded-xl border-2 border-primary/40 bg-primary/5 text-[11px] font-black uppercase tracking-widest shadow-md">
             <CheckCircle2 class="w-4 h-4" />
             {{ t('sqlImport.status.missionSuccess') }}
          </div>
        </div>

        <div class="flex items-center gap-4">
          <Button
            variant="ghost"
            @click="handleCancel"
            :disabled="isCancelling"
            class="rounded-xl px-7 h-11 font-black text-xs text-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-all uppercase tracking-widest border border-transparent hover:border-destructive/20"
          >
            <Loader2 v-if="isCancelling" class="w-4 h-4 mr-2 animate-spin" />
            {{ isCancelling ? t('sqlImport.status.cancelling') : ((!isExecuting && progressData?.isFinished) ? t('sqlImport.actions.finish') : t('sqlImport.actions.cancel')) }}
          </Button>

          <template v-if="isExecuting && !isCancelling">
            <Button v-if="!isPaused" variant="outline" @click="handlePause" class="rounded-xl px-7 h-11 font-black text-xs border-2 border-border hover:border-amber-500 hover:text-amber-600 transition-all uppercase tracking-widest shadow-sm bg-background">
              <Timer class="w-4 h-4 mr-2" /> {{ t('sqlImport.actions.pause') }}
            </Button>
            <Button v-else variant="default" @click="handleResume" class="rounded-xl px-9 h-11 font-black text-xs bg-emerald-600 hover:bg-emerald-700 shadow-xl shadow-emerald-600/30 gap-2 uppercase tracking-widest text-white transition-all ring-offset-background active:scale-95">
              <Play class="w-4 h-4 fill-current" /> {{ t('sqlImport.actions.resume') }}
            </Button>
          </template>

          <Button
            v-if="!isExecuting && !progressData"
            variant="default"
            class="rounded-xl px-10 h-11 font-black text-xs bg-primary hover:bg-primary/90 shadow-2xl shadow-primary/40 transition-all hover:-translate-y-1 active:translate-y-0 group uppercase tracking-[0.2em] relative overflow-hidden ring-offset-background active:scale-95"
            :disabled="!selectedFilePath"
            @click="handleStart"
          >
            {{ t('sqlImport.actions.start') }}
            <ArrowRight class="w-4 h-4 ml-3 group-hover:translate-x-2 transition-transform" />
          </Button>
        </div>
      </div>
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
