<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { TerminalSquare } from 'lucide-vue-next'
import { redisExecuteCommand } from '@/api/redis'
import type { RedisCliResult } from '@/types/redis'

const props = defineProps<{
  connectionId: string
}>()

const { t } = useI18n()

const command = ref('')
const history = ref<RedisCliResult[]>([])
const commandHistory = ref<string[]>([])
const historyIndex = ref(-1)
const outputRef = ref<HTMLElement>()

async function handleExecute() {
  const cmd = command.value.trim()
  if (!cmd) return

  commandHistory.value.unshift(cmd)
  historyIndex.value = -1
  command.value = ''

  try {
    const result = await redisExecuteCommand(props.connectionId, cmd)
    history.value.push(result)
  } catch (e) {
    history.value.push({
      command: cmd,
      result: (e as any)?.message ?? String(e),
      durationMs: 0,
      isError: true,
    })
  }

  await nextTick()
  scrollToBottom()
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (historyIndex.value < commandHistory.value.length - 1) {
      historyIndex.value++
      command.value = commandHistory.value[historyIndex.value]!
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (historyIndex.value > 0) {
      historyIndex.value--
      command.value = commandHistory.value[historyIndex.value]!
    } else {
      historyIndex.value = -1
      command.value = ''
    }
  }
}

function scrollToBottom() {
  if (outputRef.value) {
    outputRef.value.scrollTop = outputRef.value.scrollHeight
  }
}
</script>

<template>
  <div class="flex h-full flex-col border-l border-border/40 bg-zinc-950/50">
    <!-- 头部 -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 shrink-0">
      <TerminalSquare class="h-3.5 w-3.5 text-muted-foreground/50" />
      <span class="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wider">CLI</span>
    </div>

    <!-- 输出区域 -->
    <div ref="outputRef" class="flex-1 overflow-auto p-3 space-y-2 font-mono text-[11px]">
      <div v-for="(item, i) in history" :key="i" class="space-y-0.5">
        <div class="text-primary/70">
          <span class="text-muted-foreground/30">></span> {{ item.command }}
        </div>
        <div
          class="whitespace-pre-wrap pl-3"
          :class="item.isError ? 'text-destructive/70' : 'text-foreground/60'"
        >{{ item.result }}</div>
        <div class="text-[9px] text-muted-foreground/20">{{ item.durationMs }}ms</div>
      </div>

      <!-- 空状态 -->
      <div v-if="history.length === 0" class="text-muted-foreground/20 text-center py-4">
        {{ t('redis.cliHint') }}
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="flex items-center gap-2 px-3 py-2 border-t border-border/20 shrink-0">
      <span class="text-primary/50 text-[11px] font-mono font-bold">></span>
      <Input
        v-model="command"
        placeholder="GET key"
        class="h-7 flex-1 text-[11px] font-mono bg-transparent border-0 focus-visible:ring-0 px-0"
        @keydown.enter="handleExecute"
        @keydown="handleKeyDown"
      />
    </div>
  </div>
</template>
