<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ShieldAlert, ShieldCheck } from 'lucide-vue-next'
import type { DangerousStatement } from '@/types/environment'

const props = defineProps<{
  open: boolean
  statements: DangerousStatement[]
  /** 是否需要输入确认（生产环境） */
  needInput: boolean
  /** 输入目标（数据库名 / 连接名） */
  inputTarget: string
  confirmInput: string
  canConfirm: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:confirmInput': [value: string]
  confirm: []
}>()

const { t } = useI18n()
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-[420px] p-0 overflow-hidden border border-border/40 shadow-2xl rounded-2xl bg-background/98 backdrop-blur-3xl">
      <div class="relative p-6 flex flex-col">
        <!-- 顶部警告图标 -->
        <div class="mb-4 flex items-center gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive border border-destructive/20">
            <ShieldAlert class="h-5 w-5" />
          </div>
          <div>
            <DialogTitle class="text-sm font-bold text-foreground">{{ t('environment.dangerConfirmTitle') }}</DialogTitle>
            <DialogDescription class="text-[11px] text-muted-foreground mt-0.5">
              {{ t('environment.dangerConfirmDesc') }}
            </DialogDescription>
          </div>
        </div>

        <!-- 危险语句列表 -->
        <div class="mb-4 space-y-1.5 max-h-[200px] overflow-y-auto">
          <div
            v-for="(stmt, idx) in statements"
            :key="idx"
            class="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
            :class="stmt.severity === 'critical' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'"
          >
            <ShieldAlert v-if="stmt.severity === 'critical'" class="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <ShieldCheck v-else class="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <div class="min-w-0 flex-1">
              <div class="font-semibold">{{ t(stmt.description) }}</div>
              <div class="mt-0.5 font-mono text-[10px] opacity-70 truncate">{{ stmt.sql }}</div>
            </div>
          </div>
        </div>

        <!-- Production 环境：输入确认 -->
        <div v-if="needInput" class="mb-4">
          <p class="text-[11px] text-muted-foreground mb-2">
            {{ t('environment.dangerInputHint', { name: inputTarget }) }}
          </p>
          <Input
            :model-value="confirmInput"
            :placeholder="inputTarget"
            class="h-8 text-xs font-mono"
            @update:model-value="emit('update:confirmInput', $event as string)"
            @keydown.enter="emit('confirm')"
          />
        </div>

        <!-- 操作按钮 -->
        <div class="flex gap-2.5">
          <Button
            variant="outline"
            class="flex-1 h-9 rounded-xl text-[11px] font-bold text-foreground/60 border-border/40 hover:bg-muted"
            @click="emit('update:open', false)"
          >
            {{ t('common.cancel') }}
          </Button>
          <Button
            variant="destructive"
            class="flex-1 h-9 rounded-xl text-[11px] font-black shadow-lg shadow-destructive/20"
            :disabled="!canConfirm"
            @click="emit('confirm')"
          >
            {{ t('environment.dangerConfirmExecute') }}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
