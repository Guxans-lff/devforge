import { invokeCommand } from '@/api/base'
import type { BackendError, ErrorKind } from '@/types/error'

export class AiBridgeError extends Error {
  readonly kind: ErrorKind
  readonly retryable: boolean
  readonly command: string
  readonly cause: unknown

  constructor(command: string, error: BackendError, cause?: unknown) {
    super(error.message)
    this.name = 'AiBridgeError'
    this.kind = error.kind
    this.retryable = error.retryable
    this.command = command
    this.cause = cause
  }
}

function isBackendError(error: unknown): error is BackendError {
  if (!error || typeof error !== 'object') return false
  const value = error as Record<string, unknown>
  return typeof value.kind === 'string'
    && typeof value.message === 'string'
    && typeof value.retryable === 'boolean'
}

export function normalizeAiBridgeError(command: string, error: unknown): AiBridgeError {
  if (error instanceof AiBridgeError) return error
  if (isBackendError(error)) return new AiBridgeError(command, error, error)
  if (error instanceof Error) {
    return new AiBridgeError(command, {
      kind: 'INTERNAL',
      message: error.message,
      retryable: false,
    }, error)
  }
  return new AiBridgeError(command, {
    kind: 'INTERNAL',
    message: String(error),
    retryable: false,
  }, error)
}

export async function invokeAiCommand<T>(
  command: string,
  args?: Record<string, unknown>,
  options?: { source?: 'AI'; silent?: boolean },
): Promise<T> {
  try {
    return await invokeCommand<T>(command, args, { source: 'AI', silent: options?.silent })
  } catch (error) {
    throw normalizeAiBridgeError(command, error)
  }
}
