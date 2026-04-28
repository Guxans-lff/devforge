import type { WorkspaceConfig, WorkspaceSkillConfig, WorkspaceSkillPermission } from '@/types/ai'

const VALID_PERMISSIONS: WorkspaceSkillPermission[] = ['read', 'write', 'execute', 'network', 'mcp']
const PERMISSION_SET = new Set<WorkspaceSkillPermission>(VALID_PERMISSIONS)
const DANGEROUS_PERMISSIONS = new Set<WorkspaceSkillPermission>(['write', 'execute', 'network', 'mcp'])

export interface WorkspaceSkillSummary {
  total: number
  enabled: number
  disabled: number
  missingPath: number
  risky: number
  invalid: number
}

export interface WorkspaceSkillValidationIssue {
  skillId: string
  skillName: string
  level: 'info' | 'warning' | 'danger'
  code: 'missing_path' | 'invalid_path' | 'missing_description' | 'risky_permission' | 'invalid_permission'
  message: string
}

export interface WorkspaceSkillRiskSummary {
  issues: WorkspaceSkillValidationIssue[]
  highestLevel: WorkspaceSkillValidationIssue['level'] | 'none'
  riskyCount: number
  invalidCount: number
  missingPathCount: number
}

export function normalizeWorkspaceSkill(skill: Partial<WorkspaceSkillConfig>, index = 0): WorkspaceSkillConfig {
  const name = skill.name?.trim() || `Skill ${index + 1}`
  const id = skill.id?.trim() || name.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || `skill-${index + 1}`
  const description = skill.description?.trim()
  const path = skill.path?.trim()
  const permissions = normalizePermissions(skill.permissions)

  return {
    id,
    name,
    description: description || undefined,
    path: path || undefined,
    permissions: permissions.length > 0 ? permissions : undefined,
    enabled: skill.enabled !== false,
  }
}

export function normalizeWorkspaceSkills(skills: WorkspaceConfig['skills']): WorkspaceSkillConfig[] {
  return (skills ?? [])
    .filter(skill => skill && (skill.name?.trim() || skill.id?.trim() || skill.path?.trim()))
    .map((skill, index) => normalizeWorkspaceSkill(skill, index))
}

export function summarizeWorkspaceSkills(skills: WorkspaceSkillConfig[]): WorkspaceSkillSummary {
  const total = skills.length
  const enabled = skills.filter(skill => skill.enabled !== false).length
  const missingPath = skills.filter(skill => skill.enabled !== false && !skill.path?.trim()).length
  const risks = validateWorkspaceSkills(skills)

  return {
    total,
    enabled,
    disabled: total - enabled,
    missingPath,
    risky: risks.riskyCount,
    invalid: risks.invalidCount,
  }
}

export function normalizePermissions(permissions: WorkspaceSkillConfig['permissions']): WorkspaceSkillPermission[] {
  const normalized: WorkspaceSkillPermission[] = []
  for (const permission of permissions ?? []) {
    if (!PERMISSION_SET.has(permission)) continue
    if (!normalized.includes(permission)) normalized.push(permission)
  }
  return normalized
}

function hasInvalidPermission(skill: WorkspaceSkillConfig): boolean {
  const rawPermissions = skill.permissions as unknown
  if (!Array.isArray(rawPermissions)) return false
  return rawPermissions.some(permission => !PERMISSION_SET.has(permission as WorkspaceSkillPermission))
}

function isSkillPathValid(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  return normalized.endsWith('/SKILL.md') || normalized === 'SKILL.md'
}

function riskLevelRank(level: WorkspaceSkillValidationIssue['level'] | 'none'): number {
  switch (level) {
    case 'danger': return 3
    case 'warning': return 2
    case 'info': return 1
    case 'none': return 0
  }
}

export function validateWorkspaceSkills(skills: WorkspaceSkillConfig[]): WorkspaceSkillRiskSummary {
  const issues: WorkspaceSkillValidationIssue[] = []
  const enabledSkills = skills.filter(skill => skill.enabled !== false)

  for (const skill of enabledSkills) {
    const skillId = skill.id
    const skillName = skill.name
    const permissions = normalizePermissions(skill.permissions)

    if (!skill.path?.trim()) {
      issues.push({
        skillId,
        skillName,
        level: 'warning',
        code: 'missing_path',
        message: '启用 Skill 缺少 SKILL.md 路径，只能作为提示说明，无法定位具体文件。',
      })
    } else if (!isSkillPathValid(skill.path)) {
      issues.push({
        skillId,
        skillName,
        level: 'warning',
        code: 'invalid_path',
        message: 'Skill 路径建议指向 SKILL.md，避免注入不明确的目录或普通文档。',
      })
    }

    if (!skill.description?.trim()) {
      issues.push({
        skillId,
        skillName,
        level: 'info',
        code: 'missing_description',
        message: '缺少说明会降低 AI 判断何时启用该 Skill 的准确性。',
      })
    }

    if (hasInvalidPermission(skill)) {
      issues.push({
        skillId,
        skillName,
        level: 'danger',
        code: 'invalid_permission',
        message: '存在未知权限声明，保存前会被忽略；请只使用 read/write/execute/network/mcp。',
      })
    }

    const riskyPermissions = permissions.filter(permission => DANGEROUS_PERMISSIONS.has(permission))
    if (riskyPermissions.length > 0) {
      issues.push({
        skillId,
        skillName,
        level: riskyPermissions.some(permission => permission === 'execute' || permission === 'network' || permission === 'mcp') ? 'danger' : 'warning',
        code: 'risky_permission',
        message: `声明了高风险权限：${riskyPermissions.join(', ')}。后续接入运行隔离前，应保持人工确认。`,
      })
    }
  }

  const highestLevel = issues.reduce<WorkspaceSkillRiskSummary['highestLevel']>(
    (highest, issue) => riskLevelRank(issue.level) > riskLevelRank(highest) ? issue.level : highest,
    'none',
  )

  return {
    issues,
    highestLevel,
    riskyCount: new Set(issues.filter(issue => issue.code === 'risky_permission').map(issue => issue.skillId)).size,
    invalidCount: issues.filter(issue => issue.level === 'danger').length,
    missingPathCount: issues.filter(issue => issue.code === 'missing_path').length,
  }
}

export function buildWorkspaceSkillsPrompt(skills: WorkspaceConfig['skills']): string {
  const enabledSkills = normalizeWorkspaceSkills(skills).filter(skill => skill.enabled !== false)
  if (enabledSkills.length === 0) return ''

  const lines = enabledSkills.map((skill, index) => {
    const parts = [`${index + 1}. ${skill.name}`]
    if (skill.path) parts.push(`path: ${skill.path}`)
    if (skill.description) parts.push(`description: ${skill.description}`)
    if (skill.permissions?.length) parts.push(`permissions: ${skill.permissions.join(', ')}`)
    return `- ${parts.join(' | ')}`
  })

  return `<workspace-skills>\n当前项目建议优先使用以下 Skill。只有当用户需求匹配 Skill 描述时才启用，不要编造不存在的 Skill。\n${lines.join('\n')}\n</workspace-skills>`
}
