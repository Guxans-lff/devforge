/**
 * Bash / PowerShell 命令风险分类器
 *
 * 根据命令内容识别风险类别，用于审批弹窗的风险提示和自动拒绝策略。
 */

export type CommandRiskCategory =
  | 'code_execution'
  | 'file_deletion'
  | 'file_move'
  | 'network'
  | 'git_destructive'
  | 'privilege'
  | 'system_mod'
  | 'pipe_download'
  | 'database_mutation'
  | 'safe'

export interface CommandRiskResult {
  category: CommandRiskCategory
  level: 'safe' | 'warning' | 'dangerous' | 'critical'
  reason: string
  matchedPatterns: string[]
}

interface RiskRule {
  name: string
  category: CommandRiskCategory
  level: 'warning' | 'dangerous' | 'critical'
  reason: string
  patterns: RegExp[]
}

const RISK_RULES: RiskRule[] = [
  {
    name: 'python_execution',
    category: 'code_execution',
    level: 'dangerous',
    reason: '执行 Python 脚本可能运行任意代码',
    patterns: [/\bpython\d*\s+[^\s]|\bpython\d*\s*<|\bpython\d*\s+-c\b/i],
  },
  {
    name: 'node_execution',
    category: 'code_execution',
    level: 'dangerous',
    reason: '执行 Node.js 脚本可能运行任意代码',
    patterns: [/\bnode\s+[^\s]|\bnode\s+-e\b/i],
  },
  {
    name: 'npx_tsx_bun',
    category: 'code_execution',
    level: 'dangerous',
    reason: 'npx/tsx/bun 可能下载并执行远程包',
    patterns: [/\bnpx\s+[^\s]|\btsx\s+[^\s]|\bbun\s+run\b/i],
  },
  {
    name: 'powershell_inline',
    category: 'code_execution',
    level: 'dangerous',
    reason: 'PowerShell 内联命令可能执行任意脚本',
    patterns: [/\bpowershell\s+-[Cc]ommand\b/i, /\bpwsh\s+-[Cc]ommand\b/i],
  },
  {
    name: 'invoke_expression',
    category: 'code_execution',
    level: 'critical',
    reason: 'Invoke-Expression (iex) 会执行字符串内容，极危险',
    patterns: [/\biex\b/i, /\bInvoke-Expression\b/i],
  },
  {
    name: 'rm_rf',
    category: 'file_deletion',
    level: 'critical',
    reason: 'rm -rf 会递归强制删除，不可恢复',
    patterns: [/\brm\s+-[a-zA-Z]*[rf][a-zA-Z]*/i],
  },
  {
    name: 'del_force',
    category: 'file_deletion',
    level: 'dangerous',
    reason: 'Windows del /f /s /q 会强制批量删除',
    patterns: [/\bdel\s+\/.*[fsq]/i],
  },
  {
    name: 'remove_item_recursive',
    category: 'file_deletion',
    level: 'dangerous',
    reason: 'Remove-Item -Recurse 会递归删除',
    patterns: [/\bRemove-Item\b.*\s-Recurse\b/i, /\bri\b.*\s-r\b/i, /\brm\b.*\s-r\b/i],
  },
  {
    name: 'rmdir_recursive',
    category: 'file_deletion',
    level: 'dangerous',
    reason: 'rmdir /s 会递归删除目录',
    patterns: [/\brmdir\s+\/s/i, /\brd\s+\/s/i],
  },
  {
    name: 'mv_move',
    category: 'file_move',
    level: 'warning',
    reason: '移动文件可能覆盖目标位置',
    patterns: [/\bmv\s+[^|]+\s+[^|]+/i, /\bmove\s+/i],
  },
  {
    name: 'curl_wget',
    category: 'network',
    level: 'warning',
    reason: '下载远程内容可能引入不可信代码',
    patterns: [/\bcurl\b/i, /\bwget\b/i, /\bInvoke-WebRequest\b/i, /\biwr\b/i],
  },
  {
    name: 'ssh_scp',
    category: 'network',
    level: 'warning',
    reason: 'SSH/SCP 连接到远程主机',
    patterns: [/\bssh\s+/i, /\bscp\s+/i, /\bsftp\s+/i],
  },
  {
    name: 'git_reset_hard',
    category: 'git_destructive',
    level: 'dangerous',
    reason: 'git reset --hard 会丢弃未提交的更改',
    patterns: [/\bgit\s+reset\s+--hard\b/i],
  },
  {
    name: 'git_clean_force',
    category: 'git_destructive',
    level: 'dangerous',
    reason: 'git clean -fd 会强制删除未跟踪文件',
    patterns: [/\bgit\s+clean\s+.*-[fd]/i],
  },
  {
    name: 'git_push_force',
    category: 'git_destructive',
    level: 'dangerous',
    reason: 'git push --force 可能覆盖远程历史',
    patterns: [/\bgit\s+push\s+.*--force\b/i, /\bgit\s+push\s+.*-f\b/i],
  },
  {
    name: 'sudo',
    category: 'privilege',
    level: 'critical',
    reason: 'sudo 以管理员/根权限执行命令',
    patterns: [/\bsudo\b/i, /\brunas\b/i],
  },
  {
    name: 'chmod_chown',
    category: 'privilege',
    level: 'dangerous',
    reason: '修改文件权限或所有者可能影响系统安全',
    patterns: [/\bchmod\s+/i, /\bchown\s+/i],
  },
  {
    name: 'format_disk',
    category: 'system_mod',
    level: 'critical',
    reason: 'format / diskpart / mkfs 会格式化磁盘',
    patterns: [/\bformat\s+/i, /\bdiskpart\b/i, /\bmkfs\./i],
  },
  {
    name: 'registry_edit',
    category: 'system_mod',
    level: 'dangerous',
    reason: '修改注册表可能影响系统稳定性',
    patterns: [/\breg\s+(add|delete|import)\b/i, /\bSet-ItemProperty\b.*\bHK(?:LM|CU|CR|U|CC)\b/i],
  },
  {
    name: 'curl_pipe_shell',
    category: 'pipe_download',
    level: 'critical',
    reason: '从网络下载并直接管道执行脚本，极危险',
    patterns: [/\bcurl\b.*\|.*\b(?:sh|bash|powershell|pwsh)\b/i, /\bwget\b.*\|.*\b(?:sh|bash|powershell|pwsh)\b/i],
  },
  {
    name: 'redis_flush',
    category: 'database_mutation',
    level: 'critical',
    reason: 'FLUSHALL / FLUSHDB 会清空整个 Redis 实例',
    patterns: [/\bredis-cli\b.*\bFLUSH(?:ALL|DB)\b/i],
  },
  {
    name: 'mysqladmin_drop',
    category: 'database_mutation',
    level: 'critical',
    reason: 'mysqladmin drop 会删除整个数据库',
    patterns: [/\bmysqladmin\s+drop\b/i],
  },
]

const SAFE_COMMAND_PATTERNS = [
  /^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get|tag\s+-l)\b/i,
  /^\s*(ls|ll|dir|cd|pwd|echo|cat|type|head|tail|find|grep|rg|which|where)\b/i,
  /^\s*node\s+--version\b/i,
  /^\s*python\s+--version\b/i,
  /^\s*npm\s+--version\b/i,
  /^\s*pnpm\s+--version\b/i,
  /^\s*git\s+clone\b/i,
  /^\s*git\s+pull\b/i,
  /^\s*git\s+fetch\b/i,
]

const SAFE_SHELL_SEGMENT_PATTERNS = [
  /^\s*cd(?:\s+\/d)?\s+.+$/i,
  /^\s*dir\b[\s\S]*$/i,
  /^\s*find\s+\/[ci]?\s+\/v?\s+"?.*"?\s*$/i,
  /^\s*(ls|ll|pwd|echo|cat|type|head|tail|grep|rg|which|where)\b[\s\S]*$/i,
  /^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get|tag\s+-l)\b[\s\S]*$/i,
]

function isSafeShellPipeline(command: string): boolean {
  const segments = command
    .split(/\s*(?:&&|\|\|?|\r?\n)\s*/g)
    .map(segment => segment.trim())
    .filter(Boolean)

  if (segments.length <= 1) return false
  return segments.every(segment => SAFE_SHELL_SEGMENT_PATTERNS.some(pattern => pattern.test(segment)))
}

export function classifyBashCommand(command: string): CommandRiskResult {
  const trimmed = command.trim()
  if (!trimmed) {
    return { category: 'safe', level: 'safe', reason: '空命令', matchedPatterns: [] }
  }

  if (SAFE_COMMAND_PATTERNS.some(p => p.test(trimmed))) {
    return { category: 'safe', level: 'safe', reason: '白名单安全命令', matchedPatterns: [] }
  }

  if (isSafeShellPipeline(trimmed)) {
    return { category: 'safe', level: 'safe', reason: '白名单安全查询命令组合', matchedPatterns: [] }
  }

  const matched: string[] = []
  let highestLevel: 'warning' | 'dangerous' | 'critical' = 'warning'
  let primaryCategory: CommandRiskCategory = 'safe'
  let primaryReason = '未发现明显风险'

  for (const rule of RISK_RULES) {
    const hit = rule.patterns.some(p => p.test(trimmed))
    if (hit) {
      matched.push(rule.name)
      if (levelRank(rule.level) > levelRank(highestLevel)) {
        highestLevel = rule.level
        primaryCategory = rule.category
        primaryReason = rule.reason
      }
      if (levelRank(rule.level) === levelRank(highestLevel) && categoryRank(rule.category) > categoryRank(primaryCategory)) {
        primaryCategory = rule.category
        primaryReason = rule.reason
      }
    }
  }

  if (matched.length === 0) {
    return { category: 'safe', level: 'safe', reason: '未发现匹配的风险规则', matchedPatterns: [] }
  }

  return {
    category: primaryCategory,
    level: highestLevel,
    reason: primaryReason,
    matchedPatterns: matched,
  }
}

function levelRank(level: 'warning' | 'dangerous' | 'critical'): number {
  switch (level) {
    case 'warning': return 1
    case 'dangerous': return 2
    case 'critical': return 3
  }
}

function categoryRank(category: CommandRiskCategory): number {
  const ranks: Record<CommandRiskCategory, number> = {
    pipe_download: 9,
    privilege: 8,
    code_execution: 7,
    system_mod: 6,
    database_mutation: 5,
    file_deletion: 4,
    git_destructive: 3,
    network: 2,
    file_move: 1,
    safe: 0,
  }
  return ranks[category] ?? 0
}

export function requiresDoubleConfirmForCommand(command: string): boolean {
  const result = classifyBashCommand(command)
  return result.level === 'critical'
}

export function shouldAutoRejectCommand(command: string): boolean {
  const result = classifyBashCommand(command)
  return result.level === 'critical' || result.level === 'dangerous'
}
