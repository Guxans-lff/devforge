

export interface SqlSnippetTemplate {
  label: string
  detail: string
  documentation: string
  insertText: string
}

// 通用 SQL 代码片段
const COMMON_SNIPPETS: SqlSnippetTemplate[] = [
  {
    label: 'SELECT',
    detail: 'SELECT 查询',
    documentation: '基础 SELECT 查询语句',
    insertText: 'SELECT ${1:*} FROM ${2:table_name} WHERE ${3:1=1}',
  },
  {
    label: 'SELECT JOIN',
    detail: 'SELECT JOIN 查询',
    documentation: '带 JOIN 的 SELECT 查询',
    insertText:
      'SELECT ${1:a.*}\nFROM ${2:table1} ${3:a}\nINNER JOIN ${4:table2} ${5:b} ON ${3:a}.${6:id} = ${5:b}.${7:id}\nWHERE ${8:1=1}',
  },
  {
    label: 'SELECT LEFT JOIN',
    detail: 'SELECT LEFT JOIN',
    documentation: '带 LEFT JOIN 的 SELECT 查询',
    insertText:
      'SELECT ${1:a.*}\nFROM ${2:table1} ${3:a}\nLEFT JOIN ${4:table2} ${5:b} ON ${3:a}.${6:id} = ${5:b}.${7:id}\nWHERE ${8:1=1}',
  },
  {
    label: 'SELECT COUNT',
    detail: 'SELECT COUNT 统计',
    documentation: '统计行数',
    insertText: 'SELECT COUNT(*) AS cnt FROM ${1:table_name} WHERE ${2:1=1}',
  },
  {
    label: 'SELECT GROUP BY',
    detail: 'SELECT GROUP BY 分组',
    documentation: '分组聚合查询',
    insertText:
      'SELECT ${1:column}, COUNT(*) AS cnt\nFROM ${2:table_name}\nWHERE ${3:1=1}\nGROUP BY ${1:column}\nORDER BY cnt DESC',
  },
  {
    label: 'SELECT DISTINCT',
    detail: 'SELECT DISTINCT 去重',
    documentation: '去重查询',
    insertText: 'SELECT DISTINCT ${1:column} FROM ${2:table_name} WHERE ${3:1=1}',
  },
  {
    label: 'SELECT SUBQUERY',
    detail: 'SELECT 子查询',
    documentation: '带子查询的 SELECT',
    insertText:
      'SELECT ${1:*}\nFROM ${2:table_name}\nWHERE ${3:column} IN (\n  SELECT ${4:column} FROM ${5:table2} WHERE ${6:1=1}\n)',
  },
  {
    label: 'SELECT EXISTS',
    detail: 'SELECT EXISTS 存在性检查',
    documentation: '使用 EXISTS 子查询',
    insertText:
      'SELECT ${1:*}\nFROM ${2:table1} a\nWHERE EXISTS (\n  SELECT 1 FROM ${3:table2} b WHERE b.${4:id} = a.${5:id}\n)',
  },
  {
    label: 'SELECT PAGINATION',
    detail: 'SELECT 分页查询',
    documentation: '分页查询模板',
    insertText: 'SELECT ${1:*}\nFROM ${2:table_name}\nWHERE ${3:1=1}\nORDER BY ${4:id}\nLIMIT ${5:10} OFFSET ${6:0}',
  },
  {
    label: 'INSERT INTO',
    detail: 'INSERT 插入',
    documentation: '插入单行数据',
    insertText: 'INSERT INTO ${1:table_name} (${2:column1}, ${3:column2})\nVALUES (${4:value1}, ${5:value2})',
  },
  {
    label: 'INSERT MULTI',
    detail: 'INSERT 批量插入',
    documentation: '批量插入多行数据',
    insertText:
      'INSERT INTO ${1:table_name} (${2:column1}, ${3:column2})\nVALUES\n  (${4:value1}, ${5:value2}),\n  (${6:value3}, ${7:value4})',
  },
  {
    label: 'INSERT SELECT',
    detail: 'INSERT SELECT 插入查询结果',
    documentation: '从查询结果插入',
    insertText:
      'INSERT INTO ${1:target_table} (${2:column1}, ${3:column2})\nSELECT ${4:column1}, ${5:column2}\nFROM ${6:source_table}\nWHERE ${7:1=1}',
  },
  {
    label: 'UPDATE',
    detail: 'UPDATE 更新',
    documentation: '更新数据',
    insertText: 'UPDATE ${1:table_name}\nSET ${2:column1} = ${3:value1}\nWHERE ${4:condition}',
  },
  {
    label: 'DELETE FROM',
    detail: 'DELETE 删除',
    documentation: '删除数据',
    insertText: 'DELETE FROM ${1:table_name} WHERE ${2:condition}',
  },
  {
    label: 'CREATE TABLE',
    detail: 'CREATE TABLE 建表',
    documentation: '创建新表',
    insertText:
      'CREATE TABLE ${1:table_name} (\n  ${2:id} BIGINT PRIMARY KEY AUTO_INCREMENT,\n  ${3:name} VARCHAR(${4:255}) NOT NULL,\n  ${5:created_at} DATETIME DEFAULT CURRENT_TIMESTAMP,\n  ${6:updated_at} DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP\n)',
  },
  {
    label: 'ALTER TABLE ADD',
    detail: 'ALTER TABLE 添加列',
    documentation: '添加新列',
    insertText: 'ALTER TABLE ${1:table_name} ADD COLUMN ${2:column_name} ${3:VARCHAR(255)} ${4:NOT NULL}',
  },
  {
    label: 'ALTER TABLE MODIFY',
    detail: 'ALTER TABLE 修改列',
    documentation: '修改列定义',
    insertText: 'ALTER TABLE ${1:table_name} MODIFY COLUMN ${2:column_name} ${3:VARCHAR(255)} ${4:NOT NULL}',
  },
  {
    label: 'ALTER TABLE DROP',
    detail: 'ALTER TABLE 删除列',
    documentation: '删除列',
    insertText: 'ALTER TABLE ${1:table_name} DROP COLUMN ${2:column_name}',
  },
  {
    label: 'CREATE INDEX',
    detail: 'CREATE INDEX 创建索引',
    documentation: '创建索引',
    insertText: 'CREATE INDEX ${1:idx_name} ON ${2:table_name} (${3:column_name})',
  },
  {
    label: 'DROP TABLE',
    detail: 'DROP TABLE 删除表',
    documentation: '删除表（谨慎使用）',
    insertText: 'DROP TABLE IF EXISTS ${1:table_name}',
  },
  {
    label: 'TRUNCATE TABLE',
    detail: 'TRUNCATE TABLE 清空表',
    documentation: '清空表数据（谨慎使用）',
    insertText: 'TRUNCATE TABLE ${1:table_name}',
  },
  {
    label: 'CASE WHEN',
    detail: 'CASE WHEN 条件表达式',
    documentation: 'CASE WHEN 条件分支',
    insertText:
      'CASE\n  WHEN ${1:condition1} THEN ${2:result1}\n  WHEN ${3:condition2} THEN ${4:result2}\n  ELSE ${5:default}\nEND',
  },
  {
    label: 'CTE',
    detail: 'WITH CTE 公共表表达式',
    documentation: '公共表表达式',
    insertText:
      'WITH ${1:cte_name} AS (\n  SELECT ${2:*}\n  FROM ${3:table_name}\n  WHERE ${4:1=1}\n)\nSELECT * FROM ${1:cte_name}',
  },
  {
    label: 'WINDOW FUNCTION',
    detail: '窗口函数',
    documentation: 'ROW_NUMBER 窗口函数',
    insertText:
      'SELECT ${1:*},\n  ROW_NUMBER() OVER (PARTITION BY ${2:column} ORDER BY ${3:column}) AS rn\nFROM ${4:table_name}',
  },
]

// MySQL 特有函数（带签名提示）
export const MYSQL_FUNCTIONS: SqlSnippetTemplate[] = [
  { label: 'GROUP_CONCAT', detail: 'GROUP_CONCAT(expr [SEPARATOR str])', documentation: '将分组中的值连接为字符串', insertText: 'GROUP_CONCAT(${1:column} SEPARATOR ${2:\',\'})' },
  { label: 'FIND_IN_SET', detail: 'FIND_IN_SET(str, strlist)', documentation: '在逗号分隔的字符串列表中查找', insertText: 'FIND_IN_SET(${1:str}, ${2:strlist})' },
  { label: 'INET_ATON', detail: 'INET_ATON(expr)', documentation: 'IP 地址转整数', insertText: 'INET_ATON(${1:ip})' },
  { label: 'INET_NTOA', detail: 'INET_NTOA(expr)', documentation: '整数转 IP 地址', insertText: 'INET_NTOA(${1:num})' },
  { label: 'UUID', detail: 'UUID()', documentation: '生成 UUID', insertText: 'UUID()' },
  { label: 'JSON_EXTRACT', detail: 'JSON_EXTRACT(json, path)', documentation: '从 JSON 中提取值', insertText: 'JSON_EXTRACT(${1:column}, \'$.${2:key}\')' },
  { label: 'JSON_SET', detail: 'JSON_SET(json, path, val)', documentation: '设置 JSON 值', insertText: 'JSON_SET(${1:column}, \'$.${2:key}\', ${3:value})' },
  { label: 'JSON_UNQUOTE', detail: 'JSON_UNQUOTE(json_val)', documentation: '去除 JSON 值的引号', insertText: 'JSON_UNQUOTE(${1:json_val})' },
  { label: 'JSON_ARRAYAGG', detail: 'JSON_ARRAYAGG(col)', documentation: '聚合为 JSON 数组', insertText: 'JSON_ARRAYAGG(${1:column})' },
  { label: 'JSON_OBJECTAGG', detail: 'JSON_OBJECTAGG(key, val)', documentation: '聚合为 JSON 对象', insertText: 'JSON_OBJECTAGG(${1:key}, ${2:value})' },
  { label: 'STR_TO_DATE', detail: 'STR_TO_DATE(str, format)', documentation: '字符串转日期', insertText: 'STR_TO_DATE(${1:str}, \'${2:%Y-%m-%d}\')' },
  { label: 'DATE_FORMAT', detail: 'DATE_FORMAT(date, format)', documentation: '日期格式化', insertText: 'DATE_FORMAT(${1:date}, \'${2:%Y-%m-%d %H:%i:%s}\')' },
  { label: 'TIMESTAMPDIFF', detail: 'TIMESTAMPDIFF(unit, begin, end)', documentation: '计算时间差', insertText: 'TIMESTAMPDIFF(${1:DAY}, ${2:start_date}, ${3:end_date})' },
  { label: 'IFNULL', detail: 'IFNULL(expr1, expr2)', documentation: '如果 expr1 为 NULL 则返回 expr2', insertText: 'IFNULL(${1:expr}, ${2:default})' },
  { label: 'COALESCE', detail: 'COALESCE(val1, val2, ...)', documentation: '返回第一个非 NULL 值', insertText: 'COALESCE(${1:val1}, ${2:val2})' },
  { label: 'CONCAT_WS', detail: 'CONCAT_WS(separator, str1, str2, ...)', documentation: '用分隔符连接字符串', insertText: 'CONCAT_WS(${1:\',\'}, ${2:str1}, ${3:str2})' },
  { label: 'SUBSTRING_INDEX', detail: 'SUBSTRING_INDEX(str, delim, count)', documentation: '按分隔符截取子串', insertText: 'SUBSTRING_INDEX(${1:str}, ${2:\',\'}, ${3:1})' },
  { label: 'REGEXP_REPLACE', detail: 'REGEXP_REPLACE(str, pattern, replace)', documentation: '正则替换', insertText: 'REGEXP_REPLACE(${1:str}, ${2:pattern}, ${3:replace})' },
  { label: 'REGEXP_LIKE', detail: 'REGEXP_LIKE(str, pattern)', documentation: '正则匹配', insertText: 'REGEXP_LIKE(${1:str}, ${2:pattern})' },
]

export function getSnippetTemplates(_driver?: string): SqlSnippetTemplate[] {
  return COMMON_SNIPPETS
}

export function getExtraFunctions(driver?: string): SqlSnippetTemplate[] {
  if (driver === 'mysql') return MYSQL_FUNCTIONS
  return []
}
