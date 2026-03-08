<script setup lang="ts">
/**
 * TitleBar - 自定义窗口标题栏
 * 替代系统原生标题栏，在中间放置搜索/命令面板入口（类似 VS Code）
 */
import { ref } from 'vue'
import { useCommandPaletteStore } from '@/stores/command-palette'
import { Search, Command, Minus, Square, X, Copy, Zap } from 'lucide-vue-next'
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
  } catch {}
}

/** 切换最大化 */
async function toggleMaximize() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    await win.toggleMaximize()
    isMaximized.value = await win.isMaximized()
  } catch {}
}

/** 关闭窗口 */
async function closeWindow() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().close()
  } catch {}
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
  } catch {}
})()
</script>

<template>
  <div
    class="title-bar flex h-9 items-center bg-background/80 backdrop-blur-md border-b border-border/20 select-none shrink-0"
    @mousedown="startDrag"
    @dblclick="handleDoubleClick"
  >
    <!-- 左侧：应用图标 + 名称 -->
    <div class="flex items-center gap-2 px-3 w-[200px] shrink-0" @mousedown.stop>
      <Zap class="h-4 w-4 text-primary" />
      <span class="text-[11px] font-semibold text-foreground/60">DevForge</span>
    </div>

    <!-- 中间：搜索/命令面板入口 -->
    <div class="flex-1 flex justify-center" @mousedown.stop>
      <button
        class="flex h-6 w-[340px] max-w-[50vw] items-center gap-2 rounded-md border border-border/40 bg-muted/20 px-3 text-muted-foreground/50 transition-all hover:bg-muted/40 hover:text-muted-foreground/70 hover:border-border/60 active:scale-[0.98]"
        @click="commandPalette.toggle()"
      >
        <Search class="h-3 w-3 shrink-0" />
        <span class="text-[11px] flex-1 text-left truncate">{{ t('command.palette') }}</span>
        <div class="flex items-center gap-0.5 text-[10px] font-bold opacity-50 shrink-0">
          <Command class="h-2.5 w-2.5" />
          <span>K</span>
        </div>
      </button>
    </div>

    <!-- 右侧：窗口控制按钮 -->
    <div class="flex items-center shrink-0" @mousedown.stop>
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
