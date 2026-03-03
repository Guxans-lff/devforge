<script setup lang="ts">
import { ref, onMounted, defineAsyncComponent } from 'vue'

const props = defineProps<{
  connectionId: string
  connectionName: string
}>()

const emit = defineEmits<{
  statusChange: [status: string]
  cwdChange: [path: string]
}>()

// 延迟加载 Terminal
const isLoaded = ref(false)
const TerminalPanel = defineAsyncComponent(() => import('./TerminalPanel.vue'))

onMounted(() => {
  // 延迟 100ms 加载终端，避免阻塞初始渲染
  setTimeout(() => {
    isLoaded.value = true
  }, 100)
})

function handleStatusChange(status: string) {
  emit('statusChange', status)
}

function handleCwdChange(path: string) {
  emit('cwdChange', path)
}
</script>

<template>
  <div class="h-full w-full">
    <!-- 加载占位符 -->
    <div
      v-if="!isLoaded"
      class="flex h-full w-full items-center justify-center bg-muted/30"
    >
      <div class="flex flex-col items-center gap-2">
        <div class="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p class="text-sm text-muted-foreground">加载终端...</p>
      </div>
    </div>

    <!-- 实际终端 -->
    <TerminalPanel
      v-if="isLoaded"
      :connection-id="connectionId"
      :connection-name="connectionName"
      @status-change="handleStatusChange"
      @cwd-change="handleCwdChange"
    />
  </div>
</template>
