<script setup lang="ts">
/**
 * Git 仓库管理视图 — 布局容器
 * 所有业务逻辑委托给子组件 + git-workspace store
 */
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import { useGitWorkspaceStore } from '@/stores/git-workspace'
import { useToast } from '@/composables/useToast'
import { gitGetDiffCommit } from '@/api/git'

// 子组件
import GitToolbar from '@/components/git/GitToolbar.vue'
import GitFileList from '@/components/git/GitFileList.vue'
import GitCommitBox from '@/components/git/GitCommitBox.vue'
import GitDiffViewer from '@/components/git/GitDiffViewer.vue'
import GitBranchPanel from '@/components/git/GitBranchPanel.vue'
import GitTagPanel from '@/components/git/GitTagPanel.vue'
import GitStashPanel from '@/components/git/GitStashPanel.vue'
import GitHistoryPanel from '@/components/git/GitHistoryPanel.vue'
import GitSearchPanel from '@/components/git/GitSearchPanel.vue'
import GitConflictBanner from '@/components/git/GitConflictBanner.vue'
import GitStatusBar from '@/components/git/GitStatusBar.vue'
import GitBlameView from '@/components/git/GitBlameView.vue'
import GitFileHistory from '@/components/git/GitFileHistory.vue'
import GitGraphView from '@/components/git/GitGraphView.vue'
import GitContributorsPanel from '@/components/git/GitContributorsPanel.vue'

const props = defineProps<{
  repositoryPath: string
}>()

const { t } = useI18n()
const toast = useToast()
const store = useGitWorkspaceStore()

// ── 工作区状态 ────────────────────────────────────────────────────
const ws = computed(() => store.getOrCreate(props.repositoryPath))
const activePanel = computed({
  get: () => ws.value.activePanel,
  set: (v) => store.update(props.repositoryPath, { activePanel: v }),
})

const panels = ['changes', 'branches', 'tags', 'stashes', 'history', 'graph', 'search', 'contributors'] as const

const totalChanges = computed(() => {
  const s = ws.value.status
  return (s?.staged.length ?? 0) + (s?.unstaged.length ?? 0) + (s?.untracked.length ?? 0)
})

// ── 生命周期 ─────────────────────────────────────────────────────
onMounted(async () => {
  try {
    await store.openRepo(props.repositoryPath)
  } catch (e) {
    toast.error(t('git.openFailed'), String(e))
  }
})

onBeforeUnmount(() => {
  store.cleanup(props.repositoryPath)
})

// ── 文件选择 + Diff 加载 ─────────────────────────────────────────
async function handleSelectFile(path: string, source: 'working' | 'staged') {
  store.selectFile(props.repositoryPath, path, source)
  await store.loadDiff(props.repositoryPath, source)
}

function handleSelectUntracked(path: string) {
  store.selectFile(props.repositoryPath, path, 'working')
  store.loadDiff(props.repositoryPath, 'working')
}

// ── 历史 Diff（LRU 缓存，避免重复请求同一 commit 的 diff） ────
const historyDiff = ref<import('@/types/git').GitDiff | null>(null)
const historyFileDiff = ref<import('@/types/git').GitFileDiff | null>(null)
const historySelectedFile = ref<string | null>(null)

const DIFF_CACHE_MAX = 20
const _diffCache = new Map<string, import('@/types/git').GitDiff>()

async function handleViewCommitDiff(hash: string) {
  try {
    let diff = _diffCache.get(hash)
    if (diff) {
      // LRU：移到末尾
      _diffCache.delete(hash)
      _diffCache.set(hash, diff)
    } else {
      diff = await gitGetDiffCommit(props.repositoryPath, hash)
      _diffCache.set(hash, diff)
      // 淘汰最旧条目
      if (_diffCache.size >= DIFF_CACHE_MAX) {
        _diffCache.delete(_diffCache.keys().next().value!)
      }
    }
    historyDiff.value = diff
    historyFileDiff.value = diff.files[0] ?? null
    historySelectedFile.value = historyFileDiff.value?.path ?? null
  } catch (e) {
    toast.error(t('git.diffFailed'), String(e))
  }
}

function selectHistoryFile(path: string) {
  historySelectedFile.value = path
  historyFileDiff.value = historyDiff.value?.files.find(f => f.path === path) ?? null
}

// ── 从提交历史创建分支/Tag ──────────────────────────────────────
async function handleCreateBranchFromCommit(hash: string) {
  const name = prompt(t('git.newBranchName'))
  if (!name) return
  try {
    await store.createBranch(props.repositoryPath, name, hash)
    toast.success(t('git.branchCreated', { name }))
  } catch (e) {
    toast.error(t('git.branchCreateFailed'), String(e))
  }
}

async function handleCreateTagFromCommit(hash: string) {
  const name = prompt(t('git.tagName'))
  if (!name) return
  try {
    await store.createTag(props.repositoryPath, name, undefined, hash)
    toast.success(t('git.tagCreated', { name }))
  } catch (e) {
    toast.error(t('git.tagCreateFailed'), String(e))
  }
}

async function handleCherryPick(hash: string) {
  try {
    const result = await store.cherryPick(props.repositoryPath, hash)
    if (result.success) {
      toast.success(t('git.cherryPickSuccess'))
    } else {
      toast.warning(t('git.mergeConflicts', { count: result.conflicts.length }))
    }
  } catch (e) {
    toast.error(t('git.cherryPickFailed'), String(e))
  }
}

// ── Blame / File History 浮层 ───────────────────────────────────
const blameFilePath = ref<string | null>(null)
const fileHistoryPath = ref<string | null>(null)

function handleViewBlame(path: string) {
  blameFilePath.value = path
  fileHistoryPath.value = null
}

function handleViewFileHistory(path: string) {
  fileHistoryPath.value = path
  blameFilePath.value = null
}

/** 文件名提取 */
function fileName(path: string) {
  return path.split('/').pop() ?? path
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
  <div class="flex h-full flex-col">
    <!-- 顶部工具栏 -->
    <GitToolbar :repo-path="repositoryPath" :workspace="ws" />

    <!-- 冲突提示 -->
    <GitConflictBanner :repo-path="repositoryPath" :workspace="ws" />

    <!-- 面板切换标签 -->
    <div class="flex border-b border-border bg-muted/20 px-1 gap-0.5">
      <button
        v-for="panel in panels"
        :key="panel"
        class="px-3 py-1.5 text-xs font-medium transition-colors border-b-2 rounded-t"
        :class="activePanel === panel
          ? 'border-primary text-primary bg-background'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/30'"
        @click="activePanel = panel"
      >
        {{ t(`git.panel.${panel}`) }}
        <span
          v-if="panel === 'changes' && totalChanges > 0"
          class="ml-1 inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-primary/10 text-primary text-[10px]"
        >
          {{ totalChanges }}
        </span>
      </button>
    </div>

    <!-- 主内容区 -->
    <div class="flex-1 min-h-0">
      <!-- Changes 面板 -->
      <Splitpanes v-if="activePanel === 'changes'" class="h-full">
        <Pane :size="35" :min-size="20">
          <div class="flex flex-col h-full">
            <GitFileList
              :repo-path="repositoryPath"
              :workspace="ws"
              class="flex-1 min-h-0"
              @select-file="handleSelectFile"
              @select-untracked="handleSelectUntracked"
              @view-blame="handleViewBlame"
              @view-file-history="handleViewFileHistory"
            />
            <GitCommitBox :repo-path="repositoryPath" :workspace="ws" />
          </div>
        </Pane>
        <Pane :size="65">
          <!-- Blame 浮层 -->
          <GitBlameView
            v-if="blameFilePath"
            :repo-path="repositoryPath"
            :file-path="blameFilePath"
            @close="blameFilePath = null"
            @view-commit="handleViewCommitDiff"
          />
          <!-- File History 浮层 -->
          <GitFileHistory
            v-else-if="fileHistoryPath"
            :repo-path="repositoryPath"
            :file-path="fileHistoryPath"
            @close="fileHistoryPath = null"
            @view-commit-diff="handleViewCommitDiff"
          />
          <!-- 默认 Diff -->
          <GitDiffViewer
            v-else
            :diff="ws.currentDiff"
            :file-diff="ws.selectedFileDiff"
          />
        </Pane>
      </Splitpanes>

      <!-- Branches 面板 -->
      <GitBranchPanel
        v-else-if="activePanel === 'branches'"
        :repo-path="repositoryPath"
        :workspace="ws"
        class="h-full"
      />

      <!-- Tags 面板 -->
      <GitTagPanel
        v-else-if="activePanel === 'tags'"
        :repo-path="repositoryPath"
        :workspace="ws"
        class="h-full"
      />

      <!-- Stashes 面板 -->
      <GitStashPanel
        v-else-if="activePanel === 'stashes'"
        :repo-path="repositoryPath"
        :workspace="ws"
        class="h-full"
      />

      <!-- History 面板 -->
      <Splitpanes v-else-if="activePanel === 'history'" class="h-full">
        <Pane :size="40" :min-size="25">
          <GitHistoryPanel
            :repo-path="repositoryPath"
            :workspace="ws"
            @view-commit-diff="handleViewCommitDiff"
            @cherry-pick="handleCherryPick"
            @create-branch="handleCreateBranchFromCommit"
            @create-tag="handleCreateTagFromCommit"
          />
        </Pane>
        <Pane :size="60">
          <div class="flex flex-col h-full">
            <!-- 提交 diff 文件选择 -->
            <div v-if="historyDiff && historyDiff.files.length > 0" class="border-b border-border">
              <div class="flex flex-wrap gap-1 p-1">
                <button
                  v-for="f in historyDiff.files" :key="f.path"
                  class="px-1.5 py-0.5 text-xs rounded border border-border/50 hover:bg-accent/50"
                  :class="{ 'bg-accent border-primary/30': historySelectedFile === f.path }"
                  @click="selectHistoryFile(f.path)"
                >
                  <span class="inline-block h-2.5 w-2.5 mr-0.5" :class="statusColor(f.status)">●</span>
                  {{ fileName(f.path) }}
                </button>
              </div>
            </div>
            <GitDiffViewer
              :diff="historyDiff"
              :file-diff="historyFileDiff"
              class="flex-1 min-h-0"
            />
          </div>
        </Pane>
      </Splitpanes>

      <!-- Graph 面板 -->
      <GitGraphView
        v-else-if="activePanel === 'graph'"
        :repo-path="repositoryPath"
        class="h-full"
        @view-commit-diff="handleViewCommitDiff"
        @cherry-pick="handleCherryPick"
        @create-branch="handleCreateBranchFromCommit"
        @create-tag="handleCreateTagFromCommit"
      />

      <!-- Search 面板 -->
      <GitSearchPanel
        v-else-if="activePanel === 'search'"
        :repo-path="repositoryPath"
        class="h-full"
        @view-commit-diff="handleViewCommitDiff"
      />

      <!-- Contributors 面板 -->
      <GitContributorsPanel
        v-else-if="activePanel === 'contributors'"
        :repo-path="repositoryPath"
        class="h-full"
      />
    </div>

    <!-- 底部状态栏 -->
    <GitStatusBar :workspace="ws" />
  </div>
</template>
