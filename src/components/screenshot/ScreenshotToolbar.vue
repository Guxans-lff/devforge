<script setup lang="ts">
/**
 * 截图操作工具栏
 * 提供全屏/区域/窗口截图按钮
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  Monitor,
  Scan,
  AppWindow,
  Loader2,
  Timer,
  ChevronDown,
} from 'lucide-vue-next'
import type { MonitorInfo } from '@/types/screenshot'

defineProps<{
  monitors: MonitorInfo[]
  capturing: boolean
}>()

const emit = defineEmits<{
  captureFullscreen: [monitorId?: number]
  captureRegion: [monitorId: number, x: number, y: number, w: number, h: number]
  captureWindow: [windowTitle: string]
  openRegionSelect: []
  delayCapture: [seconds: number]
}>()

const { t } = useI18n()

/** 延迟截图菜单 */
const showDelayMenu = ref(false)
const delayOptions = [3, 5, 10]

/** 点击外部关闭菜单 */
function handleClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (showDelayMenu.value && !target.closest('.delay-menu-wrapper')) {
    showDelayMenu.value = false
  }
}

onMounted(() => document.addEventListener('click', handleClickOutside))
onBeforeUnmount(() => document.removeEventListener('click', handleClickOutside))

/** 全屏截图（默认主显示器） */
function handleFullscreen() {
  emit('captureFullscreen')
}

/** 区域截图 — 打开覆盖窗口 */
function handleRegion() {
  emit('openRegionSelect')
}

/** 窗口截图 — 同样打开覆盖窗口（窗口智能吸附） */
function handleWindow() {
  emit('openRegionSelect')
}
</script>

<template>
  <div class="flex items-center gap-2 border-b border-border px-4 py-3">
    <!-- 标题 -->
    <h2 class="text-sm font-medium text-foreground mr-4">
      {{ t('screenshot.dashboard') }}
    </h2>

    <!-- 全屏截图 -->
    <Button
      variant="outline"
      size="sm"
      :disabled="capturing"
      @click="handleFullscreen"
    >
      <Loader2 v-if="capturing" class="mr-1.5 h-4 w-4 animate-spin" />
      <Monitor v-else class="mr-1.5 h-4 w-4" />
      {{ t('screenshot.captureFullscreen') }}
    </Button>

    <!-- 区域截图 -->
    <Button
      variant="outline"
      size="sm"
      :disabled="capturing"
      @click="handleRegion"
    >
      <Scan class="mr-1.5 h-4 w-4" />
      {{ t('screenshot.captureRegion') }}
    </Button>

    <!-- 窗口截图 -->
    <Button
      variant="outline"
      size="sm"
      :disabled="capturing"
      @click="handleWindow"
    >
      <AppWindow class="mr-1.5 h-4 w-4" />
      {{ t('screenshot.captureWindow') }}
    </Button>

    <!-- 延迟截图 -->
    <div class="relative delay-menu-wrapper">
      <Button
        variant="outline"
        size="sm"
        :disabled="capturing"
        @click="showDelayMenu = !showDelayMenu"
      >
        <Timer class="mr-1.5 h-4 w-4" />
        {{ t('screenshot.captureDelayed') }}
        <ChevronDown class="ml-1 h-3 w-3" />
      </Button>

      <!-- 延迟选项下拉菜单 -->
      <div
        v-if="showDelayMenu"
        class="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-md py-1 min-w-[100px]"
      >
        <button
          v-for="sec in delayOptions"
          :key="sec"
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors"
          @click="emit('delayCapture', sec); showDelayMenu = false"
        >
          {{ sec }} {{ t('screenshot.delayUnit') }}
        </button>
      </div>
    </div>

    <!-- 显示器信息 -->
    <span v-if="monitors.length > 1" class="ml-auto text-xs text-muted-foreground">
      {{ monitors.length }} {{ monitors.length > 1 ? 'monitors' : 'monitor' }}
    </span>
  </div>
</template>
