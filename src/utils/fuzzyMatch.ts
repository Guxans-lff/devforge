/**
 * 简易模糊匹配算法
 * query 中的每个字符按顺序出现在 target 中即匹配
 * 连续匹配和词首匹配获得更高分数
 */
export function fuzzyMatch(query: string, target: string): { match: boolean; score: number } {
  if (!query) return { match: true, score: 0 }
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  let qi = 0
  let score = 0
  let lastMatchIndex = -1

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // 连续匹配加分
      score += ti === lastMatchIndex + 1 ? 2 : 1
      // 词首匹配加分（首字符或前一字符为分隔符）
      if (ti === 0 || t[ti - 1] === ' ' || t[ti - 1] === '-' || t[ti - 1] === '_') {
        score += 3
      }
      lastMatchIndex = ti
      qi++
    }
  }

  return { match: qi === q.length, score }
}

/**
 * 对一组项目进行模糊匹配过滤和排序
 * @param items 待搜索列表
 * @param query 搜索词
 * @param getText 从 item 中提取搜索文本的函数
 * @param maxResults 最大返回数量（默认 50，避免大列表性能问题）
 */
export function fuzzyFilter<T>(items: T[], query: string, getText: (item: T) => string, maxResults = 50): T[] {
  if (!query) return items.slice(0, maxResults)

  return items
    .map(item => ({ item, result: fuzzyMatch(query, getText(item)) }))
    .filter(({ result }) => result.match)
    .sort((a, b) => b.result.score - a.result.score)
    .slice(0, maxResults)
    .map(({ item }) => item)
}
