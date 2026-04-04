/** 仓库基本信息 */
export interface GitRepositoryInfo {
  path: string
  currentBranch: string
  headCommit: string
  isBare: boolean
  remotes: string[]
}

/** 文件状态 */
export interface GitFileStatus {
  path: string
  /** added / modified / deleted / renamed / conflicted */
  status: string
}

/** 工作区状态 */
export interface GitStatus {
  currentBranch: string
  staged: GitFileStatus[]
  unstaged: GitFileStatus[]
  untracked: string[]
  hasConflicts: boolean
  ahead: number
  behind: number
}

/** Git 引用标签 */
export interface GitRef {
  /** branch / tag / remote / HEAD */
  refType: string
  name: string
}

/** 提交记录 */
export interface GitCommit {
  hash: string
  shortHash: string
  message: string
  body?: string
  author: string
  authorEmail: string
  /** Unix 秒 */
  timestamp: number
  parents: string[]
  refs: GitRef[]
}

/** 分支信息 */
export interface GitBranch {
  name: string
  isLocal: boolean
  isCurrent: boolean
  upstream?: string
  headCommit: string
  ahead: number
  behind: number
}

/** Stash 条目 */
export interface GitStash {
  index: number
  message: string
  commitHash: string
}

/** Diff 统计 */
export interface GitDiffStats {
  insertions: number
  deletions: number
  filesChanged: number
}

/** Diff 行 */
export interface GitDiffLine {
  /** + / - / 空格 */
  origin: string
  content: string
  oldLineno?: number
  newLineno?: number
}

/** Diff Hunk */
export interface GitDiffHunk {
  header: string
  lines: GitDiffLine[]
}

/** 文件级 Diff */
export interface GitFileDiff {
  path: string
  oldPath?: string
  /** added / modified / deleted / renamed */
  status: string
  hunks: GitDiffHunk[]
  isBinary: boolean
}

/** 完整 Diff 数据 */
export interface GitDiff {
  stats: GitDiffStats
  files: GitFileDiff[]
}

/** 分支图边 */
export interface GitGraphEdge {
  parentHash: string
  parentCol: number
}

/** 分支图节点 */
export interface GitGraphNode {
  hash: string
  shortHash: string
  message: string
  author: string
  timestamp: number
  row: number
  col: number
  parents: GitGraphEdge[]
  refs: GitRef[]
}

/** 分支图数据 */
export interface GitGraph {
  nodes: GitGraphNode[]
  maxCols: number
}

/** 远程仓库信息 */
export interface GitRemote {
  name: string
  url?: string
  fetchUrl?: string
}

/** 标签信息 */
export interface GitTag {
  name: string
  message?: string
  tagger?: string
  hash: string
  /** Unix 秒 */
  timestamp: number
  isLightweight: boolean
}

/** 合并结果 */
export interface GitMergeResult {
  success: boolean
  conflicts: string[]
  message: string
}

/** Git 用户配置 */
export interface GitConfig {
  userName?: string
  userEmail?: string
}

/** Blame 行信息 */
export interface GitBlameLine {
  lineNumber: number
  content: string
  commitHash: string
  author: string
  /** Unix 秒 */
  timestamp: number
}

/** 贡献者统计 */
export interface GitContributor {
  name: string
  email: string
  commits: number
  /** Unix 秒 */
  firstCommit: number
  /** Unix 秒 */
  lastCommit: number
}
