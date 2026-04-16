<script setup lang="ts">
/**
 * 记忆管理抽屉
 *
 * 按类型分组展示记忆列表，支持搜索、新增、编辑、删除。
 * 包含压缩规则编辑入口。
 */
import { ref, computed } from 'vue'
import { useAiMemoryStore, DEFAULT_COMPACT_RULE } from '@/stores/ai-memory'
import AiMemoryEditor from './AiMemoryEditor.vue'
import type { AiMemory, CompactRule } from '@/types/ai'
import {
  Brain,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  BookOpen,
  FileText,
  Settings2,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const memoryStore = useAiMemoryStore()

const searchQuery = ref('')
const showEditor = ref(false)
const editingMemory = ref<AiMemory | null>(null)
const showCompactRuleEditor = ref(false)
const compactRuleText = ref('')

/** 搜索过滤后的记忆（按类型分组） */
const filteredGroups = computed(() => {
  const q = searchQuery.value.toLowerCase()
  const groups = memoryStore.memoriesByType

  if (!q) return groups

  const filter = (list: AiMemory[]) =>
    list.filter(m =>
      m.title.toLowerCase().includes(q) ||
      m.content.toLowerCase().includes(q) ||
      m.tags.toLowerCase().includes(q),
    )

  return {
    knowledge: filter(groups.knowledge),
    summary: filter(groups.summary),
    preference: filter(groups.preference),
  }
})

const groupConfig = [
  { key: 'knowledge' as const, label: '知识', icon: BookOpen, color: 'text-blue-500' },
  { key: 'summary' as const, label: '摘要', icon: FileText, color: 'text-green-500' },
  { key: 'preference' as const, label: '偏好', icon: Settings2, color: 'text-amber-500' },
]

function handleNew() {
  editingMemory.value = null
  showEditor.value = true
}

function handleEdit(memory: AiMemory) {
  editingMemory.value = memory
  showEditor.value = true
}

async function handleDelete(id: string) {
  await memoryStore.deleteMemory(id)
}

async function handleSave(memory: AiMemory) {
  await memoryStore.saveMemory(memory)
}

function openCompactRuleEditor() {
  const rule = memoryStore.compactRule
  compactRuleText.value = `P0-必须保留: ${rule.p0}\nP1-尽量保留: ${rule.p1}\nP2-立即丢弃: ${rule.p2}\n压缩比目标: ${Math.round(rule.ratio * 100)}%`
  showCompactRuleEditor.value = true
}

async function saveCompactRule() {
  const lines = compactRuleText.value.split('\n')
  const rule: CompactRule = { ...DEFAULT_COMPACT_RULE }
  for (const line of lines) {
    if (line.startsWith('P0')) rule.p0 = line.replace(/^P0[^:]*:\s*/, '')
    else if (line.startsWith('P1')) rule.p1 = line.replace(/^P1[^:]*:\s*/, '')
    else if (line.startsWith('P2')) rule.p2 = line.replace(/^P2[^:]*:\s*/, '')
    else if (line.includes('压缩比')) {
      const match = line.match(/(\d+)%/)
      if (match) rule.ratio = parseInt(match[1]) / 100
    }
  }
  await memoryStore.saveCompactRule(rule)
  showCompactRuleEditor.value = false
}

/** 清理无效记忆 */
async function cleanOrphanMemories() {
  // TODO: 需要后端路径存在性检查支持
  console.warn('[Memory] 清理无效记忆功能待完善（需要后端路径检查支持）')
}

/** 格式化时间 */
function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <!-- 抽屉遮罩 -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-150"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-40 bg-black/30" @click="emit('update:open', false)" />
    </Transition>

    <!-- 抽屉面板 -->
    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      enter-from-class="translate-x-full"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-to-class="translate-x-full"
    >
      <div
        v-if="open"
        class="fixed right-0 top-0 z-50 h-full w-[400px] border-l bg-background shadow-xl flex flex-col"
      >
        <!-- 头部 -->
        <div class="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div class="flex items-center gap-2">
            <Brain class="h-4 w-4 text-primary" />
            <span class="text-sm font-semibold">项目记忆</span>
            <span class="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {{ memoryStore.memories.length }}
            </span>
          </div>
          <div class="flex items-center gap-1">
            <Button variant="ghost" size="icon" class="h-7 w-7" @click="handleNew">
              <Plus class="h-3.5 w-3.5" />
            </Button>
            <button class="text-muted-foreground hover:text-foreground p-1" @click="emit('update:open', false)">
              <X class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- 搜索 -->
        <div class="px-4 py-2 shrink-0">
          <div class="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-1.5">
            <Search class="h-3.5 w-3.5 text-muted-foreground" />
            <input
              v-model="searchQuery"
              class="flex-1 bg-transparent text-xs focus:outline-none placeholder:text-muted-foreground/50"
              placeholder="搜索记忆…"
            />
          </div>
        </div>

        <!-- 记忆列表 -->
        <div class="flex-1 overflow-y-auto px-4 py-2 space-y-4">
          <div v-for="group in groupConfig" :key="group.key">
            <template v-if="filteredGroups[group.key].length > 0">
              <div class="flex items-center gap-1.5 mb-2">
                <component :is="group.icon" class="h-3.5 w-3.5" :class="group.color" />
                <span class="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  {{ group.label }} ({{ filteredGroups[group.key].length }})
                </span>
              </div>

              <div class="space-y-1.5">
                <div
                  v-for="memory in filteredGroups[group.key]"
                  :key="memory.id"
                  class="group rounded-lg border border-border/50 px-3 py-2.5 hover:border-border transition-colors"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex-1 min-w-0">
                      <p class="text-xs font-medium truncate">{{ memory.title || '(无标题)' }}</p>
                      <p class="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                        {{ memory.content }}
                      </p>
                    </div>
                    <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        class="p-1 rounded hover:bg-muted text-muted-foreground"
                        @click="handleEdit(memory)"
                      >
                        <Pencil class="h-3 w-3" />
                      </button>
                      <button
                        class="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                        @click="handleDelete(memory.id)"
                      >
                        <Trash2 class="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <div class="flex items-center gap-2 mt-1.5">
                    <span v-if="memory.tags" class="text-[10px] text-muted-foreground/60 truncate">
                      {{ memory.tags }}
                    </span>
                    <span class="text-[10px] text-muted-foreground/40 ml-auto shrink-0">
                      {{ formatTime(memory.updatedAt) }}
                    </span>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- 空状态 -->
          <div
            v-if="memoryStore.memories.length === 0"
            class="flex flex-col items-center justify-center py-12 text-center"
          >
            <Brain class="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p class="text-xs text-muted-foreground">暂无记忆</p>
            <p class="text-[10px] text-muted-foreground/60 mt-1">点击 + 添加项目知识</p>
          </div>
        </div>

        <!-- 底部：压缩规则编辑 + 清理 -->
        <div class="px-4 py-3 border-t shrink-0 space-y-1">
          <button
            class="w-full flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
            @click="openCompactRuleEditor"
          >
            <Settings2 class="h-3.5 w-3.5" />
            编辑压缩规则
          </button>
          <button
            class="w-full flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            @click="cleanOrphanMemories"
          >
            <Trash2 class="h-3.5 w-3.5" />
            清理无效记忆
          </button>
        </div>

        <!-- 压缩规则编辑弹窗 -->
        <Teleport to="body">
          <Transition
            enter-active-class="transition-opacity duration-200"
            enter-from-class="opacity-0"
            leave-active-class="transition-opacity duration-150"
            leave-to-class="opacity-0"
          >
            <div v-if="showCompactRuleEditor" class="fixed inset-0 z-[60] flex items-center justify-center">
              <div class="absolute inset-0 bg-black/50" @click="showCompactRuleEditor = false" />
              <div class="relative w-[500px] rounded-xl border bg-background shadow-xl p-5">
                <h3 class="text-sm font-semibold mb-3">压缩规则</h3>
                <textarea
                  v-model="compactRuleText"
                  rows="8"
                  class="w-full rounded-md border bg-transparent px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <div class="flex justify-end gap-2 mt-3">
                  <Button variant="ghost" size="sm" @click="showCompactRuleEditor = false">取消</Button>
                  <Button size="sm" @click="saveCompactRule">保存</Button>
                </div>
              </div>
            </div>
          </Transition>
        </Teleport>
      </div>
    </Transition>
  </Teleport>

  <!-- 编辑器 -->
  <AiMemoryEditor
    :open="showEditor"
    :memory="editingMemory"
    :workspace-id="memoryStore.currentWorkspaceId"
    @update:open="showEditor = $event"
    @save="handleSave"
  />
</template>
