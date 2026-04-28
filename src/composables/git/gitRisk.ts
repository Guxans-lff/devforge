export type GitRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface GitRiskSummary {
  level: GitRiskLevel
  title: string
  message: string
  confirmText?: string
}

export interface GitRiskInput {
  operation:
    | 'push'
    | 'pull'
    | 'force_push'
    | 'discard'
    | 'discard_all'
    | 'delete_branch'
    | 'delete_tag'
    | 'rebase'
    | 'merge'
    | 'stash_apply'
    | 'stash_drop'
    | 'stash_pop'
  branch?: string
  remote?: string
  filePath?: string
  tag?: string
  stashIndex?: number
  changedFileCount?: number
}

export function summarizeGitRisk(input: GitRiskInput): GitRiskSummary {
  switch (input.operation) {
    case 'force_push':
      return {
        level: 'critical',
        title: '确认强制推送',
        message: `将强制推送 ${input.remote ?? 'origin'}/${input.branch ?? '当前分支'}，可能覆盖远端提交。`,
        confirmText: 'force push',
      }
    case 'pull':
      return {
        level: 'medium',
        title: '确认拉取',
        message: '拉取可能触发 merge/rebase 或覆盖工作区状态，请确认当前改动已保存。',
      }
    case 'discard_all':
      return {
        level: 'critical',
        title: '确认丢弃全部改动',
        message: `将丢弃 ${input.changedFileCount ?? 0} 个工作区改动，操作不可撤销。`,
        confirmText: 'discard all',
      }
    case 'discard':
      return {
        level: 'high',
        title: '确认丢弃文件改动',
        message: `将丢弃${input.filePath ? ` ${input.filePath} ` : '该文件'}的工作区改动，操作不可撤销。`,
      }
    case 'delete_branch':
      return {
        level: 'high',
        title: '确认删除分支',
        message: `将删除分支 ${input.branch ?? ''}，请确认该分支已合并或不再需要。`,
      }
    case 'delete_tag':
      return {
        level: 'high',
        title: '确认删除 Tag',
        message: `将删除 Tag ${input.tag ?? ''}，如果已发布到远端，后续还需要同步清理远端引用。`,
      }
    case 'merge':
      return {
        level: 'medium',
        title: '确认 Merge',
        message: `将 ${input.branch ?? '目标分支'} 合并到当前分支，可能产生冲突，请确认工作区状态干净。`,
      }
    case 'rebase':
      return {
        level: 'high',
        title: '确认 Rebase',
        message: `将当前分支 rebase 到 ${input.branch ?? '目标分支'}，可能产生冲突并改写提交历史。`,
      }
    case 'stash_apply':
      return {
        level: 'medium',
        title: '确认 Apply Stash',
        message: `将应用 stash@{${input.stashIndex ?? 0}}，可能与当前工作区改动产生冲突。`,
      }
    case 'stash_drop':
      return {
        level: 'high',
        title: '确认删除 Stash',
        message: `将删除 stash@{${input.stashIndex ?? 0}}，操作不可撤销。`,
      }
    case 'stash_pop':
      return {
        level: 'medium',
        title: '确认 Pop Stash',
        message: `Pop stash@{${input.stashIndex ?? 0}} 会应用并删除该 stash，可能产生冲突。`,
      }
    default:
      return {
        level: 'low',
        title: '确认 Git 操作',
        message: '请确认执行该 Git 操作。',
      }
  }
}

export function confirmGitRisk(input: GitRiskInput): boolean {
  const risk = summarizeGitRisk(input)
  const text = risk.confirmText
    ? `${risk.message}\n\n请输入/确认：${risk.confirmText}`
    : risk.message
  return window.confirm(`${risk.title}\n\n${text}`)
}
