<script setup lang="ts">
import { ref, computed, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useGitWorkspaceStore, type GitWorkspaceState } from '@/stores/git-workspace'
import { useToast } from '@/composables/useToast'
import { parseBackendError } from '@/types/error'
import {
  Plus, Check, Trash2, Merge, GitFork,
  GitBranch as GitBranchIcon,
} from 'lucide-vue-next'

const props = defineProps<{
  repoPath: string
  workspace: GitWorkspaceState
}>()

const { t } = useI18n()
const toast = useToast()
const store = useGitWorkspaceStore()

const showBranchInput = ref(false)
const newBranchName = ref('')

// 预计算本地/远程分支，避免模板中重复 filter
const localBranches = computed(() => props.workspace.branches.filter(x => x.isLocal))
const remoteBranches = computed(() => props.workspace.branches.filter(x => !x.isLocal))

// 右键菜单
const contextMenu = ref<{ x: number; y: number; branch: string; isCurrent: boolean; isLocal: boolean } | null>(null)
const contextMenuRef = ref<HTMLDivElement>()

function closeCtxMenu() {
  contextMenu.value = null
  document.removeEventListener('click', closeCtxMenu)
}

function showCtxMenu(e: MouseEvent, name: string, isCurrent: boolean, isLocal: boolean) {
  e.preventDefault()
  closeCtxMenu()
  contextMenu.value = { x: e.clientX, y: e.clientY, branch: name, isCurrent, isLocal }
  setTimeout(() => document.addEventListener('click', closeCtxMenu), 0)
  nextTick(() => contextMenuRef.value?.querySelector<HTMLElement>('button')?.focus())
}

onBeforeUnmount(() => {
  document.removeEventListener('click', closeCtxMenu)
})

async function handleCreateBranch() {
  if (!newBranchName.value.trim()) return
  try {
    await store.createBranch(props.repoPath, newBranchName.value)
    toast.success(t('git.branchCreated', { name: newBranchName.value }))
    newBranchName.value = ''
    showBranchInput.value = false
  } catch (e) {
    toast.error(t('git.branchCreateFailed'), parseBackendError(e).message)
  }
}

async function handleCheckout(name: string) {
  try {
    await store.checkoutBranch(props.repoPath, name)
    toast.success(t('git.branchSwitched', { name }))
  } catch (e) {
    toast.error(t('git.branchSwitchFailed'), parseBackendError(e).message)
  }
}

async function handleDelete(name: string) {
  try {
    await store.deleteBranch(props.repoPath, name)
    toast.success(t('git.branchDeleted', { name }))
  } catch (e) {
    toast.error(t('git.branchDeleteFailed'), parseBackendError(e).message)
  }
}

async function handleMerge(name: string) {
  try {
    const result = await store.mergeBranch(props.repoPath, name)
    if (result.success) {
      toast.success(t('git.mergeSuccess', { name }))
    } else {
      toast.warning(t('git.mergeConflicts', { count: result.conflicts.length }))
    }
  } catch (e) {
    toast.error(t('git.mergeFailed'), parseBackendError(e).message)
  }
}

async function handleRebase(name: string) {
  try {
    await store.rebaseBranch(props.repoPath, name)
    toast.success(t('git.rebaseSuccess', { name }))
  } catch (e) {
    toast.error(t('git.rebaseFailed'), parseBackendError(e).message)
  }
}

function copyName(name: string) {
  navigator.clipboard.writeText(name)
  toast.success(t('git.nameCopied'))
}
</script>

<template>
  <ScrollArea class="h-full">
    <div class="p-3 space-y-2">
      <!-- 新建分支 -->
      <div class="flex items-center gap-2">
        <Input
          v-if="showBranchInput"
          v-model="newBranchName"
          :placeholder="t('git.newBranchName')"
          :aria-label="t('git.newBranchName')"
          class="h-8 text-xs flex-1"
          @keydown.enter="handleCreateBranch"
          @keydown.escape="showBranchInput = false"
          autofocus
        />
        <Button v-if="showBranchInput" size="sm" class="h-8 text-xs" @click="handleCreateBranch">
          <Check class="h-3.5 w-3.5" />
        </Button>
        <Button v-else variant="outline" size="sm" class="h-8 text-xs" @click="showBranchInput = true">
          <Plus class="h-3.5 w-3.5 mr-1" /> {{ t('git.newBranch') }}
        </Button>
      </div>

      <!-- 本地分支 -->
      <div>
        <h3 class="text-xs font-medium text-muted-foreground mb-1 px-2 py-1 bg-muted/20 rounded">{{ t('git.localBranches') }}</h3>
        <div
          v-for="b in localBranches" :key="b.name"
          class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/50 text-xs cursor-pointer"
          :class="{ 'bg-primary/10': b.isCurrent }"
          @dblclick="!b.isCurrent && handleCheckout(b.name)"
          @contextmenu="showCtxMenu($event, b.name, b.isCurrent, true)"
        >
          <GitBranchIcon class="h-3.5 w-3.5 shrink-0" :class="b.isCurrent ? 'text-primary' : 'text-muted-foreground'" />
          <span class="flex-1 truncate" :class="{ 'font-semibold text-primary': b.isCurrent }">
            {{ b.name }}
          </span>
          <span v-if="b.ahead > 0" class="text-[10px] text-df-success">&uarr;{{ b.ahead }}</span>
          <span v-if="b.behind > 0" class="text-[10px] text-df-warning">&darr;{{ b.behind }}</span>
          <Button v-if="!b.isCurrent" variant="ghost" size="icon" class="h-6 w-6"
            @click="handleCheckout(b.name)" :title="t('git.checkout')">
            <Check class="h-3.5 w-3.5" />
          </Button>
          <Button v-if="!b.isCurrent" variant="ghost" size="icon" class="h-6 w-6 text-destructive"
            @click="handleDelete(b.name)" :title="t('git.delete')">
            <Trash2 class="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <!-- 远程分支 -->
      <div v-if="remoteBranches.length > 0">
        <h3 class="text-xs font-medium text-muted-foreground mb-1 px-2 py-1 bg-muted/20 rounded">{{ t('git.remoteBranches') }}</h3>
        <div
          v-for="b in remoteBranches" :key="b.name"
          class="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-muted-foreground hover:bg-accent/30 cursor-default"
          @contextmenu="showCtxMenu($event, b.name, false, false)"
        >
          <GitBranchIcon class="h-3.5 w-3.5 shrink-0" />
          <span class="flex-1 truncate">{{ b.name }}</span>
        </div>
      </div>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        ref="contextMenuRef"
        class="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-md"
        role="menu"
        @keydown.escape="closeCtxMenu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      >
        <button
          v-if="!contextMenu.isCurrent && contextMenu.isLocal"
          role="menuitem" class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="handleCheckout(contextMenu!.branch)"
        >
          <Check class="h-3 w-3" /> {{ t('git.checkout') }}
        </button>
        <button
          v-if="!contextMenu.isCurrent"
          role="menuitem" class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="handleMerge(contextMenu!.branch)"
        >
          <Merge class="h-3 w-3" /> {{ t('git.mergeIntoCurrent') }}
        </button>
        <button
          v-if="!contextMenu.isCurrent"
          role="menuitem" class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="handleRebase(contextMenu!.branch)"
        >
          <GitFork class="h-3 w-3" /> {{ t('git.rebaseOnto') }}
        </button>
        <div v-if="!contextMenu.isCurrent && contextMenu.isLocal" class="h-px bg-border my-1" />
        <button
          v-if="!contextMenu.isCurrent && contextMenu.isLocal"
          role="menuitem" class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent text-destructive"
          @click="handleDelete(contextMenu!.branch)"
        >
          <Trash2 class="h-3 w-3" /> {{ t('git.delete') }}
        </button>
        <div class="h-px bg-border my-1" />
        <button
          role="menuitem" class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="copyName(contextMenu!.branch)"
        >
          {{ t('git.copyBranchName') }}
        </button>
      </div>
    </Teleport>
  </ScrollArea>
</template>
