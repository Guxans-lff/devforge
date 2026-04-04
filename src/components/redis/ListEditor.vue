<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Trash2, Save } from 'lucide-vue-next'
import { redisListRange, redisListPush, redisListSet, redisListRem } from '@/api/redis'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  connectionId: string
  redisKey: string
  total: number
}>()

const { t } = useI18n()
const toast = useToast()

const items = ref<string[]>([])
const loading = ref(false)
const newValue = ref('')
const editingIndex = ref<number | null>(null)
const editValue = ref('')

async function loadItems() {
  loading.value = true
  try {
    items.value = await redisListRange(props.connectionId, props.redisKey, 0, -1)
  } catch (e) {
    toast.error('加载 List 失败', (e as any)?.message ?? String(e))
  } finally {
    loading.value = false
  }
}

async function handlePush(head: boolean) {
  const val = newValue.value
  if (!val) return
  try {
    await redisListPush(props.connectionId, props.redisKey, [val], head)
    newValue.value = ''
    await loadItems()
  } catch (e) {
    toast.error('添加失败', (e as any)?.message ?? String(e))
  }
}

async function handleSaveEdit(index: number) {
  try {
    await redisListSet(props.connectionId, props.redisKey, index, editValue.value)
    editingIndex.value = null
    await loadItems()
  } catch (e) {
    toast.error('保存失败', (e as any)?.message ?? String(e))
  }
}

async function handleDelete(value: string) {
  try {
    await redisListRem(props.connectionId, props.redisKey, 1, value)
    await loadItems()
  } catch (e) {
    toast.error('删除失败', (e as any)?.message ?? String(e))
  }
}

function startEdit(index: number, value: string) {
  editingIndex.value = index
  editValue.value = value
}

watch(() => props.redisKey, () => { loadItems() })
onMounted(() => { loadItems() })
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 添加元素 -->
    <div class="flex items-center gap-2 px-4 py-2 border-b border-border/20">
      <Input v-model="newValue" :placeholder="t('redis.newElement')" class="h-7 text-[11px] flex-1" @keydown.enter="handlePush(false)" />
      <Button variant="ghost" size="sm" class="h-7 px-2 text-[10px]" :disabled="!newValue" @click="handlePush(true)">
        LPUSH
      </Button>
      <Button variant="ghost" size="sm" class="h-7 px-2 text-[10px]" :disabled="!newValue" @click="handlePush(false)">
        RPUSH
      </Button>
    </div>

    <!-- 列表 -->
    <ScrollArea class="flex-1">
      <table class="w-full text-[11px]">
        <thead class="sticky top-0 bg-muted/30 z-10">
          <tr class="border-b border-border/20">
            <th class="px-4 py-2 text-left font-bold text-muted-foreground/60 w-16">Index</th>
            <th class="px-4 py-2 text-left font-bold text-muted-foreground/60">Value</th>
            <th class="px-4 py-2 w-16"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(item, index) in items"
            :key="index"
            class="border-b border-border/10 hover:bg-muted/20 group"
          >
            <td class="px-4 py-1.5 font-mono text-muted-foreground/40">{{ index }}</td>
            <td class="px-4 py-1.5">
              <template v-if="editingIndex === index">
                <div class="flex items-center gap-1">
                  <Input
                    v-model="editValue"
                    class="h-6 text-[11px] font-mono flex-1"
                    @keydown.enter="handleSaveEdit(index)"
                    @keydown.escape="editingIndex = null"
                    autofocus
                  />
                  <Button variant="ghost" size="sm" class="h-6 px-1" @click="handleSaveEdit(index)">
                    <Save class="h-3 w-3" />
                  </Button>
                </div>
              </template>
              <template v-else>
                <span
                  class="font-mono text-foreground/60 truncate block max-w-[500px] cursor-pointer hover:text-foreground"
                  @dblclick="startEdit(index, item)"
                >{{ item }}</span>
              </template>
            </td>
            <td class="px-4 py-1.5 text-right">
              <Trash2
                class="h-3 w-3 inline-block text-muted-foreground/20 opacity-0 group-hover:opacity-100 hover:text-destructive cursor-pointer transition-all"
                @click="handleDelete(item)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </ScrollArea>
  </div>
</template>
