import { describe, expect, it } from 'vitest'
import { redactDiagnosticPayload } from '../diagnosticRedaction'

describe('diagnosticRedaction', () => {
  it('redacts sensitive keys recursively', () => {
    const redacted = redactDiagnosticPayload({
      apiKey: 'sk-live-secret',
      nested: {
        refreshToken: 'refresh-token',
        safe: 'visible',
      },
      list: [
        { password: 'p@ssw0rd' },
        { model: 'deepseek-v4-flash' },
      ],
    })

    expect(redacted).toEqual({
      apiKey: '[REDACTED]',
      nested: {
        refreshToken: '[REDACTED]',
        safe: 'visible',
      },
      list: [
        { password: '[REDACTED]' },
        { model: 'deepseek-v4-flash' },
      ],
    })
  })

  it('redacts common secret patterns inside strings', () => {
    const redacted = redactDiagnosticPayload({
      message: 'Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz and api_key=sk-abcdefghijklmnopqrstuvwxyz',
      url: 'postgres://user:password@example.com/db',
      text: 'normal content stays readable',
    })

    expect(redacted.message).toContain('Authorization=[REDACTED]')
    expect(redacted.message).toContain('api_key=[REDACTED]')
    expect(redacted.message).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
    expect(redacted.url).toBe('postgres://***:***@example.com/db')
    expect(redacted.text).toBe('normal content stays readable')
  })
})
