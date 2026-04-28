import type { GitDiff, GitFileDiff } from '@/types/git'

export type PatchReviewSeverity = 'low' | 'medium' | 'high'

export interface PatchReviewRisk {
  severity: PatchReviewSeverity
  title: string
  detail: string
  path?: string
}

export interface PatchReviewFileSummary {
  path: string
  status: string
  insertions: number
  deletions: number
  riskLevel: PatchReviewSeverity
  reasons: string[]
}

export interface PatchReviewImpactGroup {
  key: string
  label: string
  files: string[]
  riskLevel: PatchReviewSeverity
}

export interface PatchReviewReport {
  totalFiles: number
  insertions: number
  deletions: number
  riskLevel: PatchReviewSeverity
  summary: string
  risks: PatchReviewRisk[]
  files: PatchReviewFileSummary[]
  impactGroups: PatchReviewImpactGroup[]
  suggestedCommands: string[]
  generatedAt: number
}

const HIGH_RISK_PATTERNS = [
  /(^|\/)(src-tauri|tauri)\//i,
  /(^|\/)(package\.json|pnpm-lock\.yaml|Cargo\.toml|Cargo\.lock)$/i,
  /(^|\/)(\.github\/workflows|Dockerfile|docker-compose)/i,
  /(^|\/)(auth|permission|credential|secret|token|security)/i,
  /(^|\/)(migration|schema|database|db)\//i,
]

const TEST_PATTERNS = [
  /(^|\/)(__tests__|tests?)\//i,
  /\.(test|spec)\.(ts|tsx|js|jsx|vue)$/i,
]

function countFileLines(file: GitFileDiff): { insertions: number; deletions: number } {
  let insertions = 0
  let deletions = 0
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.origin === '+') insertions += 1
      if (line.origin === '-') deletions += 1
    }
  }
  return { insertions, deletions }
}

function maxSeverity(left: PatchReviewSeverity, right: PatchReviewSeverity): PatchReviewSeverity {
  const order: PatchReviewSeverity[] = ['low', 'medium', 'high']
  return order.indexOf(left) >= order.indexOf(right) ? left : right
}

function impactKey(path: string): { key: string; label: string; riskLevel: PatchReviewSeverity } {
  if (path.startsWith('src-tauri/')) return { key: 'backend', label: '后端 / Tauri', riskLevel: 'high' }
  if (path.startsWith('src/components/') || path.startsWith('src/views/')) return { key: 'ui', label: '前端 UI', riskLevel: 'medium' }
  if (path.startsWith('src/composables/') || path.startsWith('src/stores/')) return { key: 'runtime', label: '前端运行时 / 状态', riskLevel: 'medium' }
  if (path.startsWith('src/ai-gateway/')) return { key: 'gateway', label: 'Provider Gateway', riskLevel: 'high' }
  if (path.startsWith('src/ai-gui/')) return { key: 'ai-gui', label: 'AI GUI 能力', riskLevel: 'medium' }
  if (path.startsWith('docs/')) return { key: 'docs', label: '文档', riskLevel: 'low' }
  if (/package\.json|pnpm-lock\.yaml|Cargo\.toml|Cargo\.lock/.test(path)) return { key: 'deps', label: '依赖 / 构建配置', riskLevel: 'high' }
  return { key: 'other', label: '其它', riskLevel: 'low' }
}

function analyzeFile(file: GitFileDiff): PatchReviewFileSummary {
  const { insertions, deletions } = countFileLines(file)
  const touchedLines = insertions + deletions
  const reasons: string[] = []
  let riskLevel: PatchReviewSeverity = 'low'

  if (file.isBinary) {
    riskLevel = 'medium'
    reasons.push('二进制文件无法做文本级审查')
  }
  if (file.status === 'deleted') {
    riskLevel = maxSeverity(riskLevel, 'medium')
    reasons.push('删除文件需要确认引用与回滚路径')
  }
  if (HIGH_RISK_PATTERNS.some(pattern => pattern.test(file.path))) {
    riskLevel = maxSeverity(riskLevel, 'high')
    reasons.push('命中配置、安全、后端或数据层高风险路径')
  }
  if (touchedLines > 250) {
    riskLevel = maxSeverity(riskLevel, 'high')
    reasons.push('单文件变更超过 250 行')
  } else if (touchedLines > 80) {
    riskLevel = maxSeverity(riskLevel, 'medium')
    reasons.push('单文件变更超过 80 行')
  }

  return { path: file.path, status: file.status, insertions, deletions, riskLevel, reasons }
}

function buildImpactGroups(files: PatchReviewFileSummary[]): PatchReviewImpactGroup[] {
  const groups = new Map<string, PatchReviewImpactGroup>()
  for (const file of files) {
    const meta = impactKey(file.path)
    const current = groups.get(meta.key) ?? { key: meta.key, label: meta.label, files: [], riskLevel: meta.riskLevel }
    current.files.push(file.path)
    current.riskLevel = maxSeverity(current.riskLevel, file.riskLevel)
    groups.set(meta.key, current)
  }
  return Array.from(groups.values()).sort((left, right) => right.files.length - left.files.length)
}

function buildRisks(files: PatchReviewFileSummary[], diff: GitDiff): PatchReviewRisk[] {
  const risks: PatchReviewRisk[] = []
  if (diff.stats.filesChanged > 20) risks.push({ severity: 'high', title: '变更文件过多', detail: '建议拆分提交或按模块分批验证。' })
  if (diff.stats.insertions + diff.stats.deletions > 1000) risks.push({ severity: 'high', title: '变更规模过大', detail: '建议优先跑全量类型检查、核心单测和构建。' })
  for (const file of files) {
    for (const reason of file.reasons) {
      risks.push({ severity: file.riskLevel, title: reason, detail: `${file.status} ${file.insertions}+/${file.deletions}-`, path: file.path })
    }
  }
  if (files.length > 0 && !files.some(file => TEST_PATTERNS.some(pattern => pattern.test(file.path)))) {
    risks.push({ severity: 'medium', title: '未发现测试变更', detail: '如是行为变更，建议补充或至少运行相邻测试。' })
  }
  return risks
}

function suggestCommands(files: PatchReviewFileSummary[]): string[] {
  const commands = new Set<string>()
  const hasFrontend = files.some(file => /(^|\/)src\//.test(file.path) || /\.(vue|ts|tsx|js|jsx)$/.test(file.path))
  const hasRust = files.some(file => /(^|\/)src-tauri\//.test(file.path) || /\.(rs|toml)$/.test(file.path))
  const hasTests = files.some(file => TEST_PATTERNS.some(pattern => pattern.test(file.path)))

  if (hasFrontend) commands.add('pnpm vitest run')
  if (hasTests) commands.add('pnpm test:unit')
  if (hasFrontend) commands.add('pnpm test:typecheck')
  if (hasRust) commands.add('pnpm check:rust')
  return Array.from(commands)
}

function buildSummary(riskLevel: PatchReviewSeverity, diff: GitDiff, groups: PatchReviewImpactGroup[], risks: PatchReviewRisk[]): string {
  const groupText = groups.slice(0, 3).map(group => `${group.label} ${group.files.length}`).join('，') || '无明显影响面'
  const highRiskCount = risks.filter(risk => risk.severity === 'high').length
  return `风险 ${riskLevel}；变更 ${diff.stats.filesChanged} 个文件，+${diff.stats.insertions}/-${diff.stats.deletions}；影响面：${groupText}；高风险 ${highRiskCount} 项。`
}

export function analyzePatchReview(diff: GitDiff): PatchReviewReport {
  const files = diff.files.map(analyzeFile)
  const risks = buildRisks(files, diff)
  const impactGroups = buildImpactGroups(files)
  const riskLevel = risks.reduce<PatchReviewSeverity>((level, risk) => maxSeverity(level, risk.severity), 'low')
  return {
    totalFiles: diff.stats.filesChanged,
    insertions: diff.stats.insertions,
    deletions: diff.stats.deletions,
    riskLevel,
    summary: buildSummary(riskLevel, diff, impactGroups, risks),
    risks,
    files,
    impactGroups,
    suggestedCommands: suggestCommands(files),
    generatedAt: Date.now(),
  }
}
