/**
 * AI Gateway Rate Limiter — 滑动窗口限流器
 *
 * 内存级限流，按 provider 维度限制请求频率。
 * 支持自定义窗口大小和请求上限。
 */

// ─────────────────────────── 类型定义 ───────────────────────────

export interface RateLimitConfig {
  /** 窗口大小（毫秒） */
  windowMs: number
  /** 窗口内最大请求数 */
  maxRequests: number
}

export interface RateLimitState {
  /** 当前窗口内请求时间戳列表 */
  timestamps: number[]
  /** 被限流次数（诊断用） */
  throttledCount: number
}

export interface RateLimitCheckResult {
  /** 是否允许通过 */
  allowed: boolean
  /** 当前窗口内请求数 */
  currentCount: number
  /** 距离窗口重置还有多少毫秒 */
  resetAfterMs: number
  /** 剩余可用配额 */
  remaining: number
}

// ─────────────────────────── 默认配置 ───────────────────────────

/** 默认限流：60 秒内最多 30 次请求 */
export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 30,
}

/** 保守限流：60 秒内最多 10 次请求 */
export const CONSERVATIVE_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 10,
}

/** 宽松限流：60 秒内最多 100 次请求 */
export const PERMISSIVE_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 100,
}

// ─────────────────────────── 状态存储 ───────────────────────────

const limiterStore = new Map<string, RateLimitState>()

function getState(providerId: string): RateLimitState {
  let state = limiterStore.get(providerId)
  if (!state) {
    state = { timestamps: [], throttledCount: 0 }
    limiterStore.set(providerId, state)
  }
  return state
}

/** 清理过期的请求记录 */
function cleanExpiredTimestamps(state: RateLimitState, windowMs: number, now: number): void {
  const cutoff = now - windowMs
  const idx = state.timestamps.findIndex(ts => ts > cutoff)
  if (idx > 0) {
    state.timestamps = state.timestamps.slice(idx)
  } else if (idx === -1) {
    state.timestamps = []
  }
}

// ─────────────────────────── 核心 API ───────────────────────────

/**
 * 检查 provider 是否允许发送请求（不记录）
 *
 * @param providerId Provider ID
 * @param config 限流配置
 * @param now 当前时间戳（测试用）
 * @returns 检查结果
 */
export function checkRateLimit(
  providerId: string,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT,
  now = Date.now(),
): RateLimitCheckResult {
  const state = getState(providerId)
  cleanExpiredTimestamps(state, config.windowMs, now)

  const currentCount = state.timestamps.length
  const allowed = currentCount < config.maxRequests
  const oldestTimestamp = state.timestamps[0]
  const resetAfterMs = oldestTimestamp !== undefined
    ? config.windowMs - (now - oldestTimestamp)
    : config.windowMs

  return {
    allowed,
    currentCount,
    resetAfterMs: Math.max(0, resetAfterMs),
    remaining: Math.max(0, config.maxRequests - currentCount),
  }
}

/**
 * 记录一次请求（在请求实际发送后调用）
 *
 * @param providerId Provider ID
 * @param config 限流配置
 * @param now 当前时间戳（测试用）
 */
export function recordRequest(
  providerId: string,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT,
  now = Date.now(),
): void {
  const state = getState(providerId)
  cleanExpiredTimestamps(state, config.windowMs, now)
  state.timestamps.push(now)
}

/**
 * 尝试消耗一个配额（原子性的 check + record）
 *
 * @returns 是否成功消耗配额
 */
export function consumeQuota(
  providerId: string,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT,
  now = Date.now(),
): RateLimitCheckResult {
  const state = getState(providerId)
  cleanExpiredTimestamps(state, config.windowMs, now)

  const currentCount = state.timestamps.length
  const allowed = currentCount < config.maxRequests

  if (allowed) {
    state.timestamps.push(now)
  } else {
    state.throttledCount += 1
  }

  const oldestTimestamp = state.timestamps[0]
  return {
    allowed,
    currentCount: allowed ? currentCount + 1 : currentCount,
    resetAfterMs: oldestTimestamp !== undefined
      ? config.windowMs - (now - oldestTimestamp)
      : config.windowMs,
    remaining: Math.max(0, config.maxRequests - (allowed ? currentCount + 1 : currentCount)),
  }
}

// ─────────────────────────── 诊断 API ───────────────────────────

/** 获取 provider 的限流统计 */
export function getRateLimitStats(providerId: string, config: RateLimitConfig = DEFAULT_RATE_LIMIT, now = Date.now()) {
  const state = getState(providerId)
  cleanExpiredTimestamps(state, config.windowMs, now)
  return {
    providerId,
    currentCount: state.timestamps.length,
    maxRequests: config.maxRequests,
    throttledCount: state.throttledCount,
    windowMs: config.windowMs,
  }
}

/** 重置所有限流状态（测试用） */
export function resetRateLimiters(): void {
  limiterStore.clear()
}

/** 获取所有 provider 的限流统计 */
export function getAllRateLimitStats(): Array<ReturnType<typeof getRateLimitStats>> {
  return Array.from(limiterStore.keys()).map(id => getRateLimitStats(id))
}
