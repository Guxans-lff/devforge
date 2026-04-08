<script setup lang="ts">
/**
 * 贴图窗口页面
 * 在独立的无边框置顶小窗口中显示截图
 * 支持：拖拽移动、滚轮缩放、右键菜单
 *
 * 通过 URL query 传参：/pin?filePath=...&width=...&height=...
 */
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { convertFileSrc } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

const route = useRoute()

/** 从路由 query 读取参数 */
const filePath = computed(() => String(route.query.filePath || ''))

// ── 状态 ──────────────────────────────────────────────────────

const scale = ref(1)
const opacity = ref(1)
const showContextMenu = ref(false)
const contextMenuPos = ref({ x: 0, y: 0 })

const imageSrc = computed(() => filePath.value ? convertFileSrc(filePath.value) : '')

// ── 缩放 ──────────────────────────────────────────────────────

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = e.deltaY > 0 ? -0.1 : 0.1
  scale.value = Math.max(0.1, Math.min(5, scale.value + delta))
}

// ── 右键菜单 ────────────────────────────────────────────────────

function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  contextMenuPos.value = { x: e.clientX, y: e.clientY }
  showContextMenu.value = true
}

function closeContextMenu() {
  showContextMenu.value = false
}

// ── 操作 ──────────────────────────────────────────────────────

async function closeWindow() {
  const win = getCurrentWindow()
  try {
    await win.destroy()
  } catch {
    await win.close()
  }
}

function resetScale() {
  scale.value = 1
  closeContextMenu()
}

function toggleOpacity() {
  opacity.value = opacity.value === 1 ? 0.5 : 1
  closeContextMenu()
}

// ── 拖拽移动 ────────────────────────────────────────────────────

async function onMouseDown(e: MouseEvent) {
  // 右键菜单可见时不拖拽，避免吞掉菜单点击
  if (e.button === 0 && !showContextMenu.value) {
    await getCurrentWindow().startDragging()
  }
}

onMounted(() => {
  document.addEventListener('click', closeContextMenu)
})
</script>

<template>
  <div
    class="w-screen h-screen overflow-hidden bg-transparent select-none cursor-move"
    :style="{ opacity }"
    @wheel="onWheel"
    @contextmenu="onContextMenu"
    @mousedown="onMouseDown"
  >
    <!-- 截图图片：始终填满窗口，缩放基于窗口 -->
    <img
      :src="imageSrc"
      :style="{
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        width: '100%',
        height: '100%',
        objectFit: 'contain',
      }"
      draggable="false"
      class="block"
    />

    <!-- 右键菜单 -->
    <div
      v-if="showContextMenu"
      class="fixed z-50 min-w-[120px] rounded-md border border-border bg-popover py-1 shadow-md"
      :style="{ left: `${contextMenuPos.x}px`, top: `${contextMenuPos.y}px` }"
      @mousedown.stop
    >
      <button
        class="w-full px-3 py-1.5 text-left text-xs hover:bg-accent"
        @click="resetScale"
      >
        重置缩放 (1:1)
      </button>
      <button
        class="w-full px-3 py-1.5 text-left text-xs hover:bg-accent"
        @click="toggleOpacity"
      >
        {{ opacity === 1 ? '半透明' : '不透明' }}
      </button>
      <div class="my-1 h-px bg-border" />
      <button
        class="w-full px-3 py-1.5 text-left text-xs text-destructive hover:bg-accent"
        @click="closeWindow"
      >
        关闭贴图
      </button>
    </div>
  </div>
</template>
