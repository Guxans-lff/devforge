<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Plus, Trash2, Save } from 'lucide-vue-next'
import { redisHashGetAll, redisHashSet, redisHashDel } from '@/api/redis'
import { useToast } from '@/composables/useToast'
import { parseBackendError } from '@/types/error'
import type { HashField } from '@/types/redis'

const props = defineProps<{
  connectionId: string
  redisKey: string
}>()

const { t } = useI18n()
const toast = useToast()

const fields = ref<HashField[]>([])
const loading = ref(false)

// 新增字段
const newField = ref('')
const newValue = ref('')

// 编辑中的字段
const editingField = ref<string | null>(null)
const editValue = ref('')

async function loadFields() {
  loading.value = true
  try {
    fields.value = await redisHashGetAll(props.connectionId, props.redisKey)
  } catch (e: unknown) {
    toast.error(t('redis.loadHashFailed'), parseBackendError(e).message)
  } finally {
    loading.value = false
  }
}

async function handleAdd() {
  const field = newField.value.trim()
  if (!field) return
  try {
    await redisHashSet(props.connectionId, props.redisKey, field, newValue.value)
    newField.value = ''
    newValue.value = ''
    await loadFields()
  } catch (e: unknown) {
    toast.error(t('redis.addFieldFailed'), parseBackendError(e).message)
  }
}

async function handleSaveEdit(field: string) {
  try {
    await redisHashSet(props.connectionId, props.redisKey, field, editValue.value)
    editingField.value = null
    await loadFields()
  } catch (e: unknown) {
    toast.error(t('redis.saveFailed'), parseBackendError(e).message)
  }
}

async function handleDelete(field: string) {
  try {
    await redisHashDel(props.connectionId, props.redisKey, [field])
    await loadFields()
  } catch (e: unknown) {
    toast.error(t('redis.deleteKeyFailed'), parseBackendError(e).message)
  }
}

function startEdit(field: HashField) {
  editingField.value = field.field
  editValue.value = field.value
}

watch(() => props.redisKey, () => { loadFields() })
onMounted(() => { loadFields() })
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 添加字段 -->
    <div class="flex items-center gap-2 px-4 py-2 border-b border-border/20">
      <Input v-model="newField" :placeholder="t('redis.fieldName')" class="h-7 text-[11px] flex-1" />
      <Input v-model="newValue" :placeholder="t('redis.fieldValue')" class="h-7 text-[11px] flex-1" @keydown.enter="handleAdd" />
      <Button variant="ghost" size="sm" class="h-7 px-2" :disabled="!newField.trim()" @click="handleAdd">
        <Plus class="h-3.5 w-3.5" />
      </Button>
    </div>

    <!-- 字段列表 -->
    <ScrollArea class="flex-1">
      <table class="w-full text-[11px]">
        <thead class="sticky top-0 bg-muted/30 z-10">
          <tr class="border-b border-border/20">
            <th class="px-4 py-2 text-left font-bold text-muted-foreground/60 w-[35%]">Field</th>
            <th class="px-4 py-2 text-left font-bold text-muted-foreground/60">Value</th>
            <th class="px-4 py-2 w-16"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="field in fields"
            :key="field.field"
            class="border-b border-border/10 hover:bg-muted/20 group"
          >
            <td class="px-4 py-1.5 font-mono font-medium text-foreground/80 truncate max-w-[200px]">{{ field.field }}</td>
            <td class="px-4 py-1.5">
              <template v-if="editingField === field.field">
                <div class="flex items-center gap-1">
                  <Input
                    v-model="editValue"
                    class="h-6 text-[11px] font-mono flex-1"
                    @keydown.enter="handleSaveEdit(field.field)"
                    @keydown.escape="editingField = null"
                    autofocus
                  />
                  <Button variant="ghost" size="sm" class="h-6 px-1" @click="handleSaveEdit(field.field)">
                    <Save class="h-3 w-3" />
                  </Button>
                </div>
              </template>
              <template v-else>
                <span
                  class="font-mono text-foreground/60 truncate block max-w-[400px] cursor-pointer hover:text-foreground"
                  @dblclick="startEdit(field)"
                >{{ field.value }}</span>
              </template>
            </td>
            <td class="px-4 py-1.5 text-right">
              <Trash2
                class="h-3 w-3 inline-block text-muted-foreground/20 opacity-0 group-hover:opacity-100 hover:text-destructive cursor-pointer transition-all"
                @click="handleDelete(field.field)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </ScrollArea>
  </div>
</template>
