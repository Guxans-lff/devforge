export interface AiPathSafetyResult {
  safe: boolean
  normalizedPath?: string
  reason?: string
  requiresConfirmation?: boolean
}

const DANGEROUS_DIRS = new Set(['.git', '.idea', '.vscode', '.claude', '.devforge'])
const DANGEROUS_FILES = new Set([
  '.gitconfig',
  '.gitmodules',
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.zprofile',
  '.profile',
  '.mcp.json',
  '.claude.json',
])

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/')
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path)
}

function normalizePath(path: string): string {
  const raw = normalizeSlashes(path.trim())
  const driveMatch = raw.match(/^[A-Za-z]:/)
  const drivePrefix = driveMatch?.[0] ?? ''
  const withoutDrive = drivePrefix ? raw.slice(drivePrefix.length) : raw
  const absolute = withoutDrive.startsWith('/')
  const parts: string[] = []

  for (const segment of withoutDrive.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') {
        parts.pop()
      } else if (!absolute) {
        parts.push('..')
      }
      continue
    }
    parts.push(segment)
  }

  const prefix = drivePrefix ? `${drivePrefix}/` : absolute ? '/' : ''
  return `${prefix}${parts.join('/')}`.replace(/\/$/, '') || (absolute ? '/' : '.')
}

function resolveAgainstWorkDir(path: string, workDir: string): string {
  const normalizedPath = normalizePath(path)
  if (isAbsolutePath(normalizedPath)) return normalizedPath
  return normalizePath(`${workDir}/${normalizedPath}`)
}

function pathParts(path: string): string[] {
  const normalized = normalizeSlashes(path)
  const withoutDrive = normalized.replace(/^[A-Za-z]:\//, '')
  return withoutDrive.split('/').filter(Boolean)
}

function isInsideOrEqual(path: string, root: string): boolean {
  const normalizedPath = normalizePath(path).toLowerCase()
  const normalizedRoot = normalizePath(root).toLowerCase()
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

export function checkWritePathSafety(path: string | undefined, workDir: string | undefined): AiPathSafetyResult {
  if (!path || !path.trim()) {
    return { safe: false, reason: '写入工具缺少 path 参数。' }
  }
  if (!workDir || !workDir.trim()) {
    return { safe: false, reason: '未设置工作目录，拒绝自动写入。' }
  }

  const normalizedWorkDir = normalizePath(workDir)
  const normalizedPath = resolveAgainstWorkDir(path, normalizedWorkDir)

  if (!isInsideOrEqual(normalizedPath, normalizedWorkDir)) {
    return {
      safe: false,
      normalizedPath,
      reason: `拒绝自动写入工作区外路径：${normalizedPath}`,
      requiresConfirmation: true,
    }
  }

  const parts = pathParts(normalizedPath)
  const fileName = parts[parts.length - 1] ?? ''
  const dangerousDir = parts.find(part => DANGEROUS_DIRS.has(part))
  if (dangerousDir) {
    return {
      safe: false,
      normalizedPath,
      reason: `拒绝自动编辑敏感目录 ${dangerousDir}/ 下的文件。`,
      requiresConfirmation: true,
    }
  }

  if (DANGEROUS_FILES.has(fileName)) {
    return {
      safe: false,
      normalizedPath,
      reason: `拒绝自动编辑敏感配置文件 ${fileName}。`,
      requiresConfirmation: true,
    }
  }

  return { safe: true, normalizedPath }
}
