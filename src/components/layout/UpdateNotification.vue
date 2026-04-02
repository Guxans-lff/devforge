<script setup lang="ts">
/**
 * 全局更新通知（非模态）
 * 底部右侧弹出，显示新版本信息和操作按钮
 */
import { useI18n } from 'vue-i18n'
import { useUpdater } from '@/composables/useUpdater'
import { Button } from '@/components/ui/button'
import { Download, X, SkipForward, Clock, Loader2 } from 'lucide-vue-next'

const { t } = useI18n()
const {
  updateAvailable,
  downloading,
  downloadProgress,
  updateVersion,
  updateBody,
  downloadAndInstall,
  setSkipVersion,
  dismissUpdate,
} = useUpdater()

function handleInstall() {
  downloadAndInstall()
}

function handleLater() {
  dismissUpdate()
}

function handleSkip() {
  setSkipVersion(updateVersion.value)
}
</script>

<template>
  <!-- 全局更新通知弹出 -->
  <Transition
    enter-active-class="transition-[transform,opacity] duration-300 ease-out"
    enter-from-class="translate-y-4 opacity-0 scale-95"
    enter-to-class="translate-y-0 opacity-100 scale-100"
    leave-active-class="transition-[transform,opacity] duration-200 ease-in"
    leave-from-class="translate-y-0 opacity-100 scale-100"
    leave-to-class="translate-y-4 opacity-0 scale-95"
  >
    <div
      v-if="updateAvailable"
      class="fixed bottom-5 right-5 z-[9999] w-[360px] rounded-2xl border border-border/30 bg-background/95 shadow-2xl backdrop-blur-xl"
    >
      <!-- 头部 -->
      <div class="flex items-center justify-between px-4 pt-4 pb-2">
        <div class="flex items-center gap-2">
          <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Download class="h-3.5 w-3.5" />
          </div>
          <span class="text-sm font-bold">{{ t('updater.updateAvailable') }}</span>
        </div>
        <button
          v-if="!downloading"
          class="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
          @click="handleLater"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>

      <!-- 版本信息 -->
      <div class="px-4 pb-3">
        <div class="text-xs text-muted-foreground">
          <span class="font-mono font-bold text-primary">v{{ updateVersion }}</span>
          <span class="mx-1.5 text-muted-foreground/30">|</span>
          {{ t('updater.readyToInstall') }}
        </div>
        <!-- 更新说明（最多 3 行） -->
        <p
          v-if="updateBody"
          class="mt-1.5 text-[11px] text-muted-foreground/60 leading-relaxed line-clamp-3"
        >
          {{ updateBody }}
        </p>
      </div>

      <!-- 下载进度条 -->
      <div v-if="downloading" class="px-4 pb-3">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[11px] font-bold text-primary flex items-center gap-1.5">
            <Loader2 class="h-3 w-3 animate-spin" />
            {{ t('updater.downloading') }}
          </span>
          <span class="text-[11px] font-mono text-muted-foreground">{{ downloadProgress }}%</span>
        </div>
        <div class="h-1.5 rounded-full bg-muted/30 overflow-hidden">
          <div
            class="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            :style="{ width: `${downloadProgress}%` }"
          />
        </div>
      </div>

      <!-- 操作按钮 -->
      <div v-if="!downloading" class="flex items-center justify-end gap-2 px-4 pb-4">
        <Button
          variant="ghost"
          size="sm"
          class="h-7 gap-1.5 rounded-lg px-2.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          @click="handleSkip"
        >
          <SkipForward class="h-3 w-3" />
          {{ t('updater.skipVersion') }}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-7 gap-1.5 rounded-lg px-2.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          @click="handleLater"
        >
          <Clock class="h-3 w-3" />
          {{ t('updater.later') }}
        </Button>
        <Button
          size="sm"
          class="h-7 gap-1.5 rounded-lg px-3 text-[11px] font-bold"
          @click="handleInstall"
        >
          <Download class="h-3 w-3" />
          {{ t('updater.installNow') }}
        </Button>
      </div>
    </div>
  </Transition>
</template>
