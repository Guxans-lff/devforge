/**
 * 工具风险等级定义
 *
 * 用于权限确认和审计日志。风险等级决定是否需要用户确认。
 */

/** 工具风险等级 */
export type ToolRiskLevel =
  | 'read'         // 只读操作，无需确认
  | 'write'        // 写入操作，需要确认
  | 'execute'      // 代码/命令执行，需要确认
  | 'network'      // 网络请求，需要确认
  | 'db_mutation'  // 数据库变更，需要确认
  | 'destructive'  // 删除/覆盖等破坏性操作，需要二次确认

/** 工具风险信息 */
export interface ToolRiskInfo {
  level: ToolRiskLevel
  /** 是否需要用户确认 */
  requiresApproval: boolean
  /** 风险描述 */
  description: string
}

/** 工具风险等级映射 */
const TOOL_RISK_MAP: Record<string, ToolRiskInfo> = {
  // ── 只读 ──
  read_file: { level: 'read', requiresApproval: false, description: '读取文件内容' },
  list_files: { level: 'read', requiresApproval: false, description: '列出文件' },
  list_directory: { level: 'read', requiresApproval: false, description: '列出目录' },
  search_files: { level: 'read', requiresApproval: false, description: '搜索文件' },
  read_tool_result: { level: 'read', requiresApproval: false, description: '读取工具结果' },
  glob: { level: 'read', requiresApproval: false, description: 'Glob 文件匹配' },
  grep: { level: 'read', requiresApproval: false, description: 'Grep 内容搜索' },

  // ── 写入 ──
  write_file: { level: 'write', requiresApproval: true, description: '写入文件' },
  edit_file: { level: 'write', requiresApproval: true, description: '编辑文件' },

  // ── 破坏性 ──
  delete_file: { level: 'destructive', requiresApproval: true, description: '删除文件' },

  // ── 外部网络 ──
  web_fetch: { level: 'network', requiresApproval: true, description: '抓取网页' },
  web_search: { level: 'network', requiresApproval: true, description: '网络搜索' },

  // ── Shell / 代码执行 ──
  bash: { level: 'execute', requiresApproval: true, description: '执行 Shell 命令' },

  // ── 数据库 ──
  db_query: { level: 'read', requiresApproval: false, description: '数据库查询' },
  db_execute: { level: 'db_mutation', requiresApproval: true, description: '数据库变更' },
  db_migration: { level: 'db_mutation', requiresApproval: true, description: '数据库迁移' },
}

/** 默认风险等级：未知工具视为 write */
const DEFAULT_RISK: ToolRiskInfo = {
  level: 'write',
  requiresApproval: true,
  description: '未知工具',
}

/**
 * 获取工具风险信息
 */
export function getToolRisk(toolName: string): ToolRiskInfo {
  return TOOL_RISK_MAP[toolName] ?? DEFAULT_RISK
}

/**
 * 获取工具风险等级
 */
export function getToolRiskLevel(toolName: string): ToolRiskLevel {
  return getToolRisk(toolName).level
}

/**
 * 判断工具是否需要用户确认
 */
export function requiresApproval(toolName: string): boolean {
  return getToolRisk(toolName).requiresApproval
}

/**
 * 获取所有已注册的工具风险信息（用于 UI 展示）
 */
export function getAllToolRisks(): Record<string, ToolRiskInfo> {
  return { ...TOOL_RISK_MAP }
}

/**
 * 判断给定风险等级是否需要二次确认（destructive / db_mutation）
 */
export function requiresDoubleConfirm(level: ToolRiskLevel): boolean {
  return level === 'destructive' || level === 'db_mutation'
}

/**
 * 按 PermissionMode 判断工具是否可直接执行（无需弹窗）
 *
 * @param mode 当前权限模式
 * @param level 工具风险等级
 * @returns true = 可直接执行，false = 需要确认/拒绝
 */
export function isAutoAllowedByMode(
  mode: 'default' | 'plan' | 'accept_edits' | 'read_only' | 'safe_auto' | 'dangerous_bypass',
  level: ToolRiskLevel,
): boolean {
  switch (mode) {
    case 'dangerous_bypass':
      return true
    case 'read_only':
      return level === 'read'
    case 'plan':
      return level === 'read'
    case 'accept_edits':
      return level === 'read' || level === 'write'
    case 'safe_auto':
      return level === 'read' || level === 'write'
    case 'default':
    default:
      // default 模式下不自动放行任何工具，由 ApprovalMode 处理
      // 这样 strictPermission / deny 等场景能正确生效
      return false
  }
}

/**
 * 按 PermissionMode 判断工具是否应被拒绝
 */
export function isDeniedByMode(
  mode: 'default' | 'plan' | 'accept_edits' | 'read_only' | 'safe_auto' | 'dangerous_bypass',
  level: ToolRiskLevel,
): boolean {
  switch (mode) {
    case 'read_only':
      return level !== 'read'
    case 'plan':
      return level !== 'read'
    case 'dangerous_bypass':
      return false
    default:
      return false
  }
}
