<script setup lang="ts">
/**
 * 文件树右键菜单 — 圆润现代风格
 */
import { computed, ref, nextTick, watch } from 'vue'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import type { FileNode } from '@/types/workspace-files'
import {
  FilePlus, FolderPlus, Pencil, Trash2, Copy,
  CopyCheck, FileText, X as IconX, FolderOpen,
} from 'lucide-vue-next'
import { openPath } from '@tauri-apps/plugin-opener'

const props = defineProps<{
  node: FileNode | null
  position: { x: number; y: number }
  multiSelectedCount: number
}>()

const emit = defineEmits<{
  close: []
  newFile: [parentPath: string]
  newFolder: [parentPath: string]
  rename: [node: FileNode]
  delete: [node: FileNode]
  batchDelete: []
}>()

const store = useWorkspaceFilesStore()

const menuRef = ref<HTMLElement | null>(null)

/** 计算实际渲染位置：防止超出屏幕底部/右侧 */
const adjustedPos = computed(() => {
  const { x, y } = props.position
  return { x, y }
})

watch(
  () => props.position,
  () => {
    nextTick(() => {
      const el = menuRef.value
      if (!el) return
      const rect = el.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      if (rect.bottom > vh) {
        el.style.top = `${props.position.y - rect.height}px`
      } else {
        el.style.top = `${props.position.y}px`
      }
      if (rect.right > vw) {
        el.style.left = `${props.position.x - rect.width}px`
      } else {
        el.style.left = `${props.position.x}px`
      }
    })
  },
  { immediate: true },
)

interface MenuItem {
  label: string
  icon: any
  action: () => void
  danger?: boolean
  separator?: boolean
}

const menuItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = []
  const n = props.node

  if (!n) {
    items.push({ label: '新建文件', icon: FilePlus, action: () => emit('newFile', '') })
    items.push({ label: '新建文件夹', icon: FolderPlus, action: () => emit('newFolder', '') })
    return items
  }

  // 多选模式
  if (props.multiSelectedCount > 1) {
    items.push({
      label: `批量删除 (${props.multiSelectedCount})`,
      icon: Trash2,
      action: () => emit('batchDelete'),
      danger: true,
    })
    items.push({
      label: '复制路径',
      icon: Copy,
      action: async () => {
        const paths = store.batchCopyPaths()
        await navigator.clipboard.writeText(paths.join('\n'))
        emit('close')
      },
    })
    return items
  }

  // 单选 — 目录额外操作
  if (n.isDirectory) {
    items.push({ label: '新建文件', icon: FilePlus, action: () => emit('newFile', n.absolutePath) })
    items.push({ label: '新建文件夹', icon: FolderPlus, action: () => emit('newFolder', n.absolutePath) })
    items.push({ label: '', icon: null, action: () => {}, separator: true })
  }

  items.push({
    label: '复制路径',
    icon: Copy,
    action: async () => { await navigator.clipboard.writeText(n.absolutePath); emit('close') },
  })

  items.push({
    label: '在资源管理器中打开',
    icon: FolderOpen,
    action: async () => {
      // 文件夹直接打开，文件打开其所在目录
      const target = n.isDirectory
        ? n.absolutePath
        : n.absolutePath.replace(/[/\\][^/\\]+$/, '')
      await openPath(target)
      emit('close')
    },
  })

  // 工作区根节点：只提供"复制名称 + 移除"，不给相对路径/重命名/删除
  if (n.isRootHeader) {
    items.push({
      label: '复制名称',
      icon: FileText,
      action: async () => { await navigator.clipboard.writeText(n.name); emit('close') },
    })
    items.push({ label: '', icon: null, action: () => {}, separator: true })
    items.push({
      label: '从工作区移除',
      icon: IconX,
      action: () => { store.removeRoot(n.rootId); emit('close') },
      danger: true,
    })
    return items
  }

  items.push({
    label: '复制相对路径',
    icon: CopyCheck,
    action: async () => { await navigator.clipboard.writeText(n.path); emit('close') },
  })
  items.push({
    label: '复制名称',
    icon: FileText,
    action: async () => { await navigator.clipboard.writeText(n.name); emit('close') },
  })

  items.push({ label: '', icon: null, action: () => {}, separator: true })

  items.push({
    label: '重命名',
    icon: Pencil,
    action: () => emit('rename', n),
  })

  items.push({ label: '', icon: null, action: () => {}, separator: true })

  items.push({
    label: '删除',
    icon: Trash2,
    action: () => emit('delete', n),
    danger: true,
  })

  return items
})
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50"
      @click="$emit('close')"
      @contextmenu.prevent="$emit('close')"
    >
      <div
        ref="menuRef"
        class="absolute min-w-[180px] rounded-xl border border-border/30 bg-popover/95 backdrop-blur-xl shadow-xl py-1.5 text-[12px]"
        :style="{ left: `${adjustedPos.x}px`, top: `${adjustedPos.y}px` }"
        @click.stop
      >
        <template v-for="(item, i) in menuItems" :key="i">
          <div v-if="item.separator" class="my-1 h-px bg-border/20 mx-2" />
          <button
            v-else
            class="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg mx-1 transition-colors"
            :class="item.danger
              ? 'hover:bg-destructive/10 text-destructive/80 hover:text-destructive'
              : 'hover:bg-muted/50 text-foreground/80 hover:text-foreground'"
            style="width: calc(100% - 8px);"
            @click="item.action(); item.danger || $emit('close')"
          >
            <component :is="item.icon" class="h-3.5 w-3.5 opacity-60" />
            {{ item.label }}
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>
