/**
 * 可视化数据建模 — 类型定义
 *
 * 用于建模模式下的数据结构，与只读 ER 图类型（er-diagram.ts）独立。
 * 持久化为 .dfmodel（JSON）文件。
 */

/** 建模项目 */
export interface ModelProject {
  /** 版本号，用于后续兼容性迁移 */
  version: 1
  /** 项目名称 */
  name: string
  /** 数据库方言（当前仅支持 MySQL） */
  dialect: 'mysql'
  /** 所有表 */
  tables: ModelTable[]
  /** 所有外键关系 */
  relations: ModelRelation[]
}

/** 建模表 */
export interface ModelTable {
  /** 唯一标识（UUID） */
  id: string
  /** 表名 */
  name: string
  /** 画布上的位置 */
  position: { x: number; y: number }
  /** 列定义列表 */
  columns: ModelColumn[]
  /** 表注释 */
  comment?: string
  /** 存储引擎，如 InnoDB、MyISAM */
  engine?: string
  /** 字符集，如 utf8mb4 */
  charset?: string
}

/** 建模列 */
export interface ModelColumn {
  /** 唯一标识（UUID） */
  id: string
  /** 列名 */
  name: string
  /** 数据类型，如 INT、VARCHAR、TEXT */
  dataType: string
  /** 类型长度，如 VARCHAR(255) 中的 255 */
  length?: number
  /** 是否允许 NULL */
  nullable: boolean
  /** 默认值 */
  defaultValue?: string
  /** 是否为主键 */
  isPrimaryKey: boolean
  /** 是否自增 */
  isAutoIncrement: boolean
  /** 是否唯一 */
  isUnique: boolean
  /** 列注释 */
  comment?: string
}

/** 建模外键关系 */
export interface ModelRelation {
  /** 唯一标识（UUID） */
  id: string
  /** 源表 ID */
  sourceTableId: string
  /** 源列 ID */
  sourceColumnId: string
  /** 目标表 ID */
  targetTableId: string
  /** 目标列 ID */
  targetColumnId: string
  /** 删除时行为：CASCADE | SET NULL | RESTRICT | NO ACTION */
  onDelete?: string
  /** 更新时行为 */
  onUpdate?: string
}

/** 创建空白项目的工厂函数 */
export function createEmptyProject(name: string): ModelProject {
  return {
    version: 1,
    name,
    dialect: 'mysql',
    tables: [],
    relations: [],
  }
}

/** 创建空白列的工厂函数 */
export function createDefaultColumn(id: string, name: string): ModelColumn {
  return {
    id,
    name,
    dataType: 'VARCHAR',
    length: 255,
    nullable: true,
    isPrimaryKey: false,
    isAutoIncrement: false,
    isUnique: false,
  }
}

/** MySQL 常用数据类型列表 */
export const MYSQL_DATA_TYPES = [
  // 整数
  'TINYINT',
  'SMALLINT',
  'MEDIUMINT',
  'INT',
  'BIGINT',
  // 浮点
  'FLOAT',
  'DOUBLE',
  'DECIMAL',
  // 字符串
  'CHAR',
  'VARCHAR',
  'TINYTEXT',
  'TEXT',
  'MEDIUMTEXT',
  'LONGTEXT',
  // 二进制
  'BINARY',
  'VARBINARY',
  'TINYBLOB',
  'BLOB',
  'MEDIUMBLOB',
  'LONGBLOB',
  // 日期时间
  'DATE',
  'TIME',
  'DATETIME',
  'TIMESTAMP',
  'YEAR',
  // 其他
  'BOOLEAN',
  'ENUM',
  'SET',
  'JSON',
] as const

/** 需要指定长度的数据类型 */
export const TYPES_WITH_LENGTH = new Set([
  'CHAR',
  'VARCHAR',
  'BINARY',
  'VARBINARY',
  'DECIMAL',
  'FLOAT',
  'DOUBLE',
  'TINYINT',
  'SMALLINT',
  'MEDIUMINT',
  'INT',
  'BIGINT',
])

/** 外键动作列表 */
export const FK_ACTIONS = [
  'RESTRICT',
  'CASCADE',
  'SET NULL',
  'NO ACTION',
] as const
