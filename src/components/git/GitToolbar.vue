<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useGitWorkspaceStore, type GitWorkspaceState } from '@/stores/git-workspace'
import { useToast } from '@/composables/useToast'
import { parseBackendError } from '@/types/error'
import { confirmGitRisk } from '@/composables/git/gitRisk'
import {
  RefreshCw, FolderOpen, Upload, Download, RotateCw,
  GitBranch as GitBranchIcon, ArrowUpCircle, ArrowDownCircle,
  Loader2,
} from 'lucide-vue-next'

const props = defineProps<{
  repoPath: string
  workspace: GitWorkspaceState
}>()

const { t } = useI18n()
const toast = useToast()
const store = useGitWorkspaceStore()

const currentBranch = computed(() => props.workspace.status?.currentBranch ?? '—')
const ahead = computed(() => props.workspace.status?.ahead ?? 0)
const behind = computed(() => props.workspace.status?.behind ?? 0)
const isLoading = computed(() => props.workspace.loading)
const operating = computed(() => props.workspace.operating)

/** 获取默认 remote 名称 */
const defaultRemote = computed(() => {
  const remotes = props.workspace.remotes
  if (remotes.length === 0) return 'origin'
  return remotes.find(r => r.name === 'origin')?.name ?? remotes[0]?.name ?? 'origin'
})

async function handleRefresh() {
  try {
    await store.refresh(props.repoPath)
  } catch (e) {
    toast.error(t('git.refreshFailed'), parseBackendError(e).message)
  }
}

async function handlePush(force = false) {
  if (force && !confirmGitRisk({
    operation: 'force_push',
    remote: defaultRemote.value,
    branch: currentBranch.value,
  })) return
  try {
    const msg = await store.push(props.repoPath, defaultRemote.value, currentBranch.value, force)
    toast.success(t('git.pushSuccess'), msg)
  } catch (e) {
    toast.error(t('git.pushFailed'), parseBackendError(e).message)
  }
}

async function handlePull() {
  if (!confirmGitRisk({ operation: 'pull', remote: defaultRemote.value, branch: currentBranch.value })) return
  try {
    const msg = await store.pull(props.repoPath, defaultRemote.value, currentBranch.value)
    toast.success(t('git.pullSuccess'), msg)
  } catch (e) {
    toast.error(t('git.pullFailed'), parseBackendError(e).message)
  }
}

async function handleFetch() {
  try {
    const msg = await store.fetch(props.repoPath, defaultRemote.value)
    toast.success(t('git.fetchSuccess'), msg)
  } catch (e) {
    toast.error(t('git.fetchFailed'), parseBackendError(e).message)
  }
}
</script>

<template>
  <div class="flex items-center gap-2 border-b border-border px-3 py-1.5 bg-muted/30">
    <!-- 仓库路径 -->
    <FolderOpen class="h-4 w-4 text-muted-foreground shrink-0" />
    <span class="text-xs text-muted-foreground truncate max-w-[300px]" :title="repoPath">
      {{ repoPath }}
    </span>

    <!-- 当前分支 -->
    <div class="flex items-center gap-1 ml-2">
      <GitBranchIcon class="h-3.5 w-3.5 text-primary" />
      <span class="text-xs font-medium text-primary">{{ currentBranch }}</span>
    </div>

    <!-- Ahead / Behind -->
    <div v-if="workspace.status" class="flex items-center gap-2 ml-1 text-xs text-muted-foreground">
      <span v-if="ahead > 0" class="flex items-center gap-0.5 text-df-success">
        <ArrowUpCircle class="h-3.5 w-3.5" /> {{ ahead }}
      </span>
      <span v-if="behind > 0" class="flex items-center gap-0.5 text-df-warning">
        <ArrowDownCircle class="h-3.5 w-3.5" /> {{ behind }}
      </span>
    </div>

    <!-- 操作中指示 -->
    <div v-if="operating" class="flex items-center gap-1 ml-2 text-xs text-muted-foreground">
      <Loader2 class="h-3.5 w-3.5 animate-spin" />
      <span>{{ operating }}...</span>
    </div>

    <div class="flex-1" />

    <!-- Push / Pull / Fetch 按钮 -->
    <TooltipProvider :delay-duration="300">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost" size="icon" class="h-7 w-7"
            :disabled="!!operating"
            :aria-label="t('git.fetch')"
            @click="handleFetch"
          >
            <RotateCw class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent><p class="text-xs">{{ t('git.fetch') }}</p></TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost" size="icon" class="h-7 w-7 relative"
            :disabled="!!operating"
            :aria-label="t('git.pull')"
            @click="handlePull"
          >
            <Download class="h-3.5 w-3.5" />
            <span v-if="behind > 0"
              class="absolute -top-0.5 -right-0.5 h-3.5 min-w-[14px] px-0.5 rounded-full bg-df-warning text-primary-foreground text-[10px] flex items-center justify-center">
              {{ behind }}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent><p class="text-xs">{{ t('git.pull') }}</p></TooltipContent>
      </Tooltip>

      <div class="h-4 w-px bg-border/30" />

      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost" size="icon" class="h-7 w-7 relative"
            :disabled="!!operating"
            :aria-label="t('git.push')"
            @click="handlePush()"
          >
            <Upload class="h-3.5 w-3.5" />
            <span v-if="ahead > 0"
              class="absolute -top-0.5 -right-0.5 h-3.5 min-w-[14px] px-0.5 rounded-full bg-df-success text-primary-foreground text-[10px] flex items-center justify-center">
              {{ ahead }}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent><p class="text-xs">{{ t('git.push') }}</p></TooltipContent>
      </Tooltip>

      <div class="h-4 w-px bg-border/30" />

      <!-- 刷新 -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon" class="h-7 w-7" :aria-label="t('git.refresh')" @click="handleRefresh" :disabled="isLoading">
            <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': isLoading }" />
          </Button>
        </TooltipTrigger>
        <TooltipContent><p class="text-xs">{{ t('git.refresh') }}</p></TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
</template>
