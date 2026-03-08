<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive'
  class?: string
}>(), {
  variant: 'default',
  confirmLabel: '确定',
  cancelLabel: '取消',
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: []
  cancel: []
}>()

function handleConfirm() {
  emit('confirm')
  emit('update:open', false)
}

function handleCancel() {
  emit('cancel')
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent :class="['p-0 overflow-hidden border-none shadow-[0_24px_48px_-12px_rgba(0,0,0,0.15)] rounded-3xl bg-background/90 backdrop-blur-xl ring-1 ring-white/10', props.class || 'max-w-md']">
      <div class="relative p-7">
        <div class="flex flex-col items-center text-center">
          <!-- 核心图标 -->
          <div 
            :class="[
              'mb-6 flex h-14 w-14 items-center justify-center rounded-2xl shadow-xl transition-transform hover:scale-105 duration-300',
              variant === 'destructive' 
                ? 'bg-destructive/10 text-destructive ring-2 ring-destructive/5' 
                : 'bg-primary/10 text-primary ring-2 ring-primary/5'
            ]"
          >
            <AlertTriangle v-if="variant === 'destructive'" class="h-7 w-7" />
            <div v-else class="h-7 w-7 rounded-full border-2 border-current flex items-center justify-center font-black text-lg">!</div>
          </div>

          <!-- 文本区域 -->
          <div class="space-y-3 max-w-[300px]">
            <h3 class="text-xl font-bold tracking-tight text-foreground">{{ title }}</h3>
            <p v-if="description" class="text-[11px] font-medium text-muted-foreground/60 leading-relaxed px-1">
              {{ description }}
            </p>
          </div>

          <!-- 操作区 (横向紧凑) -->
          <div class="flex w-full gap-2.5 mt-8">
            <Button 
              variant="ghost" 
              class="flex-1 h-11 rounded-xl text-[11px] font-bold text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-all uppercase tracking-widest" 
              @click="handleCancel"
            >
              {{ cancelLabel }}
            </Button>
            <Button
              :variant="variant === 'destructive' ? 'destructive' : 'default'"
              class="flex-1 h-11 rounded-xl text-[11px] font-black shadow-lg transition-all active:scale-[0.98] uppercase tracking-widest"
              :class="variant === 'destructive' ? 'shadow-destructive/20' : 'shadow-primary/20'"
              @click="handleConfirm"
            >
              {{ confirmLabel }}
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
