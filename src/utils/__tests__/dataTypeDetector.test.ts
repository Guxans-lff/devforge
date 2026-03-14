/**
 * dataTypeDetector.ts 单元测试
 *
 * 按检测优先级逐层覆盖所有分支：
 * null/undefined → 二进制 → columnType 辅助 → JSON → XML → URL → datetime → 默认 text
 */

import {
  detectPreviewMode,
  isBinaryData,
  isDatetime,
  isValidJson,
  isValidUrl,
  isValidXml,
} from '@/utils/dataTypeDetector'

// ─────────────────────────────────────────────
// isBinaryData
// ─────────────────────────────────────────────
describe('isBinaryData', () => {
  test('Uint8Array 应返回 true', () => {
    expect(isBinaryData(new Uint8Array([0x00, 0xff, 0x1a]))).toBe(true)
  })

  test('ArrayBuffer 应返回 true', () => {
    expect(isBinaryData(new ArrayBuffer(8))).toBe(true)
  })

  test('普通可打印字符串应返回 false', () => {
    expect(isBinaryData('Hello, DevForge!')).toBe(false)
  })

  test('包含大量不可打印字符（>10%）的字符串应返回 true', () => {
    // 构造一个 20 字符字符串，其中 3 个是不可打印字符（charCode 1），比例 15% > 10%
    const binary = '\x01\x02\x03' + 'a'.repeat(17)
    expect(isBinaryData(binary)).toBe(true)
  })

  test('不可打印字符恰好等于 10% 时应返回 false（边界值：非严格大于）', () => {
    // 10 字符中 1 个不可打印，比例正好 10%，条件是 > 0.1，所以应返回 false
    const borderline = '\x01' + 'a'.repeat(9)
    expect(isBinaryData(borderline)).toBe(false)
  })

  test('制表符、换行符、回车符不算不可打印字符', () => {
    // tab=9, LF=10, CR=13 被排除，不应触发二进制检测
    const withWhitespace = '\t\n\r' + 'a'.repeat(27)
    expect(isBinaryData(withWhitespace)).toBe(false)
  })

  test('数字类型应返回 false', () => {
    expect(isBinaryData(42)).toBe(false)
  })

  test('null 应返回 false', () => {
    expect(isBinaryData(null)).toBe(false)
  })

  test('空字符串应返回 false', () => {
    expect(isBinaryData('')).toBe(false)
  })
})

// ─────────────────────────────────────────────
// isValidJson
// ─────────────────────────────────────────────
describe('isValidJson', () => {
  test('有效 JSON 对象应返回 true', () => {
    expect(isValidJson('{"name":"DevForge","version":"0.2.0"}')).toBe(true)
  })

  test('有效 JSON 数组应返回 true', () => {
    expect(isValidJson('[1, 2, 3]')).toBe(true)
  })

  test('嵌套 JSON 对象应返回 true', () => {
    expect(isValidJson('{"db":{"host":"localhost","port":3306}}')).toBe(true)
  })

  test('带前后空白的 JSON 应返回 true', () => {
    expect(isValidJson('  { "key": "value" }  ')).toBe(true)
  })

  test('空 JSON 对象应返回 true', () => {
    expect(isValidJson('{}')).toBe(true)
  })

  test('空 JSON 数组应返回 true', () => {
    expect(isValidJson('[]')).toBe(true)
  })

  test('普通字符串（不以 { 或 [ 开头）应返回 false', () => {
    expect(isValidJson('"hello"')).toBe(false)
  })

  test('数字字符串应返回 false', () => {
    expect(isValidJson('42')).toBe(false)
  })

  test('布尔字符串应返回 false', () => {
    expect(isValidJson('true')).toBe(false)
  })

  test('格式错误的 JSON（缺少引号）应返回 false', () => {
    expect(isValidJson('{name: "test"}')).toBe(false)
  })

  test('空字符串应返回 false', () => {
    expect(isValidJson('')).toBe(false)
  })

  test('只有空白的字符串应返回 false', () => {
    // 空白 trim 后首字符不是 { 或 [
    expect(isValidJson('   ')).toBe(false)
  })
})

// ─────────────────────────────────────────────
// isValidXml
// ─────────────────────────────────────────────
describe('isValidXml', () => {
  test('带 XML 声明的完整文档应返回 true', () => {
    const xml = '<?xml version="1.0"?><root><item>value</item></root>'
    expect(isValidXml(xml)).toBe(true)
  })

  test('不带声明的标准 XML 元素应返回 true', () => {
    const xml = '<users><user id="1"><name>Alice</name></user></users>'
    expect(isValidXml(xml)).toBe(true)
  })

  test('带属性的单根元素应返回 true', () => {
    const xml = '<config version="2.0"><setting key="debug">true</setting></config>'
    expect(isValidXml(xml)).toBe(true)
  })

  test('空字符串应返回 false', () => {
    expect(isValidXml('')).toBe(false)
  })

  test('不以 < 开头的字符串应返回 false', () => {
    expect(isValidXml('plain text')).toBe(false)
  })

  test('只有开标签没有闭合标签应返回 false', () => {
    // 无闭合标签，不满足 <\/[a-zA-Z]...> 结尾条件
    expect(isValidXml('<br>')).toBe(false)
  })

  test('自闭合根标签（无闭合子标签）应返回 false', () => {
    // <br/> 以 > 结尾但不含 </xxx>，末尾闭合标签正则不匹配
    expect(isValidXml('<br/>')).toBe(false)
  })

  test('非 XML 的 HTML 片段（无闭合标签）应返回 false', () => {
    expect(isValidXml('<div class="test">')).toBe(false)
  })

  test('JSON 字符串应返回 false', () => {
    expect(isValidXml('{"key":"value"}')).toBe(false)
  })
})

// ─────────────────────────────────────────────
// isValidUrl
// ─────────────────────────────────────────────
describe('isValidUrl', () => {
  test('http URL 应返回 true', () => {
    expect(isValidUrl('http://example.com')).toBe(true)
  })

  test('https URL 应返回 true', () => {
    expect(isValidUrl('https://github.com/devforge/repo')).toBe(true)
  })

  test('带查询参数的 URL 应返回 true', () => {
    expect(isValidUrl('https://api.example.com/v1/users?page=1&limit=20')).toBe(true)
  })

  test('带 # 锚点的 URL 应返回 true', () => {
    expect(isValidUrl('https://docs.example.com/guide#installation')).toBe(true)
  })

  test('ftp 协议应返回 false（不满足 https? 模式）', () => {
    expect(isValidUrl('ftp://files.example.com')).toBe(false)
  })

  test('无协议的域名应返回 false', () => {
    expect(isValidUrl('www.example.com')).toBe(false)
  })

  test('包含空格的字符串应返回 false', () => {
    expect(isValidUrl('https://example.com/path with spaces')).toBe(false)
  })

  test('空字符串应返回 false', () => {
    expect(isValidUrl('')).toBe(false)
  })

  test('普通文本应返回 false', () => {
    expect(isValidUrl('just some text')).toBe(false)
  })

  test('带前后空白的 URL 应返回 true（trim 后匹配）', () => {
    expect(isValidUrl('  https://example.com  ')).toBe(true)
  })
})

// ─────────────────────────────────────────────
// isDatetime
// ─────────────────────────────────────────────
describe('isDatetime', () => {
  test('ISO 8601 格式（T 分隔）应返回 true', () => {
    expect(isDatetime('2024-01-15T09:30:00')).toBe(true)
  })

  test('ISO 8601 格式（空格分隔）应返回 true', () => {
    expect(isDatetime('2024-01-15 09:30:00')).toBe(true)
  })

  test('带毫秒的 ISO 8601 应返回 true', () => {
    expect(isDatetime('2024-03-14T12:00:00.000Z')).toBe(true)
  })

  test('纯日期格式 YYYY-MM-DD 应返回 true', () => {
    expect(isDatetime('2024-01-15')).toBe(true)
  })

  test('columnType 含 date 时任意字符串应返回 true', () => {
    expect(isDatetime('not-a-date', 'DATE')).toBe(true)
  })

  test('columnType 含 time 时应返回 true', () => {
    expect(isDatetime('random text', 'time')).toBe(true)
  })

  test('columnType 含 timestamp 时应返回 true', () => {
    expect(isDatetime('1710374400', 'TIMESTAMP')).toBe(true)
  })

  test('随机文本不含日期格式应返回 false', () => {
    expect(isDatetime('hello world')).toBe(false)
  })

  test('数字字符串应返回 false', () => {
    expect(isDatetime('20240115')).toBe(false)
  })

  test('空字符串应返回 false', () => {
    expect(isDatetime('')).toBe(false)
  })

  test('格式不完整的日期应返回 false', () => {
    // 只有年月，没有日
    expect(isDatetime('2024-01')).toBe(false)
  })
})

// ─────────────────────────────────────────────
// detectPreviewMode — 优先级链路测试
// ─────────────────────────────────────────────
describe('detectPreviewMode', () => {
  // ── 优先级 1：null / undefined → text ──────
  describe('null / undefined 输入', () => {
    test('null 应返回 text', () => {
      expect(detectPreviewMode(null)).toBe('text')
    })

    test('undefined 应返回 text', () => {
      expect(detectPreviewMode(undefined)).toBe('text')
    })
  })

  // ── 优先级 2：二进制数据 → hex ─────────────
  describe('二进制数据检测', () => {
    test('Uint8Array 应返回 hex', () => {
      expect(detectPreviewMode(new Uint8Array([0x00, 0x01]))).toBe('hex')
    })

    test('ArrayBuffer 应返回 hex', () => {
      expect(detectPreviewMode(new ArrayBuffer(4))).toBe('hex')
    })

    test('含大量不可打印字符的字符串应返回 hex', () => {
      const binary = '\x01\x02\x03' + 'a'.repeat(17)
      expect(detectPreviewMode(binary)).toBe('hex')
    })
  })

  // ── 优先级 3：columnType 辅助 ─────────────
  describe('columnType 列类型辅助', () => {
    test('columnType="JSON" 应返回 json', () => {
      expect(detectPreviewMode('{"a":1}', 'JSON')).toBe('json')
    })

    test('columnType="json" 小写应返回 json', () => {
      expect(detectPreviewMode('some text', 'json')).toBe('json')
    })

    test('columnType="XML" 应返回 xml', () => {
      expect(detectPreviewMode('<root/>', 'XML')).toBe('xml')
    })

    test('columnType="BLOB" 应返回 hex', () => {
      expect(detectPreviewMode('some data', 'BLOB')).toBe('hex')
    })

    test('columnType="binary" 应返回 hex', () => {
      expect(detectPreviewMode('data', 'binary')).toBe('hex')
    })

    test('columnType="varbinary" 应返回 hex', () => {
      expect(detectPreviewMode('data', 'varbinary')).toBe('hex')
    })

    test('columnType="DATE" 应返回 datetime', () => {
      expect(detectPreviewMode('2024-01-15', 'DATE')).toBe('datetime')
    })

    test('columnType="TIMESTAMP" 应返回 datetime', () => {
      expect(detectPreviewMode('1710374400', 'TIMESTAMP')).toBe('datetime')
    })

    test('columnType="DATETIME" 应返回 datetime', () => {
      expect(detectPreviewMode('some text', 'DATETIME')).toBe('datetime')
    })
  })

  // ── 优先级 4：内容检测 → json ──────────────
  describe('内容检测：JSON', () => {
    test('JSON 对象字符串应返回 json', () => {
      expect(detectPreviewMode('{"host":"localhost","port":3306}')).toBe('json')
    })

    test('JSON 数组字符串应返回 json', () => {
      expect(detectPreviewMode('[1,2,3]')).toBe('json')
    })

    test('对象值直接传入应序列化后检测为 json', () => {
      // 传入对象，内部会 JSON.stringify，然后 isValidJson 识别
      expect(detectPreviewMode({ key: 'value' })).toBe('json')
    })
  })

  // ── 优先级 5：内容检测 → xml ───────────────
  describe('内容检测：XML', () => {
    test('标准 XML 字符串应返回 xml', () => {
      const xml = '<root><item>value</item></root>'
      expect(detectPreviewMode(xml)).toBe('xml')
    })

    test('带 XML 声明的文档应返回 xml', () => {
      const xml = '<?xml version="1.0"?><data><row>1</row></data>'
      expect(detectPreviewMode(xml)).toBe('xml')
    })
  })

  // ── 优先级 6：内容检测 → url ───────────────
  describe('内容检测：URL', () => {
    test('https URL 应返回 url', () => {
      expect(detectPreviewMode('https://github.com')).toBe('url')
    })

    test('http URL 应返回 url', () => {
      expect(detectPreviewMode('http://api.example.com/v1')).toBe('url')
    })
  })

  // ── 优先级 7：内容检测 → datetime ──────────
  describe('内容检测：datetime', () => {
    test('ISO 8601 日期时间字符串应返回 datetime', () => {
      expect(detectPreviewMode('2024-03-14T12:00:00Z')).toBe('datetime')
    })

    test('纯日期字符串应返回 datetime', () => {
      expect(detectPreviewMode('2024-01-15')).toBe('datetime')
    })
  })

  // ── 优先级 8：默认 → text ──────────────────
  describe('默认 text', () => {
    test('普通字符串应返回 text', () => {
      expect(detectPreviewMode('Hello, DevForge!')).toBe('text')
    })

    test('数字值应返回 text', () => {
      expect(detectPreviewMode(42)).toBe('text')
    })

    test('布尔值 true 应返回 text', () => {
      expect(detectPreviewMode(true)).toBe('text')
    })

    test('空字符串应返回 text', () => {
      expect(detectPreviewMode('')).toBe('text')
    })

    test('含 Unicode 和 emoji 的文本应返回 text', () => {
      expect(detectPreviewMode('你好，世界 🌍 DevForge')).toBe('text')
    })

    test('多行普通文本应返回 text', () => {
      expect(detectPreviewMode('line one\nline two\nline three')).toBe('text')
    })
  })

  // ── 边界与综合场景 ─────────────────────────
  describe('边界值与综合场景', () => {
    test('columnType 优先于内容检测：内容是 JSON 但 columnType=BLOB 应返回 hex', () => {
      // columnType 检测在内容检测之前，BLOB 应优先
      expect(detectPreviewMode('{"a":1}', 'BLOB')).toBe('hex')
    })

    test('columnType 优先于内容检测：内容是 URL 但 columnType=json 应返回 json', () => {
      expect(detectPreviewMode('https://example.com', 'json')).toBe('json')
    })

    test('二进制检测优先于 columnType：Uint8Array + columnType=json 应返回 hex', () => {
      // isBinaryData 检测在 columnType 之前
      expect(detectPreviewMode(new Uint8Array([0x01]), 'json')).toBe('hex')
    })

    test('不可打印字符比例刚好达到边界（=10%）不触发二进制，继续走内容检测', () => {
      // 10 字符中 1 个不可打印（= 10%，不满足 > 10%），不是二进制
      // 剩余 9 个 'a' 不是 JSON/XML/URL/datetime → text
      const borderline = '\x01' + 'a'.repeat(9)
      expect(detectPreviewMode(borderline)).toBe('text')
    })

    test('特殊字符（SQL 注入字符）普通字符串应返回 text', () => {
      expect(detectPreviewMode("'; DROP TABLE users; --")).toBe('text')
    })
  })
})
