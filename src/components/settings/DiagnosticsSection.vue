<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { getAppVersion } from '@/api/connection'
import { listCrashLogs, readCrashLog, clearCrashLogs } from '@/api/diagnostics'
import type { CrashLogEntry } from '@/api/diagnostics'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Activity, FileText, Trash2, ChevronDown, ChevronRight, Loader2 } from 'lucide-vue-next'

const { t } = useI18n()
const toast = useToast()

// 应用版本
const appVersion = ref('...')

// 崩溃日志
const crashLogs = ref<CrashLogEntry[]>([])
const loading = ref(false)
const expandedLog = ref<string | null>(null)
const logContents = ref<Record<string, string>>({})
const logContentLoading = ref<Record<string, boolean>>({})

// 清除确认弹窗
const showClearConfirm = ref(false)

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 加载崩溃日志列表 */
async function loadCrashLogs() {
  loading.value = true
  try {
    crashLogs.value = await listCrashLogs()
  } catch {
    toast.error('加载崩溃日志失败')
  } finally {
    loading.value = false
  }
}

/** 切换日志展开/收起 */
async function toggleLog(filename: string) {
  if (expandedLog.value === filename) {
    expandedLog.value = null
    return
  }

  expandedLog.value = filename

  // 如果尚未加载内容，则加载
  if (!logContents.value[filename]) {
    logContentLoading.value = { ...logContentLoading.value, [filename]: true }
    try {
      const content = await readCrashLog(filename)
      logContents.value = { ...logContents.value, [filename]: content }
    } catch {
      logContents.value = { ...logContents.value, [filename]: '无法读取日志内容' }
    } finally {
      logContentLoading.value = { ...logContentLoading.value, [filename]: false }
    }
  }
}

/** 清除所有崩溃日志 */
async function handleClearLogs() {
  try {
    const count = await clearCrashLogs()
    crashLogs.value = []
    expandedLog.value = null
    logContents.value = {}
    toast.success(t('settings.clearLogsSuccess', { count }))
  } catch {
    toast.error('清除日志失败')
  }
}

onMounted(async () => {
  // 并行加载版本号和崩溃日志
  const [version] = await Promise.allSettled([
    getAppVersion(),
    loadCrashLogs(),
  ])
  if (version.status === 'fulfilled') {
    appVersion.value = version.value
  }
})
</script>

<template>
  <div class="grid gap-4">
    <!-- 应用版本 -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-all hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/5 text-cyan-500/60 transition-colors group-hover:bg-cyan-500/10 group-hover:text-cyan-500">
          <Activity class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <p class="text-[15px] font-bold tracking-tight">{{ t('settings.appVersion') }}</p>
          <p class="text-xs text-muted-foreground/60 font-medium">{{ t('settings.diagnosticsDesc') }}</p>
        </div>
      </div>
      <span class="px-3 py-1.5 rounded-xl bg-background border border-border/20 text-xs font-black text-primary/80 tracking-tight shadow-sm">
        v{{ appVersion }}
      </span>
    </div>

    <!-- 崩溃日志 -->
    <div class="group p-5 bg-muted/10 border border-border/10 rounded-2xl transition-all hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-center justify-between">
        <div class="flex items-start gap-4">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/5 text-red-500/60 transition-colors group-hover:bg-red-500/10 group-hover:text-red-500">
            <FileText class="h-5 w-5" />
          </div>
          <div class="space-y-0.5">
            <p class="text-[15px] font-bold tracking-tight">{{ t('settings.crashLogs') }}</p>
            <p class="text-xs text-muted-foreground/60 font-medium">
              {{ crashLogs.length > 0 ? `${crashLogs.length} 个日志文件` : t('settings.crashLogsEmpty') }}
            </p>
          </div>
        </div>
        <Button
          v-if="crashLogs.length > 0"
          variant="outline"
          size="sm"
          class="h-8 gap-1.5 rounded-xl border-border/30 text-[11px] font-bold transition-all hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
          @click="showClearConfirm = true"
        >
          <Trash2 class="h-3 w-3" />
          {{ t('settings.clearLogs') }}
        </Button>
      </div>

      <!-- 日志列表 -->
      <div v-if="loading" class="mt-4 flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground/50">
        <Loader2 class="h-3.5 w-3.5 animate-spin" />
        {{ t('settings.loadingLogs') }}
      </div>

      <div v-else-if="crashLogs.length > 0" class="mt-4 space-y-1.5">
        <ScrollArea class="max-h-[360px]">
          <div class="space-y-1.5 pr-2">
            <div
              v-for="log in crashLogs"
              :key="log.filename"
              class="rounded-xl border border-border/10 bg-background/50 transition-all"
            >
              <!-- 日志条目头 -->
              <button
                class="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/30 rounded-xl"
                @click="toggleLog(log.filename)"
              >
                <component
                  :is="expandedLog === log.filename ? ChevronDown : ChevronRight"
                  class="h-3 w-3 shrink-0 text-muted-foreground/40"
                />
                <span class="flex-1 truncate font-mono text-[11px] font-bold text-foreground/80">
                  {{ log.filename }}
                </span>
                <span class="shrink-0 text-[10px] font-medium text-muted-foreground/40">
                  {{ formatSize(log.size) }}
                </span>
                <span class="shrink-0 text-[10px] font-medium text-muted-foreground/40">
                  {{ log.modified }}
                </span>
              </button>

              <!-- 日志内容展开区 -->
              <div
                v-if="expandedLog === log.filename"
                class="border-t border-border/10 px-4 py-3"
              >
                <div v-if="logContentLoading[log.filename]" class="flex items-center gap-2 py-4 text-xs text-muted-foreground/50">
                  <Loader2 class="h-3 w-3 animate-spin" />
                  {{ t('settings.loadingLogs') }}
                </div>
                <ScrollArea v-else class="max-h-[240px]">
                  <pre class="whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-muted-foreground/70">{{ logContents[log.filename] }}</pre>
                </ScrollArea>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>

    <!-- 清除确认弹窗 -->
    <ConfirmDialog
      v-model:open="showClearConfirm"
      :title="t('settings.clearLogsConfirm')"
      :confirm-label="t('settings.clearLogs')"
      :cancel-label="t('common.cancel')"
      variant="destructive"
      @confirm="handleClearLogs"
    />
  </div>
</template>
