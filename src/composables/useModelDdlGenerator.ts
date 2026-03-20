/**
 * MySQL DDL 生成器
 *
 * 将建模数据（ModelProject / ModelTable）转换为标准 MySQL DDL 语句。
 * 纯前端逻辑，不涉及后端 Rust 代码。
 */

import type { ModelColumn, ModelProject, ModelRelation, ModelTable } from '@/types/er-modeling'
import { TYPES_WITH_LENGTH } from '@/types/er-modeling'

/** 转义 MySQL 标识符（反引号） */
function esc(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}

/** 生成列类型字符串，如 VARCHAR(255) 或 INT */
function buildColumnType(col: ModelColumn): string {
  const upper = col.dataType.toUpperCase()
  if (col.length != null && col.length > 0 && TYPES_WITH_LENGTH.has(upper)) {
    return `${upper}(${col.length})`
  }
  return upper
}

/** 生成单列定义 */
function buildColumnDef(col: ModelColumn): string {
  const parts: string[] = [esc(col.name), buildColumnType(col)]

  if (!col.nullable) {
    parts.push('NOT NULL')
  } else {
    parts.push('NULL')
  }

  if (col.defaultValue != null && col.defaultValue !== '') {
    // 数值型默认值不加引号，其它加引号
    const isNumeric = /^-?\d+(\.\d+)?$/.test(col.defaultValue)
    const isKeyword = /^(CURRENT_TIMESTAMP|NULL|TRUE|FALSE)$/i.test(col.defaultValue)
    if (isNumeric || isKeyword) {
      parts.push(`DEFAULT ${col.defaultValue}`)
    } else {
      parts.push(`DEFAULT '${col.defaultValue.replace(/'/g, "''")}'`)
    }
  }

  if (col.isAutoIncrement) {
    parts.push('AUTO_INCREMENT')
  }

  if (col.comment) {
    parts.push(`COMMENT '${col.comment.replace(/'/g, "''")}'`)
  }

  return parts.join(' ')
}

/**
 * 生成单张表的 CREATE TABLE DDL
 */
export function generateCreateTableDdl(
  table: ModelTable,
  relations: ModelRelation[] = [],
  tableMap?: Map<string, ModelTable>,
): string {
  const lines: string[] = []

  // 列定义
  for (const col of table.columns) {
    lines.push(`  ${buildColumnDef(col)}`)
  }

  // 主键
  const pkCols = table.columns.filter(c => c.isPrimaryKey)
  if (pkCols.length > 0) {
    lines.push(`  PRIMARY KEY (${pkCols.map(c => esc(c.name)).join(', ')})`)
  }

  // 唯一键
  const uniqueCols = table.columns.filter(c => c.isUnique && !c.isPrimaryKey)
  for (const col of uniqueCols) {
    lines.push(`  UNIQUE KEY ${esc(`uk_${col.name}`)} (${esc(col.name)})`)
  }

  // 外键（当前表作为源）
  const fks = relations.filter(r => r.sourceTableId === table.id)
  for (const fk of fks) {
    if (!tableMap) continue
    const targetTable = tableMap.get(fk.targetTableId)
    if (!targetTable) continue
    const sourceCol = table.columns.find(c => c.id === fk.sourceColumnId)
    const targetCol = targetTable.columns.find(c => c.id === fk.targetColumnId)
    if (!sourceCol || !targetCol) continue

    let fkDef = `  CONSTRAINT ${esc(`fk_${table.name}_${sourceCol.name}`)} FOREIGN KEY (${esc(sourceCol.name)}) REFERENCES ${esc(targetTable.name)} (${esc(targetCol.name)})`
    if (fk.onDelete) fkDef += ` ON DELETE ${fk.onDelete}`
    if (fk.onUpdate) fkDef += ` ON UPDATE ${fk.onUpdate}`
    lines.push(fkDef)
  }

  // 组装
  const engine = table.engine || 'InnoDB'
  const charset = table.charset || 'utf8mb4'
  let ddl = `CREATE TABLE ${esc(table.name)} (\n${lines.join(',\n')}\n)`
  ddl += ` ENGINE=${engine} DEFAULT CHARSET=${charset}`
  if (table.comment) {
    ddl += ` COMMENT='${table.comment.replace(/'/g, "''")}'`
  }
  ddl += ';'

  return ddl
}

/**
 * 生成整个项目的 DDL（所有表 + 外键）
 */
export function generateProjectDdl(project: ModelProject): string {
  const tableMap = new Map(project.tables.map(t => [t.id, t]))
  const parts: string[] = []

  parts.push(`-- DevForge Model: ${project.name}`)
  parts.push(`-- 方言: MySQL`)
  parts.push(`-- 生成时间: ${new Date().toISOString()}`)
  parts.push('')

  for (const table of project.tables) {
    parts.push(generateCreateTableDdl(table, project.relations, tableMap))
    parts.push('')
  }

  return parts.join('\n')
}

/**
 * DDL 生成器 composable（响应式包装）
 */
export function useModelDdlGenerator() {
  return {
    generateCreateTableDdl,
    generateProjectDdl,
  }
}
