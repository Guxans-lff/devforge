<script setup lang="ts">
/**
 * ParamInputDialog - 参数化查询输入对话框
 * 检测到 :paramName 占位符时弹出，让用户填入参数值
 */
import { ref, watch, nextTick } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Play, X, Variable } from 'lucide-vue-next'

const props = defineProps<{
  open: boolean
  paramNames: string[]
  paramValues: Record<string, string>
}>()

const emit = defineEmits<{
  'update:open': [val: boolean]
  execute: [params: Record<string, string>]
}>()

const localValues = ref<Record<string, string>>({})
const firstInput = ref<HTMLInputElement | null>(null)

watch(() => props.open, (val) => {
  if (val) {
    localValues.value = { ...props.paramValues }
    nextTick(() => firstInput.value?.focus())
  }
})

function handleExecute() {
  emit('execute', { ...localValues.value })
}

function close() {
  emit('update:open', false)
}

function handleKeydown(e: KeyboardEvent, index: number) {
  if (e.key === 'Enter') {
    if (index === props.paramNames.length - 1) {
      // 最后一个参数，按 Enter 执行
      handleExecute()
    }
    // 否则跳到下一个输入框（自动 tab）
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      @click.self="close"
    >
      <div class="w-[480px] max-h-[80vh] flex flex-col rounded-2xl border border-border bg-background shadow-2xl">
        <!-- 标题栏 -->
        <div class="flex items-center gap-3 border-b border-border/30 px-6 py-4">
          <div class="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Variable class="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 class="text-sm font-black tracking-tight">参数化查询</h2>
            <p class="text-[10px] text-muted-foreground/50">请输入 SQL 参数值，数字直接替换，字符串自动加引号</p>
          </div>
          <div class="flex-1" />
          <Button variant="ghost" size="icon" class="h-7 w-7 rounded-full" @click="close">
            <X class="h-4 w-4" />
          </Button>
        </div>

        <!-- 参数输入区域 -->
        <div class="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
          <div v-for="(name, idx) in paramNames" :key="name" class="space-y-1.5">
            <Label class="text-[11px] font-bold text-muted-foreground ml-1">
              <span class="text-primary/60">:</span>{{ name }}
            </Label>
            <Input
              :ref="(el: unknown) => { if (idx === 0) { const comp = el as { $el?: HTMLElement } | null; firstInput = (comp?.$el ?? el) as HTMLInputElement | null } }"
              v-model="localValues[name]"
              class="h-9 text-sm font-mono bg-muted/20 border-border/50 focus:border-primary/40"
              :placeholder="`输入 ${name} 的值...`"
              @keydown="handleKeydown($event, idx)"
            />
          </div>
        </div>

        <!-- 底部操作栏 -->
        <div class="flex items-center justify-between border-t border-border/30 px-6 py-3">
          <div class="text-[10px] text-muted-foreground/40">
            共 {{ paramNames.length }} 个参数 · Enter 执行
          </div>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" class="h-8 text-xs" @click="close">
              取消
            </Button>
            <Button size="sm" class="h-8 text-xs gap-1.5" @click="handleExecute">
              <Play class="h-3.5 w-3.5" />
              执行
            </Button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
