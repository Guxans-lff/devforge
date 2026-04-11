<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { useGitWorkspaceStore, type GitWorkspaceState } from '@/stores/git-workspace'
import { useToast } from '@/composables/useToast'
import { parseBackendError } from '@/types/error'
import { formatTimestamp as formatTime } from '@/composables/useGitUtils'
import type { GitCommit } from '@/types/git'
import { Loader2, Copy, Tag, GitBranch as GitBranchIcon, ArrowDownUp } from 'lucide-vue-next'

const props = defineProps<{
  repoPath: string
  workspace: GitWorkspaceState
}>()

const emit = defineEmits<{
  viewCommitDiff: [hash: string]
  cherryPick: [hash: string]
  createBranch: [hash: string]
  createTag: [hash: string]
  interactiveRebase: [hash: string]
}>()

const { t } = useI18n()
const toast = useToast()
const store = useGitWorkspaceStore()

const loadingMore = ref(false)
const selectedHash = ref<string | null>(null)
const scrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null)

// ── 虚拟滚动 ───────────────────────────────────────────────────
const ROW_HEIGHT = 52 // 每行大约高度 px
const OVERSCAN = 8
const scrollTop = ref(0)
const viewportHeight = ref(600)

const visibleCommits = computed(() => {
  const commits = props.workspace.commits
  if (!commits.length) return []
  const startIdx = Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN)
  const endIdx = Math.min(commits.length, Math.ceil((scrollTop.value + viewportHeight.value) / ROW_HEIGHT) + OVERSCAN)
  return commits.slice(startIdx, endIdx).map((c, i) => ({ commit: c, idx: startIdx + i }))
})

const totalHeight = computed(() => props.workspace.commits.length * ROW_HEIGHT)

// 右键菜单
const contextMenu = ref<{ x: number; y: number; commit: GitCommit } | null>(null)
const contextMenuRef = ref<HTMLDivElement>()

function closeCtxMenu() {
  contextMenu.value = null
  document.removeEventListener('click', closeCtxMenu)
}

function showCtxMenu(e: MouseEvent, commit: GitCommit) {
  e.preventDefault()
  closeCtxMenu()
  contextMenu.value = { x: e.clientX, y: e.clientY, commit }
  setTimeout(() => document.addEventListener('click', closeCtxMenu), 0)
  nextTick(() => contextMenuRef.value?.querySelector<HTMLElement>('button')?.focus())
}

onBeforeUnmount(() => {
  document.removeEventListener('click', closeCtxMenu)
  const viewport = scrollAreaRef.value?.$el?.querySelector('[data-slot="scroll-area-viewport"]')
  if (viewport) {
    viewport.removeEventListener('scroll', onScroll)
  }
})

function handleViewDiff(hash: string) {
  selectedHash.value = hash
  emit('viewCommitDiff', hash)
}

async function handleLoadMore() {
  if (loadingMore.value || !props.workspace.hasMoreCommits) return
  loadingMore.value = true
  try {
    await store.loadMoreCommits(props.repoPath)
  } catch (e) {
    toast.error(t('git.loadMoreFailed'), parseBackendError(e).message)
  } finally {
    loadingMore.value = false
  }
}

function copyHash(hash: string) {
  navigator.clipboard.writeText(hash)
  toast.success(t('git.hashCopied'))
}

function copyMessage(msg: string) {
  navigator.clipboard.writeText(msg)
  toast.success(t('git.messageCopied'))
}

/** 检测滚动到底部自动加载 + 虚拟滚动追踪（rAF 节流） */
let scrollRafId: number | null = null
function onScroll(e: Event) {
  if (scrollRafId !== null) return
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = null
    const el = e.target as HTMLElement
    scrollTop.value = el.scrollTop
    viewportHeight.value = el.clientHeight
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
      handleLoadMore()
    }
  })
}

// 挂载后绑定滚动事件到 ScrollArea 的 viewport 元素
onMounted(() => {
  const viewport = scrollAreaRef.value?.$el?.querySelector('[data-slot="scroll-area-viewport"]')
  if (viewport) {
    viewport.addEventListener('scroll', onScroll)
  }
})
</script>

<template>
  <ScrollArea ref="scrollAreaRef" class="h-full">
    <div class="relative" :style="{ minHeight: totalHeight + 'px' }">
      <div class="p-2">
        <div
          v-for="c in visibleCommits" :key="c.commit.hash"
          class="absolute left-0 right-0 flex flex-col gap-0.5 px-4 py-1.5 rounded cursor-pointer hover:bg-accent/50 text-xs"
          :class="{ 'bg-accent': selectedHash === c.commit.hash }"
          :style="{ top: c.idx * ROW_HEIGHT + 'px', height: ROW_HEIGHT + 'px' }"
          @click="handleViewDiff(c.commit.hash)"
          @contextmenu="showCtxMenu($event, c.commit)"
        >
          <div class="flex items-center gap-1.5">
            <span class="font-mono text-primary text-xs shrink-0">{{ c.commit.shortHash }}</span>
            <span class="truncate font-medium">{{ c.commit.message }}</span>
          </div>
          <div class="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{{ c.commit.author }}</span>
            <span>{{ formatTime(c.commit.timestamp) }}</span>
            <span
              v-for="r in c.commit.refs" :key="r.name"
              class="px-1 py-0 rounded text-[10px] font-mono"
              :class="{
                'bg-primary/10 text-primary': r.refType === 'branch',
                'bg-df-warning/10 text-df-warning': r.refType === 'tag',
                'bg-df-success/10 text-df-success': r.refType === 'HEAD',
                'bg-df-info/10 text-df-info': r.refType === 'remote',
              }"
            >
              {{ r.name }}
            </span>
          </div>
        </div>
      </div>

      <!-- 加载更多 -->
      <div
        v-if="workspace.hasMoreCommits"
        class="absolute left-0 right-0 flex justify-center py-2"
        :style="{ top: totalHeight + 'px' }"
      >
        <Button
          variant="ghost" size="sm" class="h-7 text-xs"
          :disabled="loadingMore"
          @click="handleLoadMore"
        >
          <Loader2 v-if="loadingMore" class="h-3.5 w-3.5 animate-spin mr-1" />
          {{ t('git.loadMore') }}
        </Button>
      </div>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        ref="contextMenuRef"
        class="fixed z-50 min-w-[180px] rounded-md border border-border bg-popover p-1 shadow-md"
        role="menu"
        @keydown.escape="closeCtxMenu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      >
        <button
          role="menuitem" class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="handleViewDiff(contextMenu!.commit.hash)"
        >
          {{ t('git.viewDiff') }}
        </button>
        <button
          role="menuitem" class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="copyHash(contextMenu!.commit.hash)"
        >
          <Copy class="h-3.5 w-3.5" /> {{ t('git.copyHash') }}
        </button>
        <button
          role="menuitem" class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="copyMessage(contextMenu!.commit.message)"
        >
          <Copy class="h-3.5 w-3.5" /> {{ t('git.copyMessage') }}
        </button>
        <div class="h-px bg-border my-1" />
        <button
          role="menuitem" class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="emit('createBranch', contextMenu!.commit.hash)"
        >
          <GitBranchIcon class="h-3.5 w-3.5" /> {{ t('git.createBranchHere') }}
        </button>
        <button
          role="menuitem" class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="emit('createTag', contextMenu!.commit.hash)"
        >
          <Tag class="h-3.5 w-3.5" /> {{ t('git.createTagHere') }}
        </button>
        <button
          role="menuitem" class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="emit('cherryPick', contextMenu!.commit.hash)"
        >
          {{ t('git.cherryPick') }}
        </button>
        <button
          role="menuitem" class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="emit('interactiveRebase', contextMenu!.commit.hash)"
        >
          <ArrowDownUp class="h-3.5 w-3.5" /> {{ t('git.rebaseToHere') }}
        </button>
      </div>
    </Teleport>
  </ScrollArea>
</template>
