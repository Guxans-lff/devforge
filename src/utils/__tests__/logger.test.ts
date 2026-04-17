import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogger } from '../logger'

describe('logger', () => {
  let info: ReturnType<typeof vi.spyOn>
  let warn: ReturnType<typeof vi.spyOn>
  let error: ReturnType<typeof vi.spyOn>
  let debug: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    info = vi.spyOn(console, 'info').mockImplementation(() => {})
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
    debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    ;(globalThis as { __LOG_LEVEL?: string }).__LOG_LEVEL = 'debug'
  })

  afterEach(() => {
    delete (globalThis as { __LOG_LEVEL?: string }).__LOG_LEVEL
    vi.restoreAllMocks()
  })

  it('writes tag/event prefix', () => {
    const log = createLogger('ai.stream')
    log.info('stream_start', { sessionId: 's1' })
    expect(info).toHaveBeenCalledWith('[ai.stream] stream_start', { sessionId: 's1' })
  })

  it('omits payload when no fields given', () => {
    const log = createLogger('x')
    log.debug('noop')
    expect(debug).toHaveBeenCalledWith('[x] noop')
  })

  it('passes error object at tail', () => {
    const log = createLogger('x')
    const e = new Error('boom')
    log.error('fail', { id: 1 }, e)
    expect(error).toHaveBeenCalledWith('[x] fail', { id: 1 }, e)
  })

  it('respects __LOG_LEVEL override', () => {
    ;(globalThis as { __LOG_LEVEL?: string }).__LOG_LEVEL = 'error'
    const log = createLogger('x')
    log.info('skipped')
    log.warn('skipped')
    log.error('shown')
    expect(info).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('warn without error arg still logs two args', () => {
    const log = createLogger('x')
    log.warn('evt', { a: 1 })
    expect(warn).toHaveBeenCalledWith('[x] evt', { a: 1 })
  })
})
