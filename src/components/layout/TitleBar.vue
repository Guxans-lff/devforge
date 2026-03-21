<script setup lang="ts">
/**
 * TitleBar - 自定义窗口标题栏
 * 替代系统原生标题栏，在中间放置搜索/命令面板入口（类似 VS Code）
 */
import { ref } from 'vue'
import { useCommandPaletteStore } from '@/stores/command-palette'
import { Search, Minus, Square, X, Copy, Zap } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const commandPalette = useCommandPaletteStore()
const isMaximized = ref(false)

/** 窗口拖拽 */
async function startDrag() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().startDragging()
  } catch { /* 非 Tauri 环境忽略 */ }
}

/** 最小化窗口 */
async function minimize() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().minimize()
  } catch { /* 非 Tauri 环境忽略 */ }
}

/** 切换最大化 */
async function toggleMaximize() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    await win.toggleMaximize()
    isMaximized.value = await win.isMaximized()
  } catch { /* 非 Tauri 环境忽略 */ }
}

/** 关闭窗口 */
async function closeWindow() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().close()
  } catch { /* 非 Tauri 环境忽略 */ }
}

/** 双击标题栏切换最大化 */
async function handleDoubleClick() {
  await toggleMaximize()
}

// 初始化最大化状态
;(async () => {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    isMaximized.value = await getCurrentWindow().isMaximized()
  } catch { /* 非 Tauri 环境忽略 */ }
})()
</script>

<template>
  <div
    class="title-bar flex h-9 items-center bg-background/80 backdrop-blur-md border-b border-border/20 select-none shrink-0"
    @mousedown="startDrag"
    @dblclick="handleDoubleClick"
  >
    <!-- 左侧：应用图标 + 名称 -->
    <div class="flex-1 flex items-center gap-2 px-3" @mousedown.stop>
      <Zap class="h-4 w-4 text-primary" />
      <span class="text-[11px] font-semibold text-foreground/60">DevForge</span>
    </div>

    <!-- 中间：搜索/命令面板入口 -->
    <div class="flex-none flex justify-center" @mousedown.stop>
      <button
        class="flex h-6 w-[340px] max-w-[40vw] items-center justify-center gap-2 rounded-md border border-border/80 bg-muted/40 px-3 text-muted-foreground/80 transition-all hover:bg-muted/60 hover:text-muted-foreground hover:border-border active:scale-[0.98]"
        @click="commandPalette.toggle()"
      >
        <Search class="h-3 w-3 shrink-0" />
        <span class="text-[11px] truncate">{{ t('command.palette') }}</span>
      </button>
    </div>

    <!-- 右侧：窗口控制按钮 -->
    <div class="flex-1 flex items-center justify-end" @mousedown.stop>
      <!-- 最小化 -->
      <button
        class="flex h-9 w-12 items-center justify-center text-foreground/50 transition-colors hover:bg-muted/40 hover:text-foreground/80"
        @click="minimize"
      >
        <Minus class="h-4 w-4" />
      </button>
      <!-- 最大化/还原 -->
      <button
        class="flex h-9 w-12 items-center justify-center text-foreground/50 transition-colors hover:bg-muted/40 hover:text-foreground/80"
        @click="toggleMaximize"
      >
        <Copy v-if="isMaximized" class="h-3 w-3" />
        <Square v-else class="h-3 w-3" />
      </button>
      <!-- 关闭 -->
      <button
        class="flex h-9 w-12 items-center justify-center text-foreground/50 transition-colors hover:bg-red-500 hover:text-white"
        @click="closeWindow"
      >
        <X class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.title-bar {
  -webkit-app-region: drag;
}
.title-bar button,
.title-bar [mousedown-stop] {
  -webkit-app-region: no-drag;
}
</style>
