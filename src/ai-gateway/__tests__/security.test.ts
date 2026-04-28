import { describe, it, expect } from 'vitest'
import {
  checkEndpointSecurity,
  checkEndpointsSecurity,
  PRODUCTION_SECURITY_CONFIG,
  DEVELOPMENT_SECURITY_CONFIG,
} from '@/ai-gateway/security'

describe('security', () => {
  describe('checkEndpointSecurity', () => {
    it('allows valid public HTTPS endpoints', () => {
      const result = checkEndpointSecurity('https://api.openai.com/v1')
      expect(result.allowed).toBe(true)
    })

    it('allows valid public HTTP endpoints', () => {
      const result = checkEndpointSecurity('http://api.example.com')
      expect(result.allowed).toBe(true)
    })

    it('blocks empty endpoint', () => {
      const result = checkEndpointSecurity('')
      expect(result.allowed).toBe(false)
      expect(result.checkType).toBe('empty')
    })

    it('blocks invalid URL', () => {
      const result = checkEndpointSecurity('not-a-url')
      expect(result.allowed).toBe(false)
      expect(result.checkType).toBe('protocol')
    })

    it('blocks non-HTTP protocols', () => {
      expect(checkEndpointSecurity('file:///etc/passwd').allowed).toBe(false)
      expect(checkEndpointSecurity('ftp://example.com').allowed).toBe(false)
      expect(checkEndpointSecurity('ws://example.com').allowed).toBe(false)
    })

    it('blocks localhost in production', () => {
      const result = checkEndpointSecurity('http://localhost:8080', PRODUCTION_SECURITY_CONFIG)
      expect(result.allowed).toBe(false)
      expect(result.checkType).toBe('localhost')
    })

    it('allows localhost in development', () => {
      const result = checkEndpointSecurity('http://localhost:8080', DEVELOPMENT_SECURITY_CONFIG)
      expect(result.allowed).toBe(true)
    })

    it('blocks 127.0.0.1 in production', () => {
      const result = checkEndpointSecurity('http://127.0.0.1:3000', PRODUCTION_SECURITY_CONFIG)
      expect(result.allowed).toBe(false)
    })

    it('blocks private IPv4 ranges', () => {
      const privateIPs = [
        'http://10.0.0.1',
        'http://172.16.0.1',
        'http://172.31.255.255',
        'http://192.168.1.1',
        'http://169.254.1.1',
        'http://0.0.0.0',
      ]
      for (const ip of privateIPs) {
        const result = checkEndpointSecurity(ip, PRODUCTION_SECURITY_CONFIG)
        expect(result.allowed).toBe(false)
        expect(result.checkType).toBe('private_ip')
      }
    })

    it('allows public IPs', () => {
      const result = checkEndpointSecurity('http://8.8.8.8')
      expect(result.allowed).toBe(true)
    })

    it('respects allowlist', () => {
      const result = checkEndpointSecurity('http://10.0.0.1', {
        allowlist: ['10.0.0.1'],
      })
      expect(result.allowed).toBe(true)
    })

    it('supports wildcard allowlist', () => {
      const result = checkEndpointSecurity('https://internal.company.com', {
        allowlist: ['*.company.com'],
      })
      expect(result.allowed).toBe(true)
    })
  })

  describe('checkEndpointsSecurity', () => {
    it('returns first failure for multiple endpoints', () => {
      const result = checkEndpointsSecurity([
        'https://api.openai.com',
        'http://192.168.1.1',
        'https://api.example.com',
      ])
      expect(result.allowed).toBe(false)
      expect(result.checkType).toBe('private_ip')
    })

    it('passes when all endpoints are safe', () => {
      const result = checkEndpointsSecurity([
        'https://api.openai.com',
        'https://api.example.com',
      ])
      expect(result.allowed).toBe(true)
    })
  })
})
