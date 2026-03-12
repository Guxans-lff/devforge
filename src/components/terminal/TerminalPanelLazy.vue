<script setup lang="ts">
import { ref, defineAsyncComponent } from 'vue'

const props = defineProps<{
  connectionId: string
  connectionName: string
}>()

const emit = defineEmits<{
  statusChange: [status: string]
  cwdChange: [path: string]
}>()

// 异步加载 Terminal 组件（chunk 分离），但不再人为延迟
const TerminalPanel = defineAsyncComponent(() => import('./TerminalPanel.vue'))
const innerRef = ref<InstanceType<typeof TerminalPanel> | null>(null)

function handleStatusChange(status: string) {
  emit('statusChange', status)
}

function handleCwdChange(path: string) {
  emit('cwdChange', path)
}

// 透传内部 TerminalPanel 的方法
function sendData(data: string) {
  ;(innerRef.value as any)?.sendData(data)
}

function getSessionInfo() {
  return (innerRef.value as any)?.getSessionInfo() ?? { sessionId: '', cols: 120, rows: 40 }
}

function reconnect() {
  ;(innerRef.value as any)?.reconnect()
}

function handleResize() {
  ;(innerRef.value as any)?.handleResize()
}

// 搜索功能透传
function searchFind(query: string, options?: any) {
  return (innerRef.value as any)?.searchFind(query, options)
}

function searchFindNext(query: string, options?: any) {
  return (innerRef.value as any)?.searchFindNext(query, options)
}

function searchFindPrevious(query: string, options?: any) {
  return (innerRef.value as any)?.searchFindPrevious(query, options)
}

function searchClear() {
  ;(innerRef.value as any)?.searchClear()
}

// cwd 相关方法透传
function getCwd(): string {
  return (innerRef.value as any)?.getCwd() ?? ''
}

function requestCwd(): Promise<string> {
  console.log('[TerminalPanelLazy.requestCwd] innerRef:', !!innerRef.value)
  return (innerRef.value as any)?.requestCwd() ?? Promise.resolve('')
}

defineExpose({ sendData, getSessionInfo, reconnect, handleResize, getCwd, requestCwd, searchFind, searchFindNext, searchFindPrevious, searchClear })
</script>

<template>
  <div class="h-full w-full">
    <!-- 异步组件自带 loading 态，无需人为延迟 -->
    <Suspense>
      <TerminalPanel
        ref="innerRef"
        :connection-id="connectionId"
        :connection-name="connectionName"
        @status-change="handleStatusChange"
        @cwd-change="handleCwdChange"
      />
      <template #fallback>
        <div class="flex h-full w-full items-center justify-center bg-muted/30">
          <div class="flex flex-col items-center gap-2">
            <div class="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p class="text-sm text-muted-foreground">加载终端...</p>
          </div>
        </div>
      </template>
    </Suspense>
  </div>
</template>
