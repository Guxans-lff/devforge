import { describe, expect, it, vi } from 'vitest'
import { confirmTunnelRisk, summarizeTunnelRisk } from '../tunnelRisk'

describe('tunnelRisk', () => {
  it('blocks duplicated local ports', () => {
    const risk = summarizeTunnelRisk({
      sshHost: 'jump.example.com',
      localPort: 3306,
      remoteHost: '127.0.0.1',
      remotePort: 3306,
      existingLocalPorts: [3306],
    })

    expect(risk.blocked).toBe(true)
    expect(risk.message).toContain('已有活跃隧道')
  })

  it('allows random local port without confirmation', () => {
    expect(confirmTunnelRisk({
      sshHost: 'jump.example.com',
      localPort: 0,
      remoteHost: '127.0.0.1',
      remotePort: 3306,
    })).toBe(true)
  })

  it('alerts invalid ports instead of opening tunnel', () => {
    window.alert = vi.fn()
    const spy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    expect(confirmTunnelRisk({
      sshHost: 'jump.example.com',
      localPort: 70000,
      remoteHost: '127.0.0.1',
      remotePort: 3306,
    })).toBe(false)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
