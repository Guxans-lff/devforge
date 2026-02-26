<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'

const { t } = useI18n()
const settingsStore = useSettingsStore()

function handleFontSize(value: string) {
  settingsStore.update({ terminalFontSize: Number(value) })
}

function handleCursorStyle(value: string) {
  settingsStore.update({ terminalCursorStyle: value as 'block' | 'underline' | 'bar' })
}
</script>

<template>
  <div class="space-y-6">
    <!-- Font Size -->
    <div class="flex items-center justify-between">
      <div>
        <Label class="text-sm font-medium">{{ t('settings.terminalFontSize') }}</Label>
        <p class="text-xs text-muted-foreground">{{ t('settings.terminalFontSizeDesc') }}</p>
      </div>
      <Select :model-value="String(settingsStore.settings.terminalFontSize)" @update:model-value="handleFontSize">
        <SelectTrigger class="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="size in [12, 13, 14, 15, 16, 18, 20, 22, 24]" :key="size" :value="String(size)">
            {{ size }}px
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <Separator />

    <!-- Font Family -->
    <div class="flex items-center justify-between gap-4">
      <div class="shrink-0">
        <Label class="text-sm font-medium">{{ t('settings.terminalFontFamily') }}</Label>
        <p class="text-xs text-muted-foreground">{{ t('settings.terminalFontFamilyDesc') }}</p>
      </div>
      <Input
        :model-value="settingsStore.settings.terminalFontFamily"
        class="max-w-64 text-xs font-mono"
        @update:model-value="settingsStore.update({ terminalFontFamily: String($event) })"
      />
    </div>

    <Separator />

    <!-- Cursor Style -->
    <div class="flex items-center justify-between">
      <div>
        <Label class="text-sm font-medium">{{ t('settings.terminalCursorStyle') }}</Label>
        <p class="text-xs text-muted-foreground">{{ t('settings.terminalCursorStyleDesc') }}</p>
      </div>
      <Select :model-value="settingsStore.settings.terminalCursorStyle" @update:model-value="handleCursorStyle">
        <SelectTrigger class="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="block">{{ t('settings.cursorBlock') }}</SelectItem>
          <SelectItem value="underline">{{ t('settings.cursorUnderline') }}</SelectItem>
          <SelectItem value="bar">{{ t('settings.cursorBar') }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <Separator />

    <!-- Cursor Blink -->
    <div class="flex items-center justify-between">
      <div>
        <Label class="text-sm font-medium">{{ t('settings.terminalCursorBlink') }}</Label>
        <p class="text-xs text-muted-foreground">{{ t('settings.terminalCursorBlinkDesc') }}</p>
      </div>
      <Switch
        :checked="settingsStore.settings.terminalCursorBlink"
        @update:checked="settingsStore.update({ terminalCursorBlink: $event })"
      />
    </div>
  </div>
</template>
