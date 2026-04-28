export interface StreamBackpressurePolicy {
  flushIntervalMs: number
  maxBufferedChars: number
}

export const DEFAULT_STREAM_BACKPRESSURE_POLICY: StreamBackpressurePolicy = {
  flushIntervalMs: 50,
  maxBufferedChars: 2400,
}

export function shouldFlushImmediately(params: {
  pendingTextDelta: string
  pendingThinkingDelta: string
  policy?: StreamBackpressurePolicy
}): boolean {
  const policy = params.policy ?? DEFAULT_STREAM_BACKPRESSURE_POLICY
  return params.pendingTextDelta.length + params.pendingThinkingDelta.length >= policy.maxBufferedChars
}
