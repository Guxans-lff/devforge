<script setup lang="ts">
/**
 * 记忆编辑对话框
 *
 * 支持新增/编辑记忆条目：标题、内容、tags、类型、权重。
 */
import { ref, watch, computed } from 'vue'
import type { AiMemory, MemoryType } from '@/types/ai'
import { X } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  open: boolean
  /** 编辑模式传入已有记忆，新增模式不传 */
  memory?: AiMemory | null
  workspaceId: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: [memory: AiMemory]
}>()

const title = ref('')
const content = ref('')
const tags = ref('')
const memoryType = ref<MemoryType>('knowledge')
const weight = ref(1.0)

const isEdit = computed(() => !!props.memory)

watch(() => props.open, (open) => {
  if (open && props.memory) {
    title.value = props.memory.title
    content.value = props.memory.content
    tags.value = props.memory.tags
    memoryType.value = props.memory.type as MemoryType
    weight.value = props.memory.weight
  } else if (open) {
    title.value = ''
    content.value = ''
    tags.value = ''
    memoryType.value = 'knowledge'
    weight.value = 1.0
  }
})

function handleSave() {
  if (!content.value.trim()) return

  const now = Date.now()
  const memory: AiMemory = {
    id: props.memory?.id ?? `mem-${now}-${Math.random().toString(36).slice(2, 7)}`,
    workspaceId: props.workspaceId,
    type: memoryType.value,
    title: title.value.trim(),
    content: content.value.trim(),
    tags: tags.value.trim(),
    sourceSessionId: props.memory?.sourceSessionId,
    weight: weight.value,
    lastUsedAt: props.memory?.lastUsedAt,
    createdAt: props.memory?.createdAt ?? now,
    updatedAt: now,
  }
  emit('save', memory)
  emit('update:open', false)
}

const TYPE_OPTIONS: { value: MemoryType; label: string }[] = [
  { value: 'knowledge', label: '知识' },
  { value: 'summary', label: '摘要' },
  { value: 'preference', label: '偏好' },
]
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-150"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
        <!-- 遮罩 -->
        <div class="absolute inset-0 bg-black/50" @click="emit('update:open', false)" />

        <!-- 对话框 -->
        <div class="relative w-[480px] max-h-[80vh] rounded-xl border bg-background shadow-xl flex flex-col">
          <!-- 头部 -->
          <div class="flex items-center justify-between px-5 py-4 border-b">
            <h3 class="text-sm font-semibold">{{ isEdit ? '编辑记忆' : '新增记忆' }}</h3>
            <button class="text-muted-foreground hover:text-foreground" @click="emit('update:open', false)">
              <X class="h-4 w-4" />
            </button>
          </div>

          <!-- 表单 -->
          <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <!-- 类型 -->
            <div>
              <label class="text-xs font-medium text-muted-foreground mb-1.5 block">类型</label>
              <div class="flex gap-2">
                <button
                  v-for="opt in TYPE_OPTIONS"
                  :key="opt.value"
                  class="px-3 py-1.5 rounded-md text-xs border transition-colors"
                  :class="memoryType === opt.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:bg-muted'"
                  @click="memoryType = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 标题 -->
            <div>
              <label class="text-xs font-medium text-muted-foreground mb-1.5 block">标题</label>
              <input
                v-model="title"
                class="w-full rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="简短描述"
              />
            </div>

            <!-- 内容 -->
            <div>
              <label class="text-xs font-medium text-muted-foreground mb-1.5 block">内容</label>
              <textarea
                v-model="content"
                rows="5"
                class="w-full rounded-md border bg-transparent px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="记忆详细内容…"
              />
            </div>

            <!-- Tags -->
            <div>
              <label class="text-xs font-medium text-muted-foreground mb-1.5 block">标签（逗号分隔）</label>
              <input
                v-model="tags"
                class="w-full rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Vue,TypeScript,架构"
              />
            </div>

            <!-- 权重 -->
            <div>
              <label class="text-xs font-medium text-muted-foreground mb-1.5 block">
                权重: {{ weight.toFixed(1) }}
              </label>
              <input
                v-model.number="weight"
                type="range"
                min="0"
                max="2"
                step="0.1"
                class="w-full"
              />
            </div>
          </div>

          <!-- 底部 -->
          <div class="flex justify-end gap-2 px-5 py-4 border-t">
            <Button variant="ghost" size="sm" @click="emit('update:open', false)">取消</Button>
            <Button size="sm" :disabled="!content.trim()" @click="handleSave">保存</Button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
