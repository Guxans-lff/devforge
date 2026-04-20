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
    metrics.value.startupTime = performance.now() - startTime

    if (performance.memory) {
      const memory = performance.memory
      metrics.value.memoryUsage = memory.usedJSHeapSize / 1024 / 1024
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
        }),
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

export function startPerformanceMonitoring() {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration <= 1000) continue
      console.warn('[Performance] slow entry', {
        name: entry.name,
        type: entry.entryType,
        durationMs: Math.round(entry.duration),
      })
    }
  })

  const onLoad = () => {
    const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (!navEntry) return
    console.info('[Performance] navigation', {
      domContentLoadedMs: Math.round(navEntry.domContentLoadedEventEnd - navEntry.startTime),
      loadEventMs: Math.round(navEntry.loadEventEnd - navEntry.startTime),
    })
  }

  const onBeforeUnload = () => {
    observer.disconnect()
    window.removeEventListener('load', onLoad)
    window.removeEventListener('beforeunload', onBeforeUnload)
  }

  window.addEventListener('load', onLoad, { once: true })
  window.addEventListener('beforeunload', onBeforeUnload)
  observer.observe({ entryTypes: ['resource', 'measure'] })

  return observer
}
