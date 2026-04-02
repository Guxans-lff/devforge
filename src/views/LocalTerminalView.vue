<script setup lang="ts">
/**
 * 本地终端视图 — 简洁的本地 Shell 终端
 */
import { useI18n } from 'vue-i18n'
import LocalTerminalPanel from '@/components/terminal/LocalTerminalPanel.vue'

const { t } = useI18n()

const props = defineProps<{
  sessionId: string
}>()
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-background">
    <!-- 工具栏 -->
    <div class="flex h-8 items-center border-b border-border px-3 shrink-0">
      <span class="text-[11px] font-medium text-muted-foreground">{{ t('localTerminal.title') }}</span>
    </div>

    <!-- 终端面板 -->
    <div class="flex-1 min-h-0">
      <LocalTerminalPanel
        :session-id="sessionId"
      />
    </div>
  </div>
</template>
