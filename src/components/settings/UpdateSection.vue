<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUpdater } from '@/composables/useUpdater'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Download, RefreshCw, CheckCircle, AlertCircle, Loader2 } from 'lucide-vue-next'

const { t } = useI18n()
const {
  checking,
  updateAvailable,
  upToDate,
  downloading,
  downloadProgress,
  error,
  updateVersion,
  updateBody,
  currentVersion,
  autoCheck,
  checkForUpdate,
  downloadAndInstall,
  setAutoCheck,
} = useUpdater()

// 格式化下载进度
const progressText = computed(() => `${downloadProgress.value}%`)

// 手动检查更新
async function handleCheck() {
  await checkForUpdate()
}

// 开始下载安装
function handleDownload() {
  downloadAndInstall()
}
</script>

<template>
  <div class="grid gap-4">
    <!-- 当前版本 + 手动检查 -->
    <div class="group p-5 bg-muted/10 border border-border/10 rounded-2xl transition-all hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-center justify-between">
        <div class="flex items-start gap-4">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/5 text-primary/60 transition-colors group-hover:bg-primary/10 group-hover:text-primary">
            <Download class="h-5 w-5" />
          </div>
          <div class="space-y-0.5">
            <Label class="text-[15px] font-bold tracking-tight">{{ t('updater.title') }}</Label>
            <p class="text-xs text-muted-foreground/60 font-medium">
              {{ t('updater.currentVersion') }}: <span class="font-mono text-foreground/80">v{{ currentVersion || '-' }}</span>
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          :disabled="checking || downloading"
          class="h-9 gap-2 rounded-xl border-border/50 bg-background/50 px-4 text-xs font-bold transition-all hover:border-primary/30 hover:bg-primary/5"
          @click="handleCheck"
        >
          <Loader2 v-if="checking" class="h-3.5 w-3.5 animate-spin" />
          <RefreshCw v-else class="h-3.5 w-3.5" />
          {{ checking ? t('updater.checking') : t('updater.checkNow') }}
        </Button>
      </div>

      <!-- 错误提示 -->
      <div v-if="error" class="mt-3 pl-14 flex items-center gap-2 text-xs text-destructive">
        <AlertCircle class="h-3.5 w-3.5 shrink-0" />
        <span class="truncate">{{ error }}</span>
      </div>

      <!-- 已是最新版本 -->
      <div v-if="upToDate && !updateAvailable && !error" class="mt-3 pl-14 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
        <CheckCircle class="h-3.5 w-3.5 shrink-0" />
        <span>{{ t('updater.noUpdate') }}</span>
      </div>

      <!-- 有可用更新 -->
      <div v-if="updateAvailable && !downloading" class="mt-4 pl-14">
        <div class="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <CheckCircle class="h-4 w-4 text-emerald-500" />
              <span class="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                {{ t('updater.newVersion') }} v{{ updateVersion }}
              </span>
            </div>
            <Button
              size="sm"
              class="h-8 gap-2 rounded-lg px-4 text-xs font-bold"
              @click="handleDownload"
            >
              <Download class="h-3.5 w-3.5" />
              {{ t('updater.installNow') }}
            </Button>
          </div>
          <!-- 更新说明 -->
          <p v-if="updateBody" class="mt-2 text-xs text-muted-foreground/80 whitespace-pre-wrap leading-relaxed">
            {{ updateBody }}
          </p>
        </div>
      </div>

      <!-- 下载中进度条 -->
      <div v-if="downloading" class="mt-4 pl-14">
        <div class="p-4 rounded-xl bg-primary/5 border border-primary/20">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-bold text-primary">{{ t('updater.downloading') }}</span>
            <span class="text-xs font-mono text-muted-foreground">{{ progressText }}</span>
          </div>
          <div class="h-2 rounded-full bg-muted/30 overflow-hidden">
            <div
              class="h-full rounded-full bg-primary transition-all duration-300 ease-out"
              :style="{ width: `${downloadProgress}%` }"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 自动检查开关 -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-all hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/5 text-amber-500/60 transition-colors group-hover:bg-amber-500/10 group-hover:text-amber-500">
          <RefreshCw class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <Label class="text-[15px] font-bold tracking-tight">{{ t('updater.autoCheck') }}</Label>
          <p class="text-xs text-muted-foreground/60 font-medium">{{ t('updater.autoCheckDesc') }}</p>
        </div>
      </div>
      <Switch
        :checked="autoCheck"
        @update:checked="setAutoCheck"
      />
    </div>
  </div>
</template>
