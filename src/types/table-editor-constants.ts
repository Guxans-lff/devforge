/**
 * 表编辑器常量和辅助类型定义
 * 从 TableEditorPanel.vue 提取，供 useTableEditor composable 使用
 */
import type { ColumnDefinition, IndexDefinition, ForeignKeyDefinition } from './table-editor'

// ===== 撤销/重做历史快照 =====

/** 历史状态快照（用于撤销/重做） */
export interface HistorySnapshot {
  columns: ColumnDefinition[]
  indexes: IndexDefinition[]
  foreignKeys: ForeignKeyDefinition[]
}

// ===== 触发器定义 =====

/** 触发器定义（前端编辑用） */
export interface TriggerDefinition {
  name: string
  timing: string // BEFORE | AFTER
  event: string  // INSERT | UPDATE | DELETE
  body: string
}

// ===== 数据库常用类型列表 =====

/** 常用数据类型列表 */
export const COMMON_TYPES = [
  'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT',
  'VARCHAR', 'CHAR', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'TINYTEXT',
  'DECIMAL', 'FLOAT', 'DOUBLE', 'NUMERIC',
  'DATETIME', 'DATE', 'TIMESTAMP', 'TIME', 'YEAR',
  'BOOLEAN', 'BIT', 'JSON', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB',
  'ENUM', 'SET', 'BINARY', 'VARBINARY',
] as const

/** 类型联动默认长度映射 */
export const TYPE_DEFAULT_LENGTH: Record<string, string | null> = {
  VARCHAR: '255', CHAR: '1', DECIMAL: '10,2', NUMERIC: '10,2', FLOAT: null, DOUBLE: null,
  INT: '11', BIGINT: '20', SMALLINT: '6', TINYINT: '4', MEDIUMINT: '9',
  TEXT: null, MEDIUMTEXT: null, LONGTEXT: null, TINYTEXT: null,
  DATETIME: null, DATE: null, TIMESTAMP: null, TIME: null, YEAR: null,
  BOOLEAN: null, BIT: '1', JSON: null, BLOB: null, MEDIUMBLOB: null, LONGBLOB: null,
  ENUM: null, SET: null, BINARY: null, VARBINARY: '255',
}

/** 不需要长度的类型集合 */
export const NO_LENGTH_TYPES = new Set([
  'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'TINYTEXT',
  'BLOB', 'MEDIUMBLOB', 'LONGBLOB',
  'JSON', 'BOOLEAN', 'DATE', 'YEAR',
])

// ===== 索引 / 外键 / 触发器常量 =====

/** 索引类型列表 */
export const INDEX_TYPES = ['INDEX', 'UNIQUE', 'PRIMARY', 'FULLTEXT'] as const

/** 外键动作列表 */
export const FK_ACTIONS = ['NO ACTION', 'CASCADE', 'SET NULL', 'RESTRICT'] as const

/** 触发器时机列表 */
export const TRIGGER_TIMINGS = ['BEFORE', 'AFTER'] as const

/** 触发器事件列表 */
export const TRIGGER_EVENTS = ['INSERT', 'UPDATE', 'DELETE'] as const

// ===== 字段模板 =====

/** 字段快速模板定义 */
export interface FieldTemplate {
  readonly label: string
  readonly col: Omit<ColumnDefinition, never>
}

/** 预置字段模板（主键、时间戳、软删除等） */
export const FIELD_TEMPLATES: readonly FieldTemplate[] = [
  { label: '主键 ID', col: { name: 'id', dataType: 'BIGINT', length: '20', nullable: false, isPrimaryKey: true, autoIncrement: true, defaultValue: null, onUpdate: null, comment: '主键' } },
  { label: '创建时间', col: { name: 'created_at', dataType: 'DATETIME', length: null, nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: 'CURRENT_TIMESTAMP', onUpdate: null, comment: '创建时间' } },
  { label: '更新时间', col: { name: 'updated_at', dataType: 'DATETIME', length: null, nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP', comment: '更新时间' } },
  { label: '软删除', col: { name: 'deleted', dataType: 'BIT', length: '1', nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: '0', onUpdate: null, comment: '是否删除' } },
  { label: '创建人', col: { name: 'creator', dataType: 'VARCHAR', length: '64', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null, onUpdate: null, comment: '创建人' } },
  { label: '更新人', col: { name: 'updater', dataType: 'VARCHAR', length: '64', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null, onUpdate: null, comment: '更新人' } },
  { label: '租户 ID', col: { name: 'tenant_id', dataType: 'BIGINT', length: '20', nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: '0', onUpdate: null, comment: '租户编号' } },
] as const

/** 撤销/重做最大历史数 */
export const MAX_HISTORY = 50

// ===== SQL 关键字高亮正则 =====

/** MySQL 保留关键字子集（用于列名校验警告） */
export const MYSQL_RESERVED_KEYWORDS = new Set([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TABLE',
  'INDEX', 'FROM', 'WHERE', 'ORDER', 'GROUP', 'BY', 'HAVING', 'LIMIT',
  'JOIN', 'ON', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'TRUE', 'FALSE',
  'IN', 'BETWEEN', 'LIKE', 'IS', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE',
  'END', 'KEY', 'PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'DEFAULT',
  'VALUES', 'SET', 'INTO', 'COLUMN', 'DATABASE', 'SCHEMA', 'IF',
  'GRANT', 'REVOKE', 'COMMIT', 'ROLLBACK', 'BEGIN', 'TRANSACTION',
  'TRIGGER', 'VIEW', 'PROCEDURE', 'FUNCTION', 'RETURN', 'CALL',
  'REPLACE', 'TRUNCATE', 'LOCK', 'UNLOCK', 'USE', 'SHOW', 'DESCRIBE',
])

/** SQL 关键字列表（用于语法高亮） */
const SQL_KEYWORDS_PATTERN = /\b(CREATE|TABLE|ALTER|ADD|MODIFY|DROP|COLUMN|INDEX|PRIMARY|KEY|UNIQUE|FOREIGN|REFERENCES|NOT|NULL|DEFAULT|AUTO_INCREMENT|ON|UPDATE|DELETE|CASCADE|SET|ENGINE|CHARSET|COLLATE|COMMENT|IF|EXISTS|INT|BIGINT|VARCHAR|CHAR|TEXT|DECIMAL|DATETIME|TIMESTAMP|DATE|BOOLEAN|JSON|BLOB|ENUM|FLOAT|DOUBLE|AFTER|FIRST|CONSTRAINT|FULLTEXT|USING|BTREE|HASH|TINYINT|SMALLINT|MEDIUMINT|MEDIUMTEXT|LONGTEXT|VARBINARY|BINARY|BIT|YEAR|TIME|NUMERIC|UNSIGNED|CHARACTER)\b/gi

/**
 * SQL 语法高亮（简单正则着色，返回 HTML 字符串）
 * 纯函数，不依赖响应式状态
 */
/** SQL 语法高亮（安全：先转义 HTML 实体再插入 span 标签，防止 XSS） */
export function highlightSql(sql: string): string {
  if (!sql) return ''
  // 先转义 HTML
  let escaped = sql.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // 用占位符保护字符串字面量
  const strings: string[] = []
  escaped = escaped.replace(/'[^']*'/g, (m) => { strings.push(m); return `__STR${strings.length - 1}__` })
  // 高亮关键字（先用占位符）
  const kwSpans: string[] = []
  escaped = escaped.replace(SQL_KEYWORDS_PATTERN,
    (m) => { kwSpans.push(m); return `__KW${kwSpans.length - 1}__` })
  // 高亮数字
  escaped = escaped.replace(/\b(\d+)\b/g, '<span class="text-df-warning">$1</span>')
  // 还原关键字
  escaped = escaped.replace(/__KW(\d+)__/g, (_, i) => `<span class="text-primary">${kwSpans[Number(i)]}</span>`)
  // 还原字符串字面量
  escaped = escaped.replace(/__STR(\d+)__/g, (_, i) => `<span class="text-df-success">${strings[Number(i)]}</span>`)
  return escaped
}
