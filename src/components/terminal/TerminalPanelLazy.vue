<script setup lang="ts">
import { ref, defineAsyncComponent } from 'vue'
import type { TerminalPanelExposed, TerminalSearchOptions } from '@/types/component-exposed'

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

/** 获取内部组件的类型安全引用 */
function getInner(): TerminalPanelExposed | undefined {
  return innerRef.value as unknown as TerminalPanelExposed | undefined
}

function handleStatusChange(status: string) {
  emit('statusChange', status)
}

function handleCwdChange(path: string) {
  emit('cwdChange', path)
}

// 透传内部 TerminalPanel 的方法
function sendData(data: string) {
  getInner()?.sendData(data)
}

function getSessionInfo() {
  return getInner()?.getSessionInfo() ?? { sessionId: '', cols: 120, rows: 40 }
}

function reconnect() {
  getInner()?.reconnect()
}

function handleResize() {
  getInner()?.handleResize()
}

// 搜索功能透传
function searchFind(query: string, options?: TerminalSearchOptions) {
  return getInner()?.searchFind(query, options) ?? false
}

function searchFindNext(query: string, options?: TerminalSearchOptions) {
  return getInner()?.searchFindNext(query, options) ?? false
}

function searchFindPrevious(query: string, options?: TerminalSearchOptions) {
  return getInner()?.searchFindPrevious(query, options) ?? false
}

function searchClear() {
  getInner()?.searchClear()
}

// cwd 相关方法透传
function getCwd(): string {
  return getInner()?.getCwd() ?? ''
}

function requestCwd(): Promise<string> {
  return getInner()?.requestCwd() ?? Promise.resolve('')
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
