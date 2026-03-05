import { ref, onMounted } from 'vue'

export interface PerformanceMetrics {
  startupTime: number
  memoryUsage: number
  componentLoadTime: Map<string, number>
}

const metrics = ref<PerformanceMetrics>({
  startupTime: 0,
  memoryUsage: 0,
  componentLoadTime: new Map(),
})

const startTime = performance.now()

export function usePerformance() {
  onMounted(() => {
    // 记录启动时间
    metrics.value.startupTime = performance.now() - startTime

    // 监控内存使用（如果浏览器支持）
    if ('memory' in performance) {
      const memory = (performance as any).memory
      metrics.value.memoryUsage = memory.usedJSHeapSize / 1024 / 1024 // MB
    }
  })

  function trackComponentLoad(componentName: string, loadTime: number) {
    metrics.value.componentLoadTime.set(componentName, loadTime)
  }

  function getMetrics() {
    return metrics.value
  }

  function getFormattedMetrics() {
    return {
      startupTime: `${metrics.value.startupTime.toFixed(2)}ms`,
      memoryUsage: `${metrics.value.memoryUsage.toFixed(2)}MB`,
      componentLoadTime: Array.from(metrics.value.componentLoadTime.entries()).map(
        ([name, time]) => ({
          name,
          time: `${time.toFixed(2)}ms`,
        })
      ),
    }
  }

  return {
    metrics,
    trackComponentLoad,
    getMetrics,
    getFormattedMetrics,
  }
}

// 全局性能监控
export function startPerformanceMonitoring() {
  // 监听页面加载性能
  window.addEventListener('load', () => {
    const perfData = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    if (perfData) {
      console.log('[Performance] Page Load Metrics:', {
        domContentLoaded: `${perfData.domContentLoadedEventEnd - perfData.domContentLoadedEventStart}ms`,
        loadComplete: `${perfData.loadEventEnd - perfData.loadEventStart}ms`,
        domInteractive: `${perfData.domInteractive - perfData.fetchStart}ms`,
      })
    }
  })

  // 监听资源加载性能
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration > 1000) {
        // 只记录超过 1 秒的慢加载
        console.warn('[Performance] Slow Resource:', {
          name: entry.name,
          duration: `${entry.duration.toFixed(2)}ms`,
          type: entry.entryType,
        })
      }
    }
  })

  observer.observe({ entryTypes: ['resource', 'measure'] })

  // 页面卸载时自动清理 observer
  window.addEventListener('beforeunload', () => {
    observer.disconnect()
  })

  return observer
}
