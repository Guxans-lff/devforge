<script setup lang="ts">
import { computed, ref, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useGitWorkspaceStore, type GitWorkspaceState } from '@/stores/git-workspace'
import { useToast } from '@/composables/useToast'
import {
  Plus, Minus, ChevronDown, ChevronRight,
  FilePlus, FileX, FileEdit, AlertTriangle, Undo2,
} from 'lucide-vue-next'

const props = defineProps<{
  repoPath: string
  workspace: GitWorkspaceState
}>()

const emit = defineEmits<{
  selectFile: [path: string, source: 'working' | 'staged']
  selectUntracked: [path: string]
  viewBlame: [path: string]
  viewFileHistory: [path: string]
}>()

const { t } = useI18n()
const toast = useToast()
const store = useGitWorkspaceStore()

const expandedSections = ref<Record<string, boolean>>({
  staged: true,
  unstaged: true,
  untracked: true,
})

const stagedCount = computed(() => props.workspace.status?.staged.length ?? 0)
const unstagedCount = computed(() => props.workspace.status?.unstaged.length ?? 0)
const untrackedCount = computed(() => props.workspace.status?.untracked.length ?? 0)

// ── 右键菜单 ──────────────────────────────────────────────────────
const contextMenu = ref<{ x: number; y: number; file: string; source: 'working' | 'staged' | 'untracked' } | null>(null)

function closeContextMenu() {
  contextMenu.value = null
  document.removeEventListener('click', closeContextMenu)
}

function showContextMenu(e: MouseEvent, file: string, source: 'working' | 'staged' | 'untracked') {
  e.preventDefault()
  // 先关闭旧的
  closeContextMenu()
  contextMenu.value = { x: e.clientX, y: e.clientY, file, source }
  setTimeout(() => document.addEventListener('click', closeContextMenu), 0)
}

onBeforeUnmount(() => {
  document.removeEventListener('click', closeContextMenu)
})

// ── 操作 ──────────────────────────────────────────────────────────
async function handleStageFile(filePath: string) {
  try {
    await store.stageFile(props.repoPath, filePath)
  } catch (e) {
    toast.error(t('git.stageFailed'), String(e))
  }
}

async function handleUnstageFile(filePath: string) {
  try {
    await store.unstageFile(props.repoPath, filePath)
  } catch (e) {
    toast.error(t('git.unstageFailed'), String(e))
  }
}

async function handleStageAll() {
  try {
    await store.stageAll(props.repoPath)
  } catch (e) {
    toast.error(t('git.stageFailed'), String(e))
  }
}

async function handleUnstageAll() {
  try {
    await store.unstageAll(props.repoPath)
  } catch (e) {
    toast.error(t('git.unstageFailed'), String(e))
  }
}

async function handleDiscardFile(filePath: string) {
  try {
    await store.discardFile(props.repoPath, filePath)
    toast.success(t('git.discardSuccess'))
  } catch (e) {
    toast.error(t('git.discardFailed'), String(e))
  }
}

function copyPath(path: string) {
  navigator.clipboard.writeText(path)
  toast.success(t('git.pathCopied'))
}

// ── 工具函数 ──────────────────────────────────────────────────────
function toggleSection(key: string) {
  expandedSections.value[key] = !expandedSections.value[key]
}

function fileName(path: string) {
  return path.split('/').pop() ?? path
}

function statusIcon(s: string) {
  switch (s) {
    case 'added': return FilePlus
    case 'deleted': return FileX
    case 'modified': return FileEdit
    case 'conflicted': return AlertTriangle
    default: return FileEdit
  }
}

function statusColor(s: string) {
  switch (s) {
    case 'added': return 'text-green-500'
    case 'deleted': return 'text-red-500'
    case 'modified': return 'text-yellow-500'
    case 'conflicted': return 'text-orange-500'
    default: return 'text-muted-foreground'
  }
}
</script>

<template>
  <ScrollArea class="h-full">
    <div class="p-2 space-y-1">
      <!-- Staged -->
      <div>
        <button
          class="flex items-center w-full px-1.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground bg-muted/20 rounded"
          @click="toggleSection('staged')"
        >
          <component :is="expandedSections.staged ? ChevronDown : ChevronRight" class="h-3.5 w-3.5 mr-1" />
          {{ t('git.staged') }} ({{ stagedCount }})
          <Button v-if="stagedCount > 0" variant="ghost" size="icon" class="h-6 w-6 ml-auto" @click.stop="handleUnstageAll" :title="t('git.unstageAll')">
            <Minus class="h-3.5 w-3.5" />
          </Button>
        </button>
        <div v-if="expandedSections.staged && workspace.status?.staged.length">
          <div
            v-for="f in workspace.status.staged" :key="'s-' + f.path"
            class="group flex items-center gap-1.5 px-2 py-1.5 text-xs cursor-pointer rounded hover:bg-accent/50 border-l-2"
            :class="workspace.selectedFile === f.path && workspace.selectedDiffSource === 'staged' ? 'bg-accent border-primary' : 'border-transparent'"
            @click="emit('selectFile', f.path, 'staged')"
            @contextmenu="showContextMenu($event, f.path, 'staged')"
          >
            <component :is="statusIcon(f.status)" class="h-3.5 w-3.5 shrink-0" :class="statusColor(f.status)" />
            <span class="truncate flex-1" :title="f.path">{{ fileName(f.path) }}</span>
            <Button variant="ghost" size="icon" class="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100" @click.stop="handleUnstageFile(f.path)">
              <Minus class="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <!-- Unstaged -->
      <div>
        <button
          class="flex items-center w-full px-1.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground bg-muted/20 rounded"
          @click="toggleSection('unstaged')"
        >
          <component :is="expandedSections.unstaged ? ChevronDown : ChevronRight" class="h-3.5 w-3.5 mr-1" />
          {{ t('git.unstaged') }} ({{ unstagedCount }})
          <Button v-if="unstagedCount > 0 || untrackedCount > 0" variant="ghost" size="icon" class="h-6 w-6 ml-auto" @click.stop="handleStageAll" :title="t('git.stageAll')">
            <Plus class="h-3.5 w-3.5" />
          </Button>
        </button>
        <div v-if="expandedSections.unstaged && workspace.status?.unstaged.length">
          <div
            v-for="f in workspace.status.unstaged" :key="'u-' + f.path"
            class="group flex items-center gap-1.5 px-2 py-1.5 text-xs cursor-pointer rounded hover:bg-accent/50 border-l-2"
            :class="workspace.selectedFile === f.path && workspace.selectedDiffSource === 'working' ? 'bg-accent border-primary' : 'border-transparent'"
            @click="emit('selectFile', f.path, 'working')"
            @contextmenu="showContextMenu($event, f.path, 'working')"
          >
            <component :is="statusIcon(f.status)" class="h-3.5 w-3.5 shrink-0" :class="statusColor(f.status)" />
            <span class="truncate flex-1" :title="f.path">{{ fileName(f.path) }}</span>
            <div class="flex shrink-0 opacity-0 group-hover:opacity-100">
              <Button variant="ghost" size="icon" class="h-6 w-6" @click.stop="handleDiscardFile(f.path)" :title="t('git.discard')">
                <Undo2 class="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" class="h-6 w-6" @click.stop="handleStageFile(f.path)" :title="t('git.stage')">
                <Plus class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <!-- Untracked -->
      <div v-if="workspace.status?.untracked.length">
        <button
          class="flex items-center w-full px-1.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground bg-muted/20 rounded"
          @click="toggleSection('untracked')"
        >
          <component :is="expandedSections.untracked ? ChevronDown : ChevronRight" class="h-3.5 w-3.5 mr-1" />
          {{ t('git.untracked') }} ({{ untrackedCount }})
        </button>
        <div v-if="expandedSections.untracked">
          <div
            v-for="f in workspace.status.untracked" :key="'t-' + f"
            class="group flex items-center gap-1.5 px-2 py-1.5 text-xs cursor-pointer rounded hover:bg-accent/50"
            @click="emit('selectUntracked', f)"
            @contextmenu="showContextMenu($event, f, 'untracked')"
          >
            <FilePlus class="h-3.5 w-3.5 shrink-0 text-green-500" />
            <span class="truncate flex-1" :title="f">{{ fileName(f) }}</span>
            <Button variant="ghost" size="icon" class="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100" @click.stop="handleStageFile(f)">
              <Plus class="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <!-- 无变更 -->
      <div v-if="stagedCount === 0 && unstagedCount === 0 && untrackedCount === 0" class="px-2 py-4 text-center text-xs text-muted-foreground">
        {{ t('git.noChanges') }}
      </div>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-md"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      >
        <button
          v-if="contextMenu.source === 'working' || contextMenu.source === 'untracked'"
          class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="handleStageFile(contextMenu!.file)"
        >
          <Plus class="h-3 w-3" /> {{ t('git.stage') }}
        </button>
        <button
          v-if="contextMenu.source === 'staged'"
          class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="handleUnstageFile(contextMenu!.file)"
        >
          <Minus class="h-3 w-3" /> {{ t('git.unstage') }}
        </button>
        <button
          v-if="contextMenu.source === 'working'"
          class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent text-destructive"
          @click="handleDiscardFile(contextMenu!.file)"
        >
          <Undo2 class="h-3 w-3" /> {{ t('git.discardChanges') }}
        </button>
        <div class="h-px bg-border my-1" />
        <button
          class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="emit('viewBlame', contextMenu!.file)"
        >
          {{ t('git.viewBlame') }}
        </button>
        <button
          class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="emit('viewFileHistory', contextMenu!.file)"
        >
          {{ t('git.viewFileHistory') }}
        </button>
        <div class="h-px bg-border my-1" />
        <button
          class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="copyPath(contextMenu!.file)"
        >
          {{ t('git.copyPath') }}
        </button>
      </div>
    </Teleport>
  </ScrollArea>
</template>
