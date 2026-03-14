<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Bug } from 'lucide-vue-next'

const { t } = useI18n()
const settingsStore = useSettingsStore()

function handleDevModeToggle(value: boolean) {
  settingsStore.update({ devMode: value })
}
</script>

<template>
  <div class="grid gap-4">
    <!-- 开发者模式开关 -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-all hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/5 text-orange-500/60 transition-colors group-hover:bg-orange-500/10 group-hover:text-orange-500">
          <Bug class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <Label class="text-[15px] font-bold tracking-tight">{{ t('settings.devMode') }}</Label>
          <p class="text-xs text-muted-foreground/60 font-medium">{{ t('settings.devModeDesc') }}</p>
        </div>
      </div>
      <Switch
        :checked="settingsStore.settings.devMode"
        @update:checked="handleDevModeToggle"
      />
    </div>
  </div>
</template>
