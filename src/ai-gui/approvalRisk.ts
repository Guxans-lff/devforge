import type { PendingApproval } from '@/composables/useToolApproval'
import { classifyBashCommand } from '@/composables/ai/bashCommandClassifier'

export type ApprovalRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface ApprovalRiskSummary {
  level: ApprovalRiskLevel
  label: string
  tone: 'info' | 'warning' | 'danger'
  description: string
  risks: string[]
  recommendations: string[]
  trustWarning: string
}

type ApprovalRiskInput = Pick<PendingApproval, 'toolName' | 'target' | 'targetLabel' | 'preview' | 'oldPreview'>

const READ_TOOL_NAMES = new Set(['read_file', 'list_files', 'list_directory', 'search_files', 'read_tool_result'])

const SENSITIVE_PATH_PATTERNS = [
  /(^|[\\/])\.git([\\/]|$)/i,
  /(^|[\\/])\.idea([\\/]|$)/i,
  /(^|[\\/])\.vscode([\\/]|$)/i,
  /(^|[\\/])\.claude([\\/]|$)/i,
  /(^|[\\/])\.devforge([\\/]|$)/i,
  /(^|[\\/])\.env(\.|$)/i,
  /(^|[\\/])package-lock\.json$/i,
  /(^|[\\/])pnpm-lock\.yaml$/i,
  /(^|[\\/])yarn\.lock$/i,
]

function isSensitivePath(target: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some(pattern => pattern.test(target))
}

function buildPathRisks(action: string, target: string): string[] {
  const risks = [`将${action}：${target || '未提供路径'}`]
  if (isSensitivePath(target)) {
    risks.push('目标命中敏感路径或关键配置文件，误改可能影响仓库、IDE 或运行环境。')
  }
  return risks
}

function baseRecommendations(): string[] {
  return [
    '确认目标、内容和当前 workspace 无误后再允许。',
    '不确定时选择拒绝，让 AI 重新解释或缩小操作范围。',
  ]
}

export function summarizeApprovalRisk(input: ApprovalRiskInput): ApprovalRiskSummary {
  const target = input.target.trim()
  const preview = input.preview.trim()

  if (input.toolName === 'bash') {
    const cmd = preview || target || ''
    const classification = classifyBashCommand(cmd)
    const critical = classification.level === 'critical'
    const dangerous = classification.level === 'dangerous'

    let level: ApprovalRiskLevel = 'medium'
    let label = '中风险'
    if (critical) { level = 'critical'; label = '极高风险' }
    else if (dangerous) { level = 'high'; label = '高风险' }

    const categoryLabels: Record<string, string> = {
      code_execution: '代码执行',
      file_deletion: '文件删除',
      file_move: '文件移动',
      network: '网络操作',
      git_destructive: 'Git 破坏性操作',
      privilege: '提权操作',
      system_mod: '系统修改',
      pipe_download: '管道下载执行',
      database_mutation: '数据库变更',
    }

    return {
      level,
      label,
      tone: critical || dangerous ? 'danger' : 'warning',
      description: critical
        ? '命令可能执行破坏性或提权操作。'
        : dangerous
          ? 'Shell 命令会在本机环境执行，可能修改文件或调用外部程序。'
          : '该命令风险较低，但仍需确认执行环境。',
      risks: [
        `将执行命令：${cmd || '空命令'}`,
        ...(classification.level !== 'safe' ? [`命中风险类别：${categoryLabels[classification.category] ?? classification.category} — ${classification.reason}`] : []),
        '命令可能产生不可逆副作用，且输出不一定完整展示。',
        ...(critical ? ['检测到删除、提权、管道执行脚本或数据库破坏类关键词。'] : []),
      ],
      recommendations: [
        '逐字检查命令和参数，确认没有通配符误伤。',
        ...baseRecommendations(),
      ],
      trustWarning: '仅在命令完全固定且你愿意本会话后续自动放行时使用“信任并允许”。',
    }
  }

  if (input.toolName === 'web_fetch') {
    return {
      level: 'medium',
      label: '中风险',
      tone: 'warning',
      description: '该操作会访问外部 URL，可能泄露上下文中的敏感信息或拉取不可信内容。',
      risks: [
        `将访问 URL：${target || preview || '未提供 URL'}`,
        '远程内容可能不可信，后续若用于代码生成需要二次确认。',
      ],
      recommendations: [
        '确认 URL 来源可信，避免访问含 token、内网地址或隐私参数的链接。',
        ...baseRecommendations(),
      ],
      trustWarning: '只建议对固定可信域名使用“信任并允许”。',
    }
  }

  if (READ_TOOL_NAMES.has(input.toolName)) {
    const sensitive = isSensitivePath(target)
    return {
      level: sensitive ? 'medium' : 'low',
      label: sensitive ? '中风险' : '低风险',
      tone: sensitive ? 'warning' : 'info',
      description: '该操作只读取或搜索本地内容，不会修改文件；严格权限模式下需要你确认读取范围。',
      risks: [
        `将读取/搜索：${target || preview || '未提供范围'}`,
        ...(sensitive ? ['目标包含敏感配置目录，可能把凭据、IDE 配置或项目策略暴露给模型。'] : []),
      ],
      recommendations: [
        '确认读取范围确实与当前问题相关。',
        '如果路径过宽，拒绝并要求 AI 指定更小范围。',
      ],
      trustWarning: '只建议对固定目录或固定查询条件使用“信任并允许”。',
    }
  }

  if (input.toolName === 'write_file') {
    const sensitive = isSensitivePath(target)
    return {
      level: sensitive ? 'high' : 'medium',
      label: sensitive ? '高风险' : '中风险',
      tone: sensitive ? 'danger' : 'warning',
      description: '该操作会写入文件内容，可能覆盖现有文件或创建新文件。',
      risks: buildPathRisks('写入文件', target),
      recommendations: [
        '重点检查 diff 中新增内容、文件名和目录是否正确。',
        ...baseRecommendations(),
      ],
      trustWarning: '仅在同一路径可重复写入且内容模式稳定时信任。',
    }
  }

  if (input.toolName === 'edit_file') {
    const sensitive = isSensitivePath(target)
    const missingAnchor = !input.oldPreview?.trim()
    return {
      level: sensitive ? 'high' : 'medium',
      label: sensitive ? '高风险' : '中风险',
      tone: sensitive ? 'danger' : 'warning',
      description: '该操作会按 old_string/new_string 编辑文件，匹配不准可能改错位置。',
      risks: [
        ...buildPathRisks('编辑文件', target),
        ...(missingAnchor ? ['缺少 old_string 锚点，无法确认替换位置是否唯一。'] : []),
      ],
      recommendations: [
        '确认 old_string 足够具体且只匹配一个位置。',
        ...baseRecommendations(),
      ],
      trustWarning: '仅在替换目标固定且 diff 已确认时信任。',
    }
  }

  return {
    level: 'medium',
    label: '中风险',
    tone: 'warning',
    description: '该工具没有专用风险模型，按通用工具调用处理。',
    risks: [`目标：${target || preview || input.targetLabel}`],
    recommendations: baseRecommendations(),
    trustWarning: '未知工具不建议长期信任。',
  }
}
