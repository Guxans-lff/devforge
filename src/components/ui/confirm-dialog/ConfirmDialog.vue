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
    <DialogContent :class="['p-0 overflow-hidden border border-border/40 shadow-2xl rounded-2xl bg-background/98 backdrop-blur-3xl', props.class || 'max-w-[340px]']">
      <div class="relative p-7 flex flex-col items-center">
        <!-- 核心图标 (大师版轻量化) -->
        <div 
          :class="[
            'mb-5 flex h-12 w-12 items-center justify-center rounded-xl shadow-lg transition-transform hover:scale-105 duration-300 border',
            variant === 'destructive' 
              ? 'bg-destructive/10 text-destructive border-destructive/20' 
              : 'bg-primary/10 text-primary border-primary/20'
          ]"
        >
          <AlertTriangle v-if="variant === 'destructive'" class="h-6 w-6" />
          <div v-else class="text-[20px] font-black leading-none">!</div>
        </div>

        <!-- 文本区域 (极简排版) -->
        <div class="text-center space-y-2 mb-8">
          <DialogTitle class="text-[15px] font-extrabold tracking-tight text-foreground/90">{{ title }}</DialogTitle>
          <DialogDescription v-if="description" class="text-[11px] font-bold text-muted-foreground/40 leading-relaxed px-4 uppercase tracking-tighter">
            {{ description }}
          </DialogDescription>
        </div>

        <!-- 操作区 (大师级收紧比例) -->
        <div class="flex w-full gap-2.5">
          <Button 
            variant="outline" 
            class="flex-1 h-9 rounded-xl text-[11px] font-bold text-foreground/60 border-border/40 hover:bg-muted transition-all" 
            @click="handleCancel"
          >
            {{ cancelLabel }}
          </Button>
          <Button
            :variant="variant === 'destructive' ? 'destructive' : 'default'"
            class="flex-1 h-9 rounded-xl text-[11px] font-black shadow-lg shadow-primary/20 transition-all active:scale-[0.96]"
            :class="variant === 'destructive' ? 'shadow-destructive/20' : 'shadow-primary/20'"
            @click="handleConfirm"
          >
            {{ confirmLabel }}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
