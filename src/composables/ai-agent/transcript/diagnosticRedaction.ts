const REDACTED = '[REDACTED]'

const SENSITIVE_KEY_PATTERN = /^(?:apiKey|api[_-]?key|apikey|authorization|password|passphrase|secret|clientSecret|client[_-]?secret|token|accessToken|access[_-]?token|refreshToken|refresh[_-]?token|idToken|id[_-]?token|authToken|auth[_-]?token|credential|credentials|privateKey|private[_-]?key)$/i
const API_KEY_PATTERN = /\b(?:sk|pk|ak|rk|xai|AIza|ghp|github_pat)[-_A-Za-z0-9]{12,}\b/g
const BEARER_PATTERN = /\bBearer\s+[-._~+/=A-Za-z0-9]{12,}\b/gi
const BASIC_AUTH_URL_PATTERN = /:\/\/([^/\s:@]+):([^/\s@]+)@/g
const HEADER_SECRET_PATTERN = /\b(authorization|api[_-]?key|apikey|x-api-key|token|password|secret)\s*[:=]\s*([^\s,;"}]+)/gi

export function redactDiagnosticPayload<T>(value: T): T {
  return redactUnknown(value) as T
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map(item => redactUnknown(item))
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactUnknown(item)
    }
    return result
  }
  return value
}

function redactString(value: string): string {
  return value
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(BASIC_AUTH_URL_PATTERN, '://***:***@')
    .replace(HEADER_SECRET_PATTERN, (_match, key: string) => `${key}=${REDACTED}`)
    .replace(API_KEY_PATTERN, REDACTED)
}
