import { defineStore } from 'pinia'
import { shallowRef, triggerRef } from 'vue'
import type {
  GitRepositoryInfo,
  GitStatus,
  GitBranch,
  GitTag,
  GitRemote,
  GitStash,
  GitCommit,
  GitGraph,
  GitDiff,
  GitFileDiff,
  GitConfig,
  GitMergeResult,
} from '@/types/git'
import {
  gitOpen,
  gitGetStatus,
  gitGetBranches,
  gitGetTags,
  gitGetRemotes,
  gitGetStashes,
  gitGetCommits,
  gitGetGraph,
  gitGetDiffWorking,
  gitGetDiffStaged,
  gitGetDiffCommit,
  gitStageFile,
  gitUnstageFile,
  gitStageAll,
  gitUnstageAll,
  gitCommit,
  gitAmendCommit,
  gitPush,
  gitPull,
  gitFetch,
  gitMergeBranch,
  gitAbortMerge,
  gitRebaseBranch,
  gitAbortRebase,
  gitDiscardFile,
  gitDiscardAll,
  gitGetConfig,
  gitCreateBranch,
  gitDeleteBranch,
  gitCheckoutBranch,
  gitCreateTag,
  gitDeleteTag,
  gitCreateStash,
  gitApplyStash,
  gitDropStash,
  gitPopStash,
  gitCherryPick,
  gitSearchCommits,
  gitGetFileContent,
} from '@/api/git'

/** 单个 Git 仓库的工作区状态 */
export interface GitWorkspaceState {
  repoPath: string
  repoInfo: GitRepositoryInfo | null
  status: GitStatus | null
  branches: GitBranch[]
  tags: GitTag[]
  remotes: GitRemote[]
  stashes: GitStash[]
  commits: GitCommit[]
  graph: GitGraph | null
  config: GitConfig | null
  /** 当前选中的文件路径 */
  selectedFile: string | null
  /** Diff 来源：working / staged / commit */
  selectedDiffSource: 'working' | 'staged' | 'commit'
  /** 当前 Diff 数据 */
  currentDiff: GitDiff | null
  /** 当前选中文件的 Diff */
  selectedFileDiff: GitFileDiff | null
  /** 活动面板 */
  activePanel: 'changes' | 'branches' | 'stashes' | 'history' | 'tags' | 'search' | 'graph' | 'contributors'
  /** 提交消息 */
  commitMessage: string
  /** Amend 模式 */
  isAmend: boolean
  /** 全局加载状态 */
  loading: boolean
  /** 操作中状态（push/pull/fetch 等） */
  operating: string | null
  /** 提交历史分页 */
  commitsPage: number
  /** 是否还有更多提交 */
  hasMoreCommits: boolean
  /** 是否正在加载更多提交 */
  loadingCommits: boolean
}

const COMMITS_PAGE_SIZE = 50

/** 创建默认工作区状态 */
function createDefaultState(repoPath: string): GitWorkspaceState {
  return {
    repoPath,
    repoInfo: null,
    status: null,
    branches: [],
    tags: [],
    remotes: [],
    stashes: [],
    commits: [],
    graph: null,
    config: null,
    selectedFile: null,
    selectedDiffSource: 'working',
    currentDiff: null,
    selectedFileDiff: null,
    activePanel: 'changes',
    commitMessage: '',
    isAmend: false,
    loading: false,
    operating: null,
    commitsPage: 0,
    hasMoreCommits: true,
    loadingCommits: false,
  }
}

export const useGitWorkspaceStore = defineStore('git-workspace', () => {
  /** 每个仓库路径对应一个工作区（shallowRef 避免深度响应式代理开销） */
  const workspaces = shallowRef<Map<string, GitWorkspaceState>>(new Map())

  /** 获取或创建工作区 */
  function getOrCreate(repoPath: string): GitWorkspaceState {
    const existing = workspaces.value.get(repoPath)
    if (existing) return existing

    const state = createDefaultState(repoPath)
    workspaces.value.set(repoPath, state)
    triggerRef(workspaces)
    return state
  }

  /** 获取工作区（不创建） */
  function get(repoPath: string): GitWorkspaceState | undefined {
    return workspaces.value.get(repoPath)
  }

  /** 更新工作区状态（创建新对象以确保 shallowRef 响应式传播到子组件） */
  function update(repoPath: string, partial: Partial<GitWorkspaceState>) {
    const ws = workspaces.value.get(repoPath)
    if (!ws) return
    workspaces.value.set(repoPath, { ...ws, ...partial })
    triggerRef(workspaces)
  }

  // ── 仓库操作 ──────────────────────────────────────────────────

  /** 打开仓库并加载初始数据 */
  async function openRepo(repoPath: string): Promise<void> {
    getOrCreate(repoPath)
    update(repoPath, { loading: true })

    try {
      const [repoInfo, status, branches, tags, remotes, stashes, config] = await Promise.all([
        gitOpen(repoPath),
        gitGetStatus(repoPath),
        gitGetBranches(repoPath),
        gitGetTags(repoPath).catch(() => []),
        gitGetRemotes(repoPath).catch(() => []),
        gitGetStashes(repoPath).catch(() => []),
        gitGetConfig(repoPath).catch(() => null),
      ])

      // 加载首页提交历史
      const commits = await gitGetCommits(repoPath, 0, COMMITS_PAGE_SIZE).catch(() => [])

      update(repoPath, {
        repoInfo,
        status,
        branches,
        tags,
        remotes,
        stashes,
        config,
        commits,
        commitsPage: 0,
        hasMoreCommits: commits.length >= COMMITS_PAGE_SIZE,
        loading: false,
      })
    } catch (err) {
      update(repoPath, { loading: false })
      throw err
    }
  }

  /** 刷新仓库状态（轻量级，不重新打开） */
  async function refresh(repoPath: string): Promise<void> {
    const ws = workspaces.value.get(repoPath)
    if (!ws) return

    const [status, branches, tags, remotes, stashes] = await Promise.all([
      gitGetStatus(repoPath),
      gitGetBranches(repoPath),
      gitGetTags(repoPath).catch(() => ws.tags),
      gitGetRemotes(repoPath).catch(() => ws.remotes),
      gitGetStashes(repoPath).catch(() => ws.stashes),
    ])

    update(repoPath, { status, branches, tags, remotes, stashes })
  }

  /** 加载更多提交历史 */
  async function loadMoreCommits(repoPath: string): Promise<void> {
    const ws = workspaces.value.get(repoPath)
    if (!ws || !ws.hasMoreCommits || ws.loadingCommits) return

    update(repoPath, { loadingCommits: true })
    try {
      const nextPage = ws.commitsPage + 1
      const skip = nextPage * COMMITS_PAGE_SIZE
      const newCommits = await gitGetCommits(repoPath, skip, COMMITS_PAGE_SIZE)

      update(repoPath, {
        commits: [...(workspaces.value.get(repoPath)?.commits ?? []), ...newCommits],
        commitsPage: nextPage,
        hasMoreCommits: newCommits.length >= COMMITS_PAGE_SIZE,
        loadingCommits: false,
      })
    } catch {
      update(repoPath, { loadingCommits: false })
    }
  }

  // ── 暂存 & 提交 ──────────────────────────────────────────────

  async function stageFile(repoPath: string, filePath: string): Promise<void> {
    await gitStageFile(repoPath, filePath)
    refreshStatusDebounced(repoPath)
  }

  async function unstageFile(repoPath: string, filePath: string): Promise<void> {
    await gitUnstageFile(repoPath, filePath)
    refreshStatusDebounced(repoPath)
  }

  async function stageAll(repoPath: string): Promise<void> {
    await gitStageAll(repoPath)
    await refreshStatus(repoPath)
  }

  async function unstageAll(repoPath: string): Promise<void> {
    await gitUnstageAll(repoPath)
    await refreshStatus(repoPath)
  }

  async function commit(repoPath: string): Promise<string> {
    const ws = workspaces.value.get(repoPath)
    if (!ws) throw new Error('工作区不存在')

    const author = ws.config?.userName ?? 'Unknown'
    const email = ws.config?.userEmail ?? 'unknown@example.com'

    let hash: string
    if (ws.isAmend) {
      hash = await gitAmendCommit(repoPath, ws.commitMessage, author, email)
    } else {
      hash = await gitCommit(repoPath, ws.commitMessage, author, email)
    }

    // 提交成功后清空消息
    update(repoPath, { commitMessage: '', isAmend: false })

    // 并行刷新状态和提交历史（不重复调用 refresh）
    try {
      const [status, branches, commits] = await Promise.all([
        gitGetStatus(repoPath),
        gitGetBranches(repoPath),
        gitGetCommits(repoPath, 0, COMMITS_PAGE_SIZE),
      ])
      update(repoPath, {
        status,
        branches,
        commits,
        commitsPage: 0,
        hasMoreCommits: commits.length >= COMMITS_PAGE_SIZE,
      })
    } catch {
      // 刷新失败不阻塞提交结果
    }

    return hash
  }

  // ── Remote 操作 ──────────────────────────────────────────────

  async function push(repoPath: string, remote: string, branch: string, force = false): Promise<string> {
    update(repoPath, { operating: 'push' })
    try {
      const msg = await gitPush(repoPath, remote, branch, force)
      await refreshStatus(repoPath)
      return msg
    } finally {
      update(repoPath, { operating: null })
    }
  }

  async function pull(repoPath: string, remote: string, branch: string): Promise<string> {
    update(repoPath, { operating: 'pull' })
    try {
      const msg = await gitPull(repoPath, remote, branch)
      // 并行刷新全部状态 + 提交历史，不串行调用 refresh 再单独拉 commits
      const [status, branches, tags, remotes, stashes, commits] = await Promise.all([
        gitGetStatus(repoPath),
        gitGetBranches(repoPath),
        gitGetTags(repoPath).catch(() => workspaces.value.get(repoPath)?.tags ?? []),
        gitGetRemotes(repoPath).catch(() => workspaces.value.get(repoPath)?.remotes ?? []),
        gitGetStashes(repoPath).catch(() => workspaces.value.get(repoPath)?.stashes ?? []),
        gitGetCommits(repoPath, 0, COMMITS_PAGE_SIZE).catch(() => []),
      ])
      update(repoPath, {
        status, branches, tags, remotes, stashes,
        commits,
        commitsPage: 0,
        hasMoreCommits: commits.length >= COMMITS_PAGE_SIZE,
      })
      return msg
    } finally {
      update(repoPath, { operating: null })
    }
  }

  async function fetch(repoPath: string, remote: string): Promise<string> {
    update(repoPath, { operating: 'fetch' })
    try {
      const msg = await gitFetch(repoPath, remote)
      await refreshStatus(repoPath)
      return msg
    } finally {
      update(repoPath, { operating: null })
    }
  }

  // ── Merge & Rebase ──────────────────────────────────────────

  async function mergeBranch(repoPath: string, branchName: string): Promise<GitMergeResult> {
    update(repoPath, { operating: 'merge' })
    try {
      const result = await gitMergeBranch(repoPath, branchName)
      await refresh(repoPath)
      return result
    } finally {
      update(repoPath, { operating: null })
    }
  }

  async function abortMerge(repoPath: string): Promise<void> {
    await gitAbortMerge(repoPath)
    await refresh(repoPath)
  }

  async function rebaseBranch(repoPath: string, ontoBranch: string): Promise<void> {
    update(repoPath, { operating: 'rebase' })
    try {
      await gitRebaseBranch(repoPath, ontoBranch)
      await refresh(repoPath)
    } finally {
      update(repoPath, { operating: null })
    }
  }

  async function abortRebase(repoPath: string): Promise<void> {
    await gitAbortRebase(repoPath)
    await refresh(repoPath)
  }

  // ── 文件操作 ──────────────────────────────────────────────────

  async function discardFile(repoPath: string, filePath: string): Promise<void> {
    await gitDiscardFile(repoPath, filePath)
    await refreshStatus(repoPath)
  }

  async function discardAll(repoPath: string): Promise<void> {
    await gitDiscardAll(repoPath)
    await refreshStatus(repoPath)
  }

  // ── 分支操作 ──────────────────────────────────────────────────

  async function createBranch(repoPath: string, name: string, startPoint?: string): Promise<void> {
    await gitCreateBranch(repoPath, name, startPoint)
    await refreshBranches(repoPath)
  }

  async function deleteBranch(repoPath: string, name: string): Promise<void> {
    await gitDeleteBranch(repoPath, name)
    await refreshBranches(repoPath)
  }

  async function checkoutBranch(repoPath: string, name: string): Promise<void> {
    await gitCheckoutBranch(repoPath, name)
    await refresh(repoPath)
  }

  // ── Tag 操作 ──────────────────────────────────────────────────

  async function createTag(repoPath: string, name: string, message?: string, target?: string): Promise<void> {
    await gitCreateTag(repoPath, name, message, target)
    await refreshTags(repoPath)
  }

  async function deleteTag(repoPath: string, name: string): Promise<void> {
    await gitDeleteTag(repoPath, name)
    await refreshTags(repoPath)
  }

  // ── Stash 操作 ────────────────────────────────────────────────

  async function createStash(repoPath: string, message?: string): Promise<void> {
    await gitCreateStash(repoPath, message)
    await Promise.all([refreshStatus(repoPath), refreshStashes(repoPath)])
  }

  async function applyStash(repoPath: string, index: number): Promise<void> {
    await gitApplyStash(repoPath, index)
    await refreshStatus(repoPath)
  }

  async function dropStash(repoPath: string, index: number): Promise<void> {
    await gitDropStash(repoPath, index)
    await refreshStashes(repoPath)
  }

  async function popStash(repoPath: string, index: number): Promise<void> {
    await gitPopStash(repoPath, index)
    await Promise.all([refreshStatus(repoPath), refreshStashes(repoPath)])
  }

  // ── Cherry-pick ──────────────────────────────────────────────

  async function cherryPick(repoPath: string, hash: string): Promise<GitMergeResult> {
    const result = await gitCherryPick(repoPath, hash)
    await refresh(repoPath)
    return result
  }

  // ── 搜索 ────────────────────────────────────────────────────

  async function searchCommits(repoPath: string, query: string, field: string, skip = 0, limit = 50): Promise<GitCommit[]> {
    return gitSearchCommits(repoPath, query, field, skip, limit)
  }

  // ── Diff ──────────────────────────────────────────────────────

  async function loadDiff(repoPath: string, source: 'working' | 'staged' | 'commit', commitHash?: string): Promise<void> {
    let diff: GitDiff | null = null
    if (source === 'working') {
      diff = await gitGetDiffWorking(repoPath)
    } else if (source === 'staged') {
      diff = await gitGetDiffStaged(repoPath)
    } else if (source === 'commit' && commitHash) {
      diff = await gitGetDiffCommit(repoPath, commitHash)
    }

    const ws = workspaces.value.get(repoPath)
    const selectedFile = ws?.selectedFile
    const fileDiff = diff?.files.find(f => f.path === selectedFile) ?? null

    update(repoPath, {
      currentDiff: diff,
      selectedDiffSource: source,
      selectedFileDiff: fileDiff,
    })
  }

  /** 选中文件并加载其 diff */
  function selectFile(repoPath: string, filePath: string | null, source?: 'working' | 'staged' | 'commit') {
    const ws = workspaces.value.get(repoPath)
    if (!ws) return

    const diffSource = source ?? ws.selectedDiffSource
    const fileDiff = ws.currentDiff?.files.find(f => f.path === filePath) ?? null

    update(repoPath, {
      selectedFile: filePath,
      selectedDiffSource: diffSource,
      selectedFileDiff: fileDiff,
    })
  }

  /** 获取指定提交中文件的内容（用于 Monaco DiffEditor） */
  async function getFileContent(repoPath: string, hash: string, filePath: string): Promise<string> {
    return gitGetFileContent(repoPath, hash, filePath)
  }

  // ── 分支图 ────────────────────────────────────────────────────

  async function loadGraph(repoPath: string, skip = 0, limit = 100): Promise<void> {
    const graph = await gitGetGraph(repoPath, skip, limit)
    update(repoPath, { graph })
  }

  // ── 局部刷新 ──────────────────────────────────────────────────

  /** 防抖刷新 status — 连续 stage/unstage 操作只触发一次 */
  const _statusTimers = new Map<string, ReturnType<typeof setTimeout>>()
  function refreshStatusDebounced(repoPath: string): void {
    const existing = _statusTimers.get(repoPath)
    if (existing) clearTimeout(existing)
    _statusTimers.set(repoPath, setTimeout(async () => {
      _statusTimers.delete(repoPath)
      const status = await gitGetStatus(repoPath)
      update(repoPath, { status })
    }, 150))
  }

  async function refreshStatus(repoPath: string): Promise<void> {
    const status = await gitGetStatus(repoPath)
    update(repoPath, { status })
  }

  async function refreshBranches(repoPath: string): Promise<void> {
    const branches = await gitGetBranches(repoPath)
    update(repoPath, { branches })
  }

  async function refreshTags(repoPath: string): Promise<void> {
    const tags = await gitGetTags(repoPath).catch(() => [])
    update(repoPath, { tags })
  }

  async function refreshStashes(repoPath: string): Promise<void> {
    const stashes = await gitGetStashes(repoPath).catch(() => [])
    update(repoPath, { stashes })
  }

  // ── 清理 ──────────────────────────────────────────────────────

  function cleanup(repoPath: string): void {
    // 清理防抖 timer
    const timer = _statusTimers.get(repoPath)
    if (timer) {
      clearTimeout(timer)
      _statusTimers.delete(repoPath)
    }
    workspaces.value.delete(repoPath)
    triggerRef(workspaces)
  }

  return {
    workspaces,
    getOrCreate,
    get,
    update,
    // 仓库操作
    openRepo,
    refresh,
    loadMoreCommits,
    // 暂存 & 提交
    stageFile,
    unstageFile,
    stageAll,
    unstageAll,
    commit,
    // Remote
    push,
    pull,
    fetch,
    // Merge & Rebase
    mergeBranch,
    abortMerge,
    rebaseBranch,
    abortRebase,
    // 文件操作
    discardFile,
    discardAll,
    // 分支
    createBranch,
    deleteBranch,
    checkoutBranch,
    // Tag
    createTag,
    deleteTag,
    // Stash
    createStash,
    applyStash,
    dropStash,
    popStash,
    // Cherry-pick
    cherryPick,
    // 搜索
    searchCommits,
    // Diff
    loadDiff,
    selectFile,
    getFileContent,
    // 分支图
    loadGraph,
    // 清理
    cleanup,
  }
})
