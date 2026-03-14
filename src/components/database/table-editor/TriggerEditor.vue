<script setup lang="ts">
/**
 * 触发器编辑列表组件
 * 从 TableEditorPanel.vue 拆分，管理触发器的增删改
 */
import { X } from 'lucide-vue-next'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { TRIGGER_TIMINGS, TRIGGER_EVENTS, type TriggerDefinition } from '@/types/table-editor-constants'

defineProps<{ triggers: TriggerDefinition[] }>()

const emit = defineEmits<{
  updateTrigger: [idx: number, field: keyof TriggerDefinition, value: string]
  removeTrigger: [idx: number]
}>()
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <div class="flex-1 min-h-0 overflow-auto">
      <!-- 空状态 -->
      <div v-if="triggers.length === 0" class="flex flex-1 items-center justify-center py-8 text-xs text-muted-foreground/60">
        暂无触发器，点击上方「添加」按钮
      </div>
      <!-- 触发器列表 -->
      <div v-for="(trig, idx) in triggers" :key="idx" class="border-b border-border p-2.5 space-y-1.5">
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-muted-foreground/40 w-4 text-right">{{ idx + 1 }}</span>
          <input :value="trig.name" class="h-6 w-40 px-1.5 text-xs font-mono bg-transparent border border-border/60 rounded focus:border-primary/50 focus:outline-none" placeholder="触发器名称" @input="emit('updateTrigger', idx, 'name', ($event.target as HTMLInputElement).value)" />
          <Select :model-value="trig.timing" @update:model-value="emit('updateTrigger', idx, 'timing', $event as string)">
            <SelectTrigger class="h-6 w-24 text-xs font-mono"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="t in TRIGGER_TIMINGS" :key="t" :value="t" class="text-xs font-mono">{{ t }}</SelectItem>
            </SelectContent>
          </Select>
          <Select :model-value="trig.event" @update:model-value="emit('updateTrigger', idx, 'event', $event as string)">
            <SelectTrigger class="h-6 w-24 text-xs font-mono"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="ev in TRIGGER_EVENTS" :key="ev" :value="ev" class="text-xs font-mono">{{ ev }}</SelectItem>
            </SelectContent>
          </Select>
          <div class="flex-1" />
          <button class="size-5 inline-flex items-center justify-center rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all" @click="emit('removeTrigger', idx)">
            <X class="size-3" />
          </button>
        </div>
        <textarea :value="trig.body" class="w-full min-h-[60px] px-2 py-1.5 text-xs font-mono bg-muted/20 border border-border/60 rounded focus:border-primary/50 focus:outline-none resize-y" placeholder="BEGIN&#10;  -- 触发器逻辑&#10;END" @input="emit('updateTrigger', idx, 'body', ($event.target as HTMLTextAreaElement).value)" />
      </div>
    </div>
  </div>
</template>
