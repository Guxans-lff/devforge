/**
 * 元数据缓存模块
 *
 * 基于 SWR（Stale-While-Revalidate）策略的内存缓存，
 * 用于侧栏树等高频元数据请求的加速。
 *
 * 策略：先返回缓存（立即渲染），后台静默刷新，刷新完毕后自动更新视图。
 */

interface CacheEntry<T> {
    /** 缓存数据 */
    data: T
    /** 缓存写入时间戳（ms） */
    timestamp: number
}

/** 缓存配置 */
interface CacheOptions {
    /** 缓存有效期（ms），默认 60 秒 */
    ttl?: number
}

const DEFAULT_TTL = 60_000 // 60 秒

/** 全局内存缓存 Map */
const cache = new Map<string, CacheEntry<unknown>>()

/**
 * 获取缓存数据（如果存在且未过期）
 * @param key 缓存键
 * @returns 缓存数据或 null
 */
export function getCached<T>(key: string): T | null {
    const entry = cache.get(key) as CacheEntry<T> | undefined
    if (!entry) return null
    // 超过 TTL 仍然返回（SWR 策略），调用方自行决定是否后台刷新
    return entry.data
}

/**
 * 检查缓存是否新鲜（未过期）
 * @param key 缓存键
 * @param ttl 有效期（ms）
 */
export function isFresh(key: string, ttl: number = DEFAULT_TTL): boolean {
    const entry = cache.get(key)
    if (!entry) return false
    return Date.now() - entry.timestamp < ttl
}

/**
 * 写入缓存
 * @param key 缓存键
 * @param data 数据
 */
export function setCache<T>(key: string, data: T): void {
    cache.set(key, { data, timestamp: Date.now() })
}

/**
 * 删除指定缓存
 * @param key 缓存键
 */
export function invalidate(key: string): void {
    cache.delete(key)
}

/**
 * 删除所有以 prefix 开头的缓存（用于连接断开时清理）
 * @param prefix 缓存键前缀，如 connectionId
 */
export function invalidateByPrefix(prefix: string): void {
    for (const key of cache.keys()) {
        if (key.startsWith(prefix)) {
            cache.delete(key)
        }
    }
}

/**
 * 清空所有缓存
 */
export function clearAllCache(): void {
    cache.clear()
}

/**
 * SWR 风格的数据获取：优先返回缓存，后台静默刷新
 *
 * @param key 缓存键
 * @param fetcher 数据获取函数
 * @param options 缓存配置
 * @returns { data, fromCache } data 为获取到的数据，fromCache 表示是否来自缓存
 */
export async function fetchWithCache<T>(
    key: string,
    fetcher: () => Promise<T>,
    options?: CacheOptions,
): Promise<{ data: T; fromCache: boolean }> {
    const ttl = options?.ttl ?? DEFAULT_TTL
    const cached = getCached<T>(key)

    if (cached !== null && isFresh(key, ttl)) {
        // 缓存新鲜，直接返回
        return { data: cached, fromCache: true }
    }

    if (cached !== null) {
        // 缓存过期但存在（SWR）：先返回旧数据，后台刷新
        // 后台刷新不阻塞当前返回
        fetcher().then((freshData) => {
            setCache(key, freshData)
        }).catch(() => {
            // 后台刷新失败，静默处理，保留旧缓存
        })
        return { data: cached, fromCache: true }
    }

    // 无缓存，必须等待获取
    const data = await fetcher()
    setCache(key, data)
    return { data, fromCache: false }
}
