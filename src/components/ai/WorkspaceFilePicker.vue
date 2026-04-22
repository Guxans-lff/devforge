<script setup lang="ts">
/**
 * 工作区文件多选对话框
 *
 * 用于 AI 输入区的附件选择，替代系统文件对话框。
 * 显示工作区文件树，支持搜索和多选。
 *
 * @emits confirm - 用户确认选择，携带文件绝对路径列表
 * @emits close   - 关闭对话框
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { open } from '@tauri-apps/plugin-dialog'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import { fuzzyFilter } from '@/utils/fuzzyMatch'
import type { FileNode } from '@/types/workspace-files'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  File,
  Folder,
  FolderOpen,
  ChevronRight,
  Search,
  ExternalLink,
} from 'lucide-vue-next'

const emit = defineEmits<{
  confirm: [paths: string[]]
  close: []
}>()

const { t } = useI18n()
const store = useWorkspaceFilesStore()
const searchQuery = ref('')
const selectedPaths = ref<Set<string>>(new Set())

/** 展开状态（对话框内独立维护，不影响主面板） */
const localExpanded = ref<Set<string>>(new Set())

/** 是否无工作区文件夹 */
const hasRoots = computed(() => store.roots.length > 0)

/** 仅文件节点 */
const fileNodes = computed(() =>
  store.flatNodes.filter((n) => !n.isDirectory && !n.isRootHeader),
)

/** 搜索模式下的文件列表 */
const searchResults = computed<FileNode[]>(() => {
  if (!searchQuery.value) return []
  return fuzzyFilter(fileNodes.value, searchQuery.value, (f) => f.name, 50)
})

/** 是否搜索模式 */
const isSearching = computed(() => searchQuery.value.length > 0)

/** 构建树形展示节点 */
const treeNodes = computed(() => {
  if (isSearching.value) return []
  return store.flatNodes.filter((n) => {
    if (n.isRootHeader) return true
    // 只显示根级和已展开目录的子节点
    if (n.depth === 0) return true
    // 检查父级是否展开
    const parentId = getParentId(n)
    return parentId ? localExpanded.value.has(parentId) : false
  })
})

/** 获取父节点 ID */
function getParentId(node: FileNode): string | null {
  const parts = node.path.split('/')
  if (parts.length <= 1) return null
  const parentRelPath = parts.slice(0, -1).join('/')
  return `${node.rootId}:${parentRelPath}`
}

/** 切换目录展开 */
function toggleExpand(node: FileNode) {
  if (!node.isDirectory) return
  if (localExpanded.value.has(node.id)) {
    localExpanded.value.delete(node.id)
  } else {
    localExpanded.value.add(node.id)
    // 确保子节点已加载
    if (!store.nodeCache.has(node.absolutePath)) {
      store.expandDir(node.id)
    }
  }
  localExpanded.value = new Set(localExpanded.value)
}

/** 切换文件选中 */
function toggleSelect(node: FileNode) {
  if (node.isDirectory || node.isRootHeader) return
  if (selectedPaths.value.has(node.absolutePath)) {
    selectedPaths.value.delete(node.absolutePath)
  } else {
    selectedPaths.value.add(node.absolutePath)
  }
  selectedPaths.value = new Set(selectedPaths.value)
}

/** 确认选择 */
function handleConfirm() {
  emit('confirm', Array.from(selectedPaths.value))
}

/** 打开系统文件对话框（回退能力） */
async function browseSystem() {
  const result = await open({
    multiple: true,
    filters: [{ name: t('ai.workspaceFilePicker.systemFilterName'), extensions: ['*'] }],
  })
  if (!result) return
  const paths = Array.isArray(result) ? result : [result]
  emit('confirm', paths)
}

/** 选中数量 */
const selectedCount = computed(() => selectedPaths.value.size)

/** 初始化：展开所有根 */
for (const root of store.roots) {
  if (!root.collapsed) {
    // 展开根级目录
    const children = store.nodeCache.get(root.path) || []
    for (const child of children) {
      if (child.isDirectory) {
        // 不自动展开子目录
      }
    }
  }
}
</script>

<template>
  <Dialog :open="true" @update:open="(val: boolean) => !val && emit('close')">
    <DialogContent class="w-[min(760px,calc(100vw-2rem))] max-w-none max-h-[78vh] overflow-hidden gap-0 border-border/50 bg-card/98 p-0 shadow-2xl backdrop-blur-xl sm:max-w-none">
      <DialogHeader class="border-b border-border/40 px-6 py-5 pr-12">
        <DialogTitle class="text-lg font-semibold tracking-tight">{{ t('ai.workspaceFilePicker.title') }}</DialogTitle>
        <DialogDescription class="mt-1 text-sm text-muted-foreground">{{ t('ai.workspaceFilePicker.description') }}</DialogDescription>
      </DialogHeader>

      <div class="flex min-h-0 flex-1 flex-col px-6 py-4">
        <!-- 搜索框 -->
        <div class="relative">
          <Search class="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="t('ai.workspaceFilePicker.searchPlaceholder')"
            class="h-11 w-full rounded-xl border border-border/70 bg-background/70 py-2 pl-10 pr-3 text-sm shadow-inner shadow-black/5 placeholder:text-muted-foreground/70 transition-colors focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <!-- 无工作区提示 -->
        <div
          v-if="!hasRoots"
          class="mt-4 flex min-h-[260px] flex-1 items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/10 px-6 py-10 text-center text-sm text-muted-foreground"
        >
          {{ t('ai.workspaceFilePicker.noRoots') }}
        </div>

        <!-- 搜索结果模式 -->
        <div
          v-else-if="isSearching"
          class="mt-4 min-h-[280px] flex-1 overflow-y-auto rounded-xl border border-border/60 bg-background/45"
        >
          <div
            v-if="searchResults.length === 0"
            class="flex min-h-[260px] items-center justify-center px-6 py-8 text-center text-sm text-muted-foreground"
          >
            {{ t('ai.workspaceFilePicker.noMatches') }}
          </div>
          <div
            v-for="node in searchResults"
            :key="node.id"
            class="group flex cursor-pointer items-center gap-3 border-b border-border/35 px-3.5 py-2.5 text-sm last:border-b-0 hover:bg-muted/40"
            @click="toggleSelect(node)"
          >
            <input
              type="checkbox"
              :checked="selectedPaths.has(node.absolutePath)"
              class="h-4 w-4 rounded border-muted-foreground/30"
              @click.stop="toggleSelect(node)"
            />
            <File class="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground/70" />
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="truncate font-medium leading-tight text-foreground/90">{{ node.name }}</span>
              <span class="mt-0.5 truncate text-xs leading-tight text-muted-foreground">{{ node.path }}</span>
            </div>
          </div>
        </div>

        <!-- 树形浏览模式 -->
        <div
          v-else
          class="mt-4 min-h-[280px] flex-1 overflow-y-auto rounded-xl border border-border/60 bg-background/45"
        >
          <div
            v-for="node in treeNodes"
            :key="node.id"
            class="group flex min-h-10 cursor-pointer items-center gap-2 border-b border-border/30 px-3 py-2 text-sm last:border-b-0 hover:bg-muted/40"
            :class="node.isRootHeader ? 'bg-muted/20' : ''"
            :style="{ paddingLeft: node.isRootHeader ? '14px' : `${(node.depth + 1) * 18 + 14}px` }"
            @click="node.isDirectory ? toggleExpand(node) : toggleSelect(node)"
          >
            <!-- 根标题 -->
            <template v-if="node.isRootHeader">
              <FolderOpen class="h-4 w-4 shrink-0 text-blue-400" />
              <span class="truncate text-xs font-bold uppercase tracking-wide text-muted-foreground">{{ node.name }}</span>
            </template>

            <!-- 目录 -->
            <template v-else-if="node.isDirectory">
              <ChevronRight
                class="h-3 w-3 shrink-0 text-muted-foreground transition-transform"
                :class="{ 'rotate-90': localExpanded.has(node.id) }"
              />
              <Folder class="h-4 w-4 shrink-0 text-blue-400" />
              <span class="truncate text-foreground/85">{{ node.name }}</span>
            </template>

            <!-- 文件 -->
            <template v-else>
              <input
                type="checkbox"
                :checked="selectedPaths.has(node.absolutePath)"
                class="h-4 w-4 shrink-0 rounded border-muted-foreground/30"
                @click.stop="toggleSelect(node)"
              />
              <File class="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground/70" />
              <span class="truncate text-foreground/85">{{ node.name }}</span>
            </template>
          </div>
        </div>
      </div>

      <!-- 底部 -->
      <DialogFooter class="flex-row items-center justify-between gap-3 border-t border-border/40 bg-muted/10 px-6 py-4 sm:justify-between">
        <Button variant="ghost" size="sm" class="h-9" @click="browseSystem">
          <ExternalLink class="h-3.5 w-3.5 mr-1.5" />
          {{ t('ai.workspaceFilePicker.browseOther') }}
        </Button>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" class="h-9 min-w-20" @click="emit('close')">
            {{ t('common.cancel') }}
          </Button>
          <Button size="sm" class="h-9 min-w-20" :disabled="selectedCount === 0" @click="handleConfirm">
            {{ t('common.confirm') }}{{ selectedCount > 0 ? ` (${selectedCount})` : '' }}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
