import { detectDangerousStatements, isMutationStatement, isReadOnlyStatement } from '../dangerousSqlDetector'

// ────────────────────────────────────────────────────────────
// detectDangerousStatements 测试套件
// ────────────────────────────────────────────────────────────
describe('detectDangerousStatements', () => {
  // ── 空输入 ──────────────────────────────────────────────
  describe('空 / 空白 SQL 输入', () => {
    it('空字符串应返回空数组', () => {
      expect(detectDangerousStatements('')).toEqual([])
    })

    it('纯空白字符串应返回空数组', () => {
      expect(detectDangerousStatements('   \n\t  ')).toEqual([])
    })

    it('null / undefined 应返回空数组', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(detectDangerousStatements(null as any)).toEqual([])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(detectDangerousStatements(undefined as any)).toEqual([])
    })
  })

  // ── 基础检测：每种危险类型的正例 ──────────────────────────
  describe('DROP_TABLE — critical', () => {
    it('应检测到标准 DROP TABLE 语句', () => {
      const result = detectDangerousStatements('DROP TABLE users;')
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('DROP_TABLE')
      expect(result[0].severity).toBe('critical')
    })

    it('description 应为 i18n key', () => {
      const result = detectDangerousStatements('DROP TABLE users;')
      expect(result[0].description).toBe('environment.dangerDropTable')
    })

    it('sql 字段应包含匹配片段', () => {
      const result = detectDangerousStatements('DROP TABLE users;')
      expect(result[0].sql).toContain('DROP TABLE')
    })
  })

  describe('DROP_DATABASE — critical', () => {
    it('应检测到 DROP DATABASE 语句', () => {
      const result = detectDangerousStatements('DROP DATABASE mydb;')
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('DROP_DATABASE')
      expect(result[0].severity).toBe('critical')
    })
  })

  describe('TRUNCATE — critical', () => {
    it('应检测到 TRUNCATE TABLE 语句', () => {
      const result = detectDangerousStatements('TRUNCATE TABLE logs;')
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('TRUNCATE')
      expect(result[0].severity).toBe('critical')
    })

    it('应检测到省略 TABLE 关键字的 TRUNCATE 语句', () => {
      const result = detectDangerousStatements('TRUNCATE logs;')
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('TRUNCATE')
    })
  })

  describe('DELETE_NO_WHERE — critical', () => {
    it('无 WHERE 子句的 DELETE 应被检测为危险', () => {
      const result = detectDangerousStatements('DELETE FROM orders;')
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('DELETE_NO_WHERE')
      expect(result[0].severity).toBe('critical')
    })

    it('DELETE 带分号结尾且无 WHERE 应被检测', () => {
      const result = detectDangerousStatements('DELETE FROM temp_table;')
      const types = result.map((r) => r.type)
      expect(types).toContain('DELETE_NO_WHERE')
    })

    it('有 WHERE 子句的 DELETE 不应被检测为危险', () => {
      const result = detectDangerousStatements('DELETE FROM orders WHERE id = 1;')
      const types = result.map((r) => r.type)
      expect(types).not.toContain('DELETE_NO_WHERE')
    })

    it('有 WHERE 子句（多条件）的 DELETE 不应误报', () => {
      const result = detectDangerousStatements(
        'DELETE FROM orders WHERE status = "done" AND created_at < "2024-01-01";',
      )
      const types = result.map((r) => r.type)
      expect(types).not.toContain('DELETE_NO_WHERE')
    })
  })

  describe('UPDATE_NO_WHERE — warning', () => {
    it('无 WHERE 子句的 UPDATE 应被检测为危险', () => {
      const result = detectDangerousStatements('UPDATE users SET active = 0;')
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('UPDATE_NO_WHERE')
      expect(result[0].severity).toBe('warning')
    })

    it('有 WHERE 子句的 UPDATE 不应被检测为危险', () => {
      const result = detectDangerousStatements('UPDATE users SET active = 0 WHERE id = 1;')
      const types = result.map((r) => r.type)
      expect(types).not.toContain('UPDATE_NO_WHERE')
    })

    it('有 WHERE 子句（复杂条件）的 UPDATE 不应误报', () => {
      const result = detectDangerousStatements(
        'UPDATE products SET price = price * 1.1 WHERE category = "electronics" AND stock > 0;',
      )
      const types = result.map((r) => r.type)
      expect(types).not.toContain('UPDATE_NO_WHERE')
    })
  })

  describe('ALTER_DROP_COLUMN — warning', () => {
    it('应检测到 ALTER TABLE ... DROP COLUMN', () => {
      const result = detectDangerousStatements('ALTER TABLE users DROP COLUMN email;')
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('ALTER_DROP_COLUMN')
      expect(result[0].severity).toBe('warning')
    })

    it('应检测到省略 COLUMN 关键字的 ALTER TABLE ... DROP', () => {
      const result = detectDangerousStatements('ALTER TABLE users DROP email;')
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('ALTER_DROP_COLUMN')
    })
  })

  describe('DROP_INDEX — warning', () => {
    it('应检测到 DROP INDEX 语句', () => {
      const result = detectDangerousStatements('DROP INDEX idx_user_email ON users;')
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('DROP_INDEX')
      expect(result[0].severity).toBe('warning')
    })
  })

  // ── 大小写不敏感 ──────────────────────────────────────────
  describe('大小写不敏感', () => {
    it('全小写 drop table 应被检测到', () => {
      const result = detectDangerousStatements('drop table users;')
      const types = result.map((r) => r.type)
      expect(types).toContain('DROP_TABLE')
    })

    it('混合大小写 Drop Table 应被检测到', () => {
      const result = detectDangerousStatements('Drop Table Users;')
      const types = result.map((r) => r.type)
      expect(types).toContain('DROP_TABLE')
    })

    it('全小写 truncate table 应被检测到', () => {
      const result = detectDangerousStatements('truncate table logs;')
      const types = result.map((r) => r.type)
      expect(types).toContain('TRUNCATE')
    })

    it('全小写 delete from（无 where）应被检测到', () => {
      const result = detectDangerousStatements('delete from orders;')
      const types = result.map((r) => r.type)
      expect(types).toContain('DELETE_NO_WHERE')
    })

    it('全小写 update ... set（无 where）应被检测到', () => {
      const result = detectDangerousStatements('update users set active = 0;')
      const types = result.map((r) => r.type)
      expect(types).toContain('UPDATE_NO_WHERE')
    })
  })

  // ── 注释中的关键字不应被检测 ─────────────────────────────
  describe('块注释中的关键字不应误报', () => {
    it('/* DROP TABLE users */ 不应被检测到', () => {
      const result = detectDangerousStatements('/* DROP TABLE users */ SELECT 1;')
      const types = result.map((r) => r.type)
      expect(types).not.toContain('DROP_TABLE')
    })

    it('/* TRUNCATE TABLE logs */ 不应被检测到', () => {
      const result = detectDangerousStatements('/* TRUNCATE TABLE logs */ SELECT * FROM logs;')
      const types = result.map((r) => r.type)
      expect(types).not.toContain('TRUNCATE')
    })

    it('/* DELETE FROM orders */ 不应被检测到', () => {
      const result = detectDangerousStatements('/* DELETE FROM orders */ SELECT 1;')
      const types = result.map((r) => r.type)
      expect(types).not.toContain('DELETE_NO_WHERE')
    })
  })

  describe('行注释（-- 风格）中的关键字不应误报', () => {
    it('-- DROP TABLE users 注释不应被检测', () => {
      const result = detectDangerousStatements('-- DROP TABLE users\nSELECT 1;')
      const types = result.map((r) => r.type)
      expect(types).not.toContain('DROP_TABLE')
    })

    it('-- UPDATE users SET ... 注释不应被检测', () => {
      const result = detectDangerousStatements('-- UPDATE users SET active=0\nSELECT 1;')
      const types = result.map((r) => r.type)
      expect(types).not.toContain('UPDATE_NO_WHERE')
    })
  })

  describe('MySQL 行注释（# 风格）中的关键字不应误报', () => {
    it('# DROP TABLE users 注释不应被检测', () => {
      const result = detectDangerousStatements('# DROP TABLE users\nSELECT 1;')
      const types = result.map((r) => r.type)
      expect(types).not.toContain('DROP_TABLE')
    })
  })

  // ── 字符串字面量中的关键字不应误报 ──────────────────────────
  describe('单引号字符串中的关键字不应误报', () => {
    it("SELECT * FROM t WHERE name = 'DROP TABLE' 不应误报", () => {
      const result = detectDangerousStatements(
        "SELECT * FROM t WHERE name = 'DROP TABLE';",
      )
      const types = result.map((r) => r.type)
      expect(types).not.toContain('DROP_TABLE')
    })

    it("单引号包含 TRUNCATE 不应误报", () => {
      const result = detectDangerousStatements(
        "SELECT * FROM logs WHERE msg = 'TRUNCATE TABLE logs';",
      )
      const types = result.map((r) => r.type)
      expect(types).not.toContain('TRUNCATE')
    })

    it("单引号包含 DELETE FROM 不应误报", () => {
      const result = detectDangerousStatements(
        "INSERT INTO audit (sql_text) VALUES ('DELETE FROM users');",
      )
      const types = result.map((r) => r.type)
      expect(types).not.toContain('DELETE_NO_WHERE')
    })
  })

  describe('双引号字符串中的关键字不应误报', () => {
    it('双引号包含 DROP TABLE 不应误报', () => {
      const result = detectDangerousStatements(
        'SELECT * FROM t WHERE cmd = "DROP TABLE users";',
      )
      const types = result.map((r) => r.type)
      expect(types).not.toContain('DROP_TABLE')
    })
  })

  // ── 反引号标识符中的关键字不应误报 ──────────────────────────
  describe('反引号标识符中的关键字不应误报', () => {
    it('反引号列名 `DROP` 不应误报 DROP_TABLE', () => {
      // 列名恰好叫 DROP，不应触发 DROP_TABLE 规则
      const result = detectDangerousStatements('SELECT `DROP` FROM t;')
      const types = result.map((r) => r.type)
      expect(types).not.toContain('DROP_TABLE')
    })

    it('反引号表名中包含 TRUNCATE 不应误报', () => {
      const result = detectDangerousStatements('SELECT * FROM `TRUNCATE_log`;')
      const types = result.map((r) => r.type)
      expect(types).not.toContain('TRUNCATE')
    })
  })

  // ── 多语句：同一 SQL 中多种危险操作 ─────────────────────────
  describe('多语句检测', () => {
    it('同时包含 DROP TABLE 和 TRUNCATE 应各报告一条', () => {
      const sql = 'DROP TABLE old_data;\nTRUNCATE TABLE temp;'
      const result = detectDangerousStatements(sql)
      const types = result.map((r) => r.type)
      expect(types).toContain('DROP_TABLE')
      expect(types).toContain('TRUNCATE')
    })

    it('同时包含 DROP TABLE 和 DELETE（无 WHERE）应各报告一条', () => {
      const sql = 'DROP TABLE backup;\nDELETE FROM sessions;'
      const result = detectDangerousStatements(sql)
      const types = result.map((r) => r.type)
      expect(types).toContain('DROP_TABLE')
      expect(types).toContain('DELETE_NO_WHERE')
    })

    it('包含所有类型危险语句时都应检测到', () => {
      const sql = [
        'DROP TABLE t1;',
        'DROP DATABASE db1;',
        'TRUNCATE TABLE t2;',
        'DELETE FROM t3;',
        'UPDATE t4 SET col = 1;',
        'ALTER TABLE t5 DROP COLUMN c;',
        'DROP INDEX idx ON t6;',
      ].join('\n')
      const result = detectDangerousStatements(sql)
      const types = result.map((r) => r.type)
      expect(types).toContain('DROP_TABLE')
      expect(types).toContain('DROP_DATABASE')
      expect(types).toContain('TRUNCATE')
      expect(types).toContain('DELETE_NO_WHERE')
      expect(types).toContain('UPDATE_NO_WHERE')
      expect(types).toContain('ALTER_DROP_COLUMN')
      expect(types).toContain('DROP_INDEX')
    })

    it('危险语句与安全语句混合时只报告危险部分', () => {
      const sql = 'SELECT * FROM users;\nDROP TABLE old_users;'
      const result = detectDangerousStatements(sql)
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('DROP_TABLE')
    })
  })

  // ── 安全语句不应误报 ──────────────────────────────────────
  describe('安全语句不应产生误报', () => {
    it('普通 SELECT 语句不应有结果', () => {
      expect(detectDangerousStatements('SELECT * FROM users WHERE id = 1;')).toEqual([])
    })

    it('INSERT 语句不应有结果', () => {
      expect(
        detectDangerousStatements("INSERT INTO logs (msg) VALUES ('hello');"),
      ).toEqual([])
    })

    it('CREATE TABLE 不应有结果', () => {
      expect(detectDangerousStatements('CREATE TABLE new_table (id INT);')).toEqual([])
    })
  })
})

describe('dangerousSqlDetector extended rules', () => {
  it('detects privilege and rename operations', () => {
    const types = detectDangerousStatements(`
      GRANT SELECT ON app.* TO 'u'@'%';
      REVOKE SELECT ON app.* FROM 'u'@'%';
      RENAME TABLE old_name TO new_name;
    `).map((item) => item.type)

    expect(types).toContain('GRANT')
    expect(types).toContain('REVOKE')
    expect(types).toContain('RENAME_TABLE')
  })

  it('detects create table as select', () => {
    const result = detectDangerousStatements('CREATE TABLE backup_users AS SELECT * FROM users;')
    expect(result.map((item) => item.type)).toContain('CREATE_TABLE_AS')
  })

  it('classifies mutation statements', () => {
    expect(isMutationStatement('SELECT * FROM users;')).toBe(false)
    expect(isMutationStatement('INSERT INTO users(id) VALUES (1);')).toBe(true)
    expect(isMutationStatement('UPDATE users SET name = "a" WHERE id = 1;')).toBe(true)
    expect(isMutationStatement('DROP TABLE users;')).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// isReadOnlyStatement 测试套件
// ────────────────────────────────────────────────────────────
describe('isReadOnlyStatement', () => {
  // ── 只读语句应返回 true ───────────────────────────────────
  describe('单条只读语句', () => {
    it('SELECT 语句应返回 true', () => {
      expect(isReadOnlyStatement('SELECT * FROM users;')).toBe(true)
    })

    it('SHOW 语句应返回 true', () => {
      expect(isReadOnlyStatement('SHOW TABLES;')).toBe(true)
    })

    it('DESCRIBE 语句应返回 true', () => {
      expect(isReadOnlyStatement('DESCRIBE users;')).toBe(true)
    })

    it('DESC 缩写应返回 true', () => {
      expect(isReadOnlyStatement('DESC users;')).toBe(true)
    })

    it('EXPLAIN 语句应返回 true', () => {
      expect(isReadOnlyStatement('EXPLAIN SELECT * FROM users;')).toBe(true)
    })

    it('USE 语句应返回 true', () => {
      expect(isReadOnlyStatement('USE mydb;')).toBe(true)
    })

    it('SET 语句应返回 true', () => {
      expect(isReadOnlyStatement('SET NAMES utf8mb4;')).toBe(true)
    })
  })

  // ── 写操作语句应返回 false ────────────────────────────────
  describe('单条写操作语句应返回 false', () => {
    it('DROP TABLE 应返回 false', () => {
      expect(isReadOnlyStatement('DROP TABLE users;')).toBe(false)
    })

    it('INSERT 应返回 false', () => {
      expect(isReadOnlyStatement('INSERT INTO logs VALUES (1);')).toBe(false)
    })

    it('UPDATE（有 WHERE）应返回 false', () => {
      expect(isReadOnlyStatement('UPDATE users SET active=1 WHERE id=1;')).toBe(false)
    })

    it('DELETE（有 WHERE）应返回 false', () => {
      expect(isReadOnlyStatement('DELETE FROM logs WHERE id=1;')).toBe(false)
    })

    it('CREATE TABLE 应返回 false', () => {
      expect(isReadOnlyStatement('CREATE TABLE t (id INT);')).toBe(false)
    })

    it('TRUNCATE 应返回 false', () => {
      expect(isReadOnlyStatement('TRUNCATE TABLE logs;')).toBe(false)
    })
  })

  // ── 大小写不敏感 ──────────────────────────────────────────
  describe('大小写不敏感', () => {
    it('全小写 select 应返回 true', () => {
      expect(isReadOnlyStatement('select * from users;')).toBe(true)
    })

    it('混合大小写 Select 应返回 true', () => {
      expect(isReadOnlyStatement('Select * From users;')).toBe(true)
    })

    it('全小写 show tables 应返回 true', () => {
      expect(isReadOnlyStatement('show tables;')).toBe(true)
    })
  })

  // ── 多语句场景 ────────────────────────────────────────────
  describe('多语句', () => {
    it('多条都是只读语句应返回 true', () => {
      expect(isReadOnlyStatement('SELECT 1; SHOW TABLES; DESCRIBE users;')).toBe(true)
    })

    it('SELECT 1; DROP TABLE t — 含写操作应返回 false', () => {
      expect(isReadOnlyStatement('SELECT 1; DROP TABLE t;')).toBe(false)
    })

    it('SELECT + INSERT 应返回 false', () => {
      expect(isReadOnlyStatement('SELECT * FROM users; INSERT INTO logs VALUES (1);')).toBe(false)
    })

    it('USE + SET + SELECT 全部只读应返回 true', () => {
      expect(isReadOnlyStatement('USE mydb; SET NAMES utf8mb4; SELECT 1;')).toBe(true)
    })
  })

  // ── 带注释的只读语句 ──────────────────────────────────────
  describe('带注释的只读语句', () => {
    it('-- comment\\nSELECT 1 应返回 true', () => {
      expect(isReadOnlyStatement('-- 查询所有用户\nSELECT * FROM users;')).toBe(true)
    })

    it('/* comment */ SELECT 1 应返回 true', () => {
      expect(isReadOnlyStatement('/* 查询 */ SELECT 1;')).toBe(true)
    })

    it('# MySQL 注释后跟 SELECT 应返回 true', () => {
      expect(isReadOnlyStatement('# 注释\nSELECT 1;')).toBe(true)
    })

    it('注释掉危险语句后剩余 SELECT 应返回 true', () => {
      // DROP TABLE 在注释里，实际执行只有 SELECT
      expect(isReadOnlyStatement('-- DROP TABLE users\nSELECT 1;')).toBe(true)
    })
  })

  // ── 空输入边界 ────────────────────────────────────────────
  describe('空输入边界', () => {
    it('空字符串应返回 true（没有非只读语句）', () => {
      // statements.every() 对空数组返回 true（vacuous truth）
      expect(isReadOnlyStatement('')).toBe(true)
    })

    it('仅有分号应返回 true', () => {
      expect(isReadOnlyStatement(';')).toBe(true)
    })
  })
})
