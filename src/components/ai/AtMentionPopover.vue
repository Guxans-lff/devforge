<script setup lang="ts">
/**
 * @ 文件引用浮层组件
 *
 * 用户在 AI 输入框中输入 @ 后弹出，显示工作区文件列表供选择。
 * 支持模糊搜索、键盘导航（↑↓ Enter Esc）。
 *
 * @props query        - @ 后面输入的搜索词
 * @props anchorPos    - 浮层绝对定位坐标 { x, y }
 * @props visible      - 是否显示
 * @emits select       - 用户选中文件，携带 FileNode
 * @emits close        - 关闭浮层
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { File } from 'lucide-vue-next'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import { fuzzyFilter } from '@/utils/fuzzyMatch'
import type { FileNode } from '@/types/workspace-files'

const props = defineProps<{
  query: string
  anchorPos: { x: number; y: number }
  visible: boolean
}>()

const emit = defineEmits<{
  select: [node: FileNode]
  close: []
}>()

const workspaceStore = useWorkspaceFilesStore()

/** 当前键盘高亮索引 */
const selectedIndex = ref(0)

/** 仅保留文件节点（排除目录和根节点头） */
const fileNodes = computed(() =>
  workspaceStore.flatNodes.filter((n) => !n.isDirectory && !n.isRootHeader),
)

/** 是否无工作区文件夹 */
const hasRoots = computed(() => workspaceStore.roots.length > 0)

/** 经过模糊搜索后的展示列表，最多 10 条 */
const filteredFiles = computed<FileNode[]>(() => {
  const files = fileNodes.value
  if (!props.query) return files.slice(0, 10)
  return fuzzyFilter(files, props.query, (f) => f.name, 10)
})

/** 选中当前高亮项 */
function confirmSelect() {
  const node = filteredFiles.value[selectedIndex.value]
  if (node) emit('select', node)
}

/** 点击某一项 */
function handleItemClick(node: FileNode) {
  emit('select', node)
}

/** 键盘导航处理 */
function onKeydown(e: KeyboardEvent) {
  if (!props.visible) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, filteredFiles.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    confirmSelect()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}

/** 点击组件外部时关闭 */
const popoverEl = ref<HTMLElement | null>(null)

function onDocumentClick(e: MouseEvent) {
  if (!props.visible) return
  if (popoverEl.value && !popoverEl.value.contains(e.target as Node)) {
    emit('close')
  }
}

// query 变化时重置高亮索引
watch(() => props.query, () => {
  selectedIndex.value = 0
})

// visible 变化时增删全局事件监听
watch(
  () => props.visible,
  (val) => {
    if (val) {
      document.addEventListener('keydown', onKeydown)
      document.addEventListener('mousedown', onDocumentClick)
    } else {
      document.removeEventListener('keydown', onKeydown)
      document.removeEventListener('mousedown', onDocumentClick)
    }
  },
)

onMounted(() => {
  if (props.visible) {
    document.addEventListener('keydown', onKeydown)
    document.addEventListener('mousedown', onDocumentClick)
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('mousedown', onDocumentClick)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="popoverEl"
      class="fixed z-50 w-[300px] max-h-[320px] overflow-y-auto rounded-lg border bg-popover shadow-lg text-popover-foreground"
      :style="{ left: `${anchorPos.x}px`, top: `${anchorPos.y}px` }"
    >
      <!-- 无工作区文件夹提示 -->
      <div
        v-if="!hasRoots"
        class="px-4 py-6 text-center text-sm text-muted-foreground"
      >
        请先在文件面板添加工作区文件夹
      </div>

      <!-- 无搜索结果提示 -->
      <div
        v-else-if="filteredFiles.length === 0"
        class="px-4 py-6 text-center text-sm text-muted-foreground"
      >
        未找到匹配文件
      </div>

      <!-- 文件列表 -->
      <ul v-else class="py-1">
        <li
          v-for="(node, index) in filteredFiles"
          :key="node.id"
          class="flex items-center gap-2 px-3 py-2 cursor-pointer text-sm transition-colors"
          :class="index === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'"
          @mousedown.prevent="handleItemClick(node)"
          @mouseenter="selectedIndex = index"
        >
          <!-- 文件图标 -->
          <File class="h-4 w-4 shrink-0 text-muted-foreground" />

          <!-- 文件名 + 路径 -->
          <div class="flex flex-col min-w-0">
            <span class="truncate font-medium leading-tight">{{ node.name }}</span>
            <span class="truncate text-xs text-muted-foreground leading-tight">{{ node.path }}</span>
          </div>
        </li>
      </ul>
    </div>
  </Teleport>
</template>
