/**
 * 补全项使用频率管理
 * 基于 localStorage 持久化，记录每个补全项的选择次数和最近使用时间。
 * 用于 SQL 补全排序优化：常用项优先展示。
 */

const STORAGE_KEY = 'devforge:completion-frequency'
/** 最大条目数，防止 localStorage 无限膨胀 */
const MAX_ENTRIES = 500

interface FrequencyEntry {
  /** 选择次数 */
  count: number
  /** 最近使用时间戳 */
  lastUsed: number
}

type FrequencyMap = Record<string, FrequencyEntry>

/** 内存缓存，避免频繁读 localStorage */
let cache: FrequencyMap | null = null

/** 从 localStorage 读取频率数据 */
function loadFrequencyMap(): FrequencyMap {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    cache = raw ? JSON.parse(raw) : {}
  } catch {
    cache = {}
  }
  return cache!
}

/** 持久化频率数据到 localStorage（带节流，最多每 2 秒写一次） */
let saveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (!cache) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
    } catch {
      // localStorage 满了，清理旧条目后重试
      cache = pruneEntries(cache)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
      } catch {
        // 放弃持久化
      }
    }
  }, 2000)
}

/** 清理过期条目，保留最近使用的 MAX_ENTRIES * 0.7 条 */
function pruneEntries(map: FrequencyMap): FrequencyMap {
  const entries = Object.entries(map)
  if (entries.length <= MAX_ENTRIES) return map

  const keepCount = Math.floor(MAX_ENTRIES * 0.7)
  const sorted = entries.sort((a, b) => b[1].lastUsed - a[1].lastUsed)
  const pruned: FrequencyMap = {}
  for (let i = 0; i < keepCount && i < sorted.length; i++) {
    pruned[sorted[i]![0]!] = sorted[i]![1]!
  }
  return pruned
}

/** 记录一次补全项选择 */
export function recordCompletionUsage(label: string): void {
  const map = loadFrequencyMap()
  const existing = map[label]
  const now = Date.now()

  if (existing) {
    existing.count += 1
    existing.lastUsed = now
  } else {
    map[label] = { count: 1, lastUsed: now }
  }

  // 超过上限时清理
  if (Object.keys(map).length > MAX_ENTRIES) {
    cache = pruneEntries(map)
  }

  scheduleSave()
}

/**
 * 计算补全项排序分数（0.0 - 1.0，越高越优先）
 * 混合策略：频率权重 0.6 + 时效性权重 0.4
 * 时效性 = 1.0 - min(距上次使用天数 / 30, 1.0)
 */
export function getCompletionScore(label: string): number {
  const map = loadFrequencyMap()
  const entry = map[label]
  if (!entry) return 0

  // 频率分数：对数缩放，避免高频项过度主导
  const freqScore = Math.min(Math.log2(entry.count + 1) / 6, 1.0)

  // 时效性分数：30 天衰减
  const daysSinceLastUse = (Date.now() - entry.lastUsed) / (1000 * 60 * 60 * 24)
  const recencyScore = 1.0 - Math.min(daysSinceLastUse / 30, 1.0)

  return freqScore * 0.6 + recencyScore * 0.4
}
