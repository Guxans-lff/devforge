<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_AI_DIAGNOSTICS_THRESHOLDS, useSettingsStore, type AiDiagnosticsThresholds } from '@/stores/settings'
import { useToast } from '@/composables/useToast'
import { getAppVersion } from '@/api/connection'
import { listCrashLogs, readCrashLog, clearCrashLogs } from '@/api/diagnostics'
import type { CrashLogEntry } from '@/api/diagnostics'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Activity, Bug, FileText, Gauge, Trash2, ChevronDown, ChevronRight, Loader2, RotateCcw } from 'lucide-vue-next'

const { t } = useI18n()
const settingsStore = useSettingsStore()
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

const thresholdItems: Array<{
  key: keyof AiDiagnosticsThresholds
  unit: 'ms' | 'count'
}> = [
  { key: 'firstTokenWarnMs', unit: 'ms' },
  { key: 'firstTokenDangerMs', unit: 'ms' },
  { key: 'responseWarnMs', unit: 'ms' },
  { key: 'responseDangerMs', unit: 'ms' },
  { key: 'historyWarnMs', unit: 'ms' },
  { key: 'historyDangerMs', unit: 'ms' },
  { key: 'toolQueueWarnCount', unit: 'count' },
  { key: 'toolQueueDangerCount', unit: 'count' },
  { key: 'toolRunWarnMs', unit: 'ms' },
  { key: 'toolRunDangerMs', unit: 'ms' },
]

const thresholdSummary = computed(() => {
  const thresholds = settingsStore.settings.aiDiagnosticsThresholds
  return [
    `${t('settings.aiDiagnosticsFirstToken')}: ${thresholds.firstTokenWarnMs}/${thresholds.firstTokenDangerMs} ms`,
    `${t('settings.aiDiagnosticsResponse')}: ${thresholds.responseWarnMs}/${thresholds.responseDangerMs} ms`,
    `${t('settings.aiDiagnosticsToolQueue')}: ${thresholds.toolQueueWarnCount}/${thresholds.toolQueueDangerCount}`,
  ].join(' · ')
})

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

/** 切换开发者模式 */
function handleDevModeToggle(value: boolean) {
  settingsStore.update({ devMode: value })
}

function thresholdLabel(key: keyof AiDiagnosticsThresholds): string {
  return t(`settings.aiDiagnosticsThresholds.${key}`)
}

function updateThreshold(key: keyof AiDiagnosticsThresholds, value: string | number) {
  const numeric = typeof value === 'number' ? value : Number(value)
  const nextValue = Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0
  settingsStore.update({
    aiDiagnosticsThresholds: {
      ...settingsStore.settings.aiDiagnosticsThresholds,
      [key]: nextValue,
    },
  })
}

function resetAiDiagnosticsThresholds() {
  settingsStore.update({
    aiDiagnosticsThresholds: { ...DEFAULT_AI_DIAGNOSTICS_THRESHOLDS },
  })
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
    <!-- 开发者模式开关 -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-[background-color,border-color] hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/5 text-primary/50 transition-colors group-hover:bg-primary/10 group-hover:text-primary/80">
          <Bug class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <Label class="text-[15px] font-bold tracking-tight">{{ t('settings.devMode') }}</Label>
          <p class="text-xs text-muted-foreground/60 font-medium">{{ t('settings.devModeDesc') }}</p>
        </div>
      </div>
      <Switch
        :checked="settingsStore.settings.devMode"
        @update:checked="handleDevModeToggle"
      />
    </div>

    <!-- 应用版本 -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-[background-color,border-color] hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/5 text-primary/50 transition-colors group-hover:bg-primary/10 group-hover:text-primary/80">
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

    <!-- AI 诊断阈值 -->
    <div class="group p-5 bg-muted/10 border border-border/10 rounded-2xl transition-[background-color,border-color] hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start justify-between gap-4">
        <div class="flex items-start gap-4">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/5 text-primary/50 transition-colors group-hover:bg-primary/10 group-hover:text-primary/80">
            <Gauge class="h-5 w-5" />
          </div>
          <div class="space-y-0.5">
            <p class="text-[15px] font-bold tracking-tight">{{ t('settings.aiDiagnosticsThresholdsTitle') }}</p>
            <p class="text-xs text-muted-foreground/60 font-medium">{{ t('settings.aiDiagnosticsThresholdsDesc') }}</p>
            <p class="text-[11px] text-muted-foreground/45 font-mono">{{ thresholdSummary }}</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="h-8 gap-1.5 rounded-xl border-border/30 text-[11px] font-bold"
          @click="resetAiDiagnosticsThresholds"
        >
          <RotateCcw class="h-3 w-3" />
          {{ t('settings.aiDiagnosticsResetThresholds') }}
        </Button>
      </div>

      <div class="mt-4 grid gap-3 md:grid-cols-2">
        <label
          v-for="item in thresholdItems"
          :key="item.key"
          class="rounded-xl border border-border/10 bg-background/45 px-3 py-2.5 transition-[background-color,border-color] hover:bg-background/70 hover:border-border/30"
        >
          <div class="mb-1.5 flex items-center justify-between gap-2">
            <span class="text-[11px] font-bold text-foreground/75">{{ thresholdLabel(item.key) }}</span>
            <span class="text-[10px] font-mono text-muted-foreground/45">
              {{ item.unit === 'ms' ? 'ms' : t('settings.aiDiagnosticsCountUnit') }}
            </span>
          </div>
          <Input
            type="number"
            min="0"
            step="1"
            class="h-8 font-mono text-xs"
            :model-value="settingsStore.settings.aiDiagnosticsThresholds[item.key]"
            @update:model-value="updateThreshold(item.key, $event)"
          />
        </label>
      </div>
    </div>

    <!-- 崩溃日志 -->
    <div class="group p-5 bg-muted/10 border border-border/10 rounded-2xl transition-[background-color,border-color] hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-center justify-between">
        <div class="flex items-start gap-4">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/5 text-primary/50 transition-colors group-hover:bg-primary/10 group-hover:text-primary/80">
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
          class="h-8 gap-1.5 rounded-xl border-border/30 text-[11px] font-bold transition-[background-color,color,border-color] hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
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
              class="rounded-xl border border-border/10 bg-background/50 transition-[background-color,border-color]"
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
                <div
                  v-else
                  class="max-h-[240px] overflow-auto rounded-md bg-muted/20 p-3 custom-scrollbar"
                >
                  <pre class="whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-muted-foreground/70 select-text">{{ logContents[log.filename] }}</pre>
                </div>
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
