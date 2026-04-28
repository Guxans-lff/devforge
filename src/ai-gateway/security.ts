export interface SecurityConfig {
  allowlist?: string[]
  allowLocalhost?: boolean
  allowPrivateIP?: boolean
}

export interface SecurityCheckResult {
  allowed: boolean
  reason?: string
  checkType: 'protocol' | 'private_ip' | 'localhost' | 'allowlist' | 'empty'
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => Number.isNaN(part) || part < 0 || part > 255)) return false
  const [a = 0, b = 0] = parts
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 0) return true
  if (a === 192 && b === 0 && parts[2] === 0) return true
  if (a === 198 && b >= 18 && b <= 19) return true
  return false
}

function isLocalhost(host: string): boolean {
  const lowered = host.toLowerCase()
  return lowered === 'localhost' || lowered === '127.0.0.1' || lowered === '::1' || lowered === '0:0:0:0:0:0:0:1'
}

function matchesAllowlist(host: string, allowlist: string[]): boolean {
  return allowlist.some(pattern => {
    if (pattern === host) return true
    if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1))
    if (pattern.includes('/')) {
      const [ipPrefix = ''] = pattern.split('/')
      return ipPrefix.length > 0 && host.startsWith(ipPrefix)
    }
    return false
  })
}

export function checkEndpointSecurity(endpoint: string, config: SecurityConfig = {}): SecurityCheckResult {
  if (!endpoint || endpoint.trim().length === 0) {
    return { allowed: false, reason: 'Endpoint is empty', checkType: 'empty' }
  }

  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return { allowed: false, reason: `Invalid URL: ${endpoint}`, checkType: 'protocol' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { allowed: false, reason: `Unsupported protocol: ${url.protocol}`, checkType: 'protocol' }
  }

  const host = url.hostname
  if (config.allowlist && matchesAllowlist(host, config.allowlist)) {
    return { allowed: true, checkType: 'allowlist' }
  }
  if (isLocalhost(host) && !config.allowLocalhost) {
    return { allowed: false, reason: 'Localhost is not allowed', checkType: 'localhost' }
  }
  if (isPrivateIPv4(host) && !config.allowPrivateIP) {
    return { allowed: false, reason: 'Private IP is not allowed', checkType: 'private_ip' }
  }
  return { allowed: true, checkType: 'allowlist' }
}

export function checkEndpointsSecurity(endpoints: string[], config?: SecurityConfig): SecurityCheckResult {
  for (const endpoint of endpoints) {
    const result = checkEndpointSecurity(endpoint, config)
    if (!result.allowed) return result
  }
  return { allowed: true, checkType: 'allowlist' }
}

export const PRODUCTION_SECURITY_CONFIG: SecurityConfig = {
  allowLocalhost: false,
  allowPrivateIP: false,
}

export const DEVELOPMENT_SECURITY_CONFIG: SecurityConfig = {
  allowLocalhost: true,
  allowPrivateIP: false,
}

export function getDefaultSecurityConfig(): SecurityConfig {
  return import.meta.env.DEV ? DEVELOPMENT_SECURITY_CONFIG : PRODUCTION_SECURITY_CONFIG
}

