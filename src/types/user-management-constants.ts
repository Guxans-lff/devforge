/**
 * 用户管理常量定义
 * 从 UserManagementPanel.vue 提取，供 composable 和子组件使用
 */

/** 权限备注映射 */
export const PRIV_LABELS: Record<string, string> = {
  'SELECT': '查询数据',
  'INSERT': '插入数据',
  'UPDATE': '更新数据',
  'DELETE': '删除数据',
  'CREATE': '创建对象',
  'DROP': '删除对象',
  'GRANT OPTION': '授权权限',
  'SUPER': '超级管理',
  'PROCESS': '查看进程',
  'EVENT': '事件管理',
  'TRIGGER': '触发器管理',
}

/** 分类后的全局权限 */
export const CATEGORIZED_GLOBAL_PRIVILEGES: Record<string, string[]> = {
  '管理权限': [
    'GRANT OPTION', 'SUPER', 'PROCESS', 'RELOAD', 'SHUTDOWN',
    'SHOW DATABASES', 'LOCK TABLES', 'REPLICATION SLAVE',
    'REPLICATION CLIENT', 'CREATE USER', 'CREATE TABLESPACE',
  ],
}

/** 所有支持显示的全局权限列表 */
export const ALL_PRIVS_LIST = Object.values(CATEGORIZED_GLOBAL_PRIVILEGES).flat()

/** 数据库级可用权限列表 */
export const DB_LEVEL_PRIVS = [
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP',
  'ALTER', 'INDEX', 'CREATE VIEW', 'SHOW VIEW', 'CREATE ROUTINE',
  'ALTER ROUTINE', 'EXECUTE', 'TRIGGER', 'EVENT', 'REFERENCES',
]
