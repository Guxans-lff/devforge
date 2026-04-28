import { describe, expect, it } from 'vitest'
import { checkWritePathSafety } from './pathSafety'

describe('pathSafety', () => {
  it('allows relative paths inside workspace', () => {
    const result = checkWritePathSafety('src/main.ts', 'D:/Project/App')

    expect(result.safe).toBe(true)
    expect(result.normalizedPath).toBe('D:/Project/App/src/main.ts')
  })

  it('blocks path traversal outside workspace', () => {
    const result = checkWritePathSafety('../secrets.txt', 'D:/Project/App')

    expect(result.safe).toBe(false)
    expect(result.reason).toContain('工作区外路径')
  })

  it('blocks absolute paths outside workspace', () => {
    const result = checkWritePathSafety('D:/Project/Other/file.ts', 'D:/Project/App')

    expect(result.safe).toBe(false)
    expect(result.reason).toContain('工作区外路径')
  })

  it('blocks dangerous directories inside workspace', () => {
    const result = checkWritePathSafety('.git/config', 'D:/Project/App')

    expect(result.safe).toBe(false)
    expect(result.reason).toContain('.git')
  })

  it('blocks dangerous config files inside workspace', () => {
    const result = checkWritePathSafety('.mcp.json', 'D:/Project/App')

    expect(result.safe).toBe(false)
    expect(result.reason).toContain('.mcp.json')
  })
})
