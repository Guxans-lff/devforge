/** 连接环境类型 */
export type EnvironmentType = 'production' | 'staging' | 'development' | 'testing' | 'local'

/** 危险 SQL 语句检测结果 */
export interface DangerousStatement {
  /** 危险类型标识 */
  type: string
  /** 危险描述 */
  description: string
  /** 严重程度 */
  severity: 'warning' | 'critical'
  /** 匹配到的 SQL 片段 */
  sql: string
}

/** 环境预设配置 */
export interface EnvironmentPreset {
  /** 环境色（Hex） */
  color: string
  /** 图标名称（lucide 图标） */
  icon: string
  /** 默认是否启用危险操作确认 */
  defaultConfirmDanger: boolean
}

/** 环境预设映射 */
export const ENV_PRESETS: Record<EnvironmentType, EnvironmentPreset> = {
  production: { color: '#EF4444', icon: 'shield-alert', defaultConfirmDanger: true },
  staging: { color: '#F59E0B', icon: 'flask-conical', defaultConfirmDanger: true },
  development: { color: '#10B981', icon: 'code', defaultConfirmDanger: false },
  testing: { color: '#6366F1', icon: 'test-tube', defaultConfirmDanger: false },
  local: { color: '#6B7280', icon: 'laptop', defaultConfirmDanger: false },
}

/** 所有环境类型列表 */
export const ENVIRONMENT_OPTIONS: EnvironmentType[] = [
  'local',
  'development',
  'testing',
  'staging',
  'production',
]
