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
}>(), {
  variant: 'default',
  confirmLabel: 'OK',
  cancelLabel: 'Cancel',
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
    <DialogContent class="max-w-sm">
      <DialogHeader>
        <div class="flex items-center gap-2">
          <div
            v-if="variant === 'destructive'"
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/10"
          >
            <AlertTriangle class="h-4 w-4 text-destructive" />
          </div>
          <DialogTitle class="text-sm">{{ title }}</DialogTitle>
        </div>
        <DialogDescription v-if="description" class="text-xs">
          {{ description }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter class="gap-2 sm:gap-0">
        <Button variant="outline" size="sm" class="h-7 text-xs" @click="handleCancel">
          {{ cancelLabel }}
        </Button>
        <Button
          :variant="variant === 'destructive' ? 'destructive' : 'default'"
          size="sm"
          class="h-7 text-xs"
          @click="handleConfirm"
        >
          {{ confirmLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
