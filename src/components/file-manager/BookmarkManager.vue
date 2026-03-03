<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FolderOpen, Trash2, GripVertical, ArrowUp, ArrowDown } from 'lucide-vue-next'

interface Bookmark {
  path: string
  label: string
  group: string
}

const props = defineProps<{
  open: boolean
  bookmarks: Bookmark[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  update: [bookmarks: Bookmark[]]
}>()

const { t } = useI18n()

// 编辑用的本地副本
const items = ref<Bookmark[]>([])

watch(
  () => props.open,
  (open) => {
    if (open) {
      items.value = props.bookmarks.map(b => ({ ...b }))
    }
  },
)

function updateLabel(index: number, label: string) {
  items.value = items.value.map((b, i) => i === index ? { ...b, label } : b)
}

function updateGroup(index: number, group: string) {
  items.value = items.value.map((b, i) => i === index ? { ...b, group } : b)
}

function removeItem(index: number) {
  items.value = [...items.value.slice(0, index), ...items.value.slice(index + 1)]
}

function moveUp(index: number) {
  if (index <= 0) return
  const arr = [...items.value]
  ;[arr[index - 1], arr[index]] = [arr[index], arr[index - 1]]
  items.value = arr
}

function moveDown(index: number) {
  if (index >= items.value.length - 1) return
  const arr = [...items.value]
  ;[arr[index], arr[index + 1]] = [arr[index + 1], arr[index]]
  items.value = arr
}

function handleSave() {
  emit('update', items.value)
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[550px] max-h-[70vh] flex flex-col">
      <DialogHeader>
        <DialogTitle>{{ t('fileManager.manageBookmarks') }}</DialogTitle>
      </DialogHeader>

      <div class="min-h-0 flex-1 overflow-auto space-y-1">
        <div v-if="items.length === 0" class="py-8 text-center text-xs text-muted-foreground">
          {{ t('fileManager.noBookmarks') }}
        </div>
        <div
          v-for="(item, index) in items"
          :key="item.path"
          class="flex items-center gap-2 rounded-md border border-border p-2"
        >
          <GripVertical class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <FolderOpen class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div class="flex-1 min-w-0 space-y-1">
            <div class="flex gap-2">
              <Input
                :model-value="item.label"
                class="h-6 text-xs"
                :placeholder="t('fileManager.bookmarkName')"
                @update:model-value="updateLabel(index, $event as string)"
              />
              <Input
                :model-value="item.group"
                class="h-6 w-24 text-xs"
                :placeholder="t('fileManager.bookmarkGroup')"
                @update:model-value="updateGroup(index, $event as string)"
              />
            </div>
            <div class="truncate text-[10px] text-muted-foreground font-mono">{{ item.path }}</div>
          </div>
          <div class="flex flex-col gap-0.5">
            <Button variant="ghost" size="icon" class="h-5 w-5" :disabled="index === 0" @click="moveUp(index)">
              <ArrowUp class="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" class="h-5 w-5" :disabled="index === items.length - 1" @click="moveDown(index)">
              <ArrowDown class="h-3 w-3" />
            </Button>
          </div>
          <Button variant="ghost" size="icon" class="h-6 w-6 text-destructive" @click="removeItem(index)">
            <Trash2 class="h-3 w-3" />
          </Button>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">
          {{ t('common.cancel') }}
        </Button>
        <Button @click="handleSave">
          {{ t('common.save') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
