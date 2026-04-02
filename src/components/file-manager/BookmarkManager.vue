<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { Bookmark, Trash2, GripVertical, ArrowUp, ArrowDown } from 'lucide-vue-next'

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
  ;[arr[index - 1]!, arr[index]!] = [arr[index]!, arr[index - 1]!]
  items.value = arr
}

function moveDown(index: number) {
  if (index >= items.value.length - 1) return
  const arr = [...items.value]
  ;[arr[index]!, arr[index + 1]!] = [arr[index + 1]!, arr[index]!]
  items.value = arr
}

function handleSave() {
  emit('update', items.value)
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[450px] p-0 overflow-hidden border border-border/40 shadow-2xl rounded-2xl bg-background/98 backdrop-blur-3xl flex flex-col max-h-[85vh]">
      <!-- Masterpiece Header -->
      <div class="px-5 py-3 border-b border-muted/30 flex items-center justify-between shrink-0">
        <div class="flex items-center gap-2">
          <Bookmark class="h-3.5 w-3.5 text-primary" />
          <DialogTitle class="text-[12px] font-black uppercase tracking-widest text-foreground/70">
            {{ t('fileManager.manageBookmarks') }}
          </DialogTitle>
        </div>
      </div>

      <div class="p-5 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <div class="space-y-3">
          <!-- Empty State -->
          <div v-if="items.length === 0" class="py-16 flex flex-col items-center justify-center text-center space-y-3">
            <div class="h-12 w-12 rounded-full bg-muted/20 flex items-center justify-center text-muted-foreground/30">
              <Bookmark class="h-6 w-6" />
            </div>
            <p class="text-[11px] font-bold text-muted-foreground/40 uppercase tracking-widest">
              {{ t('fileManager.noBookmarks') }}
            </p>
          </div>

          <!-- Bookmark List -->
          <div
            v-for="(item, index) in items"
            :key="item.path"
            class="group relative flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-muted/5 hover:bg-primary/[0.02] hover:border-primary/20 transition-[background-color,border-color]"
          >
            <div class="cursor-grab active:cursor-grabbing p-1 text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors">
              <GripVertical class="h-3.5 w-3.5" />
            </div>
            
            <div class="flex-1 min-w-0 space-y-2">
              <div class="flex gap-2">
                <div class="flex-1 relative">
                  <Input
                    :model-value="item.label"
                    class="h-8 rounded-lg border-border/60 bg-background/50 px-2.5 text-[11px] font-bold transition-[border-color,box-shadow] focus:border-primary focus:ring-4 focus:ring-primary/5"
                    :placeholder="t('fileManager.bookmarkName')"
                    @update:model-value="updateLabel(index, $event as string)"
                  />
                </div>
                <div class="w-24 relative">
                  <Input
                    :model-value="item.group"
                    class="h-8 rounded-lg border-border/60 bg-background/50 px-2.5 text-[11px] font-bold transition-[border-color,box-shadow] focus:border-primary focus:ring-4 focus:ring-primary/5 italic text-primary/70"
                    :placeholder="t('fileManager.bookmarkGroup')"
                    @update:model-value="updateGroup(index, $event as string)"
                  />
                </div>
              </div>
              <div class="px-1 truncate text-[9px] font-mono text-muted-foreground/50 tracking-tight">
                {{ item.path }}
              </div>
            </div>

            <div class="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <div class="flex gap-1">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  class="h-6 w-6 rounded-lg hover:bg-primary/10 hover:text-primary disabled:opacity-20" 
                  :disabled="index === 0" 
                  @click="moveUp(index)"
                >
                  <ArrowUp class="h-3 w-3" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  class="h-6 w-6 rounded-lg hover:bg-primary/10 hover:text-primary disabled:opacity-20" 
                  :disabled="index === items.length - 1" 
                  @click="moveDown(index)"
                >
                  <ArrowDown class="h-3 w-3" />
                </Button>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                class="h-6 w-24 w-full rounded-lg hover:bg-destructive/10 hover:text-destructive text-muted-foreground/40" 
                @click="removeItem(index)"
              >
                <Trash2 class="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter class="px-5 py-4 border-t border-muted/30 flex gap-2.5 sm:justify-start shrink-0">
        <Button 
          variant="outline" 
          class="flex-1 h-9 rounded-xl text-[11px] font-bold text-foreground/60 border-border/40 hover:bg-muted transition-colors"
          @click="emit('update:open', false)"
        >
          {{ t('common.cancel') }}
        </Button>
        <Button 
          class="flex-1 h-9 rounded-xl text-[11px] font-black shadow-lg shadow-primary/20 transition-[background-color,color,box-shadow,scale] active:scale-[0.96]" 
          @click="handleSave"
        >
          {{ t('common.save') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
