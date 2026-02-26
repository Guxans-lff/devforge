<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'

const { t } = useI18n()
const settingsStore = useSettingsStore()

function handleFontSize(value: string) {
  settingsStore.update({ editorFontSize: Number(value) })
}

function handleTabSize(value: string) {
  settingsStore.update({ editorTabSize: Number(value) })
}
</script>

<template>
  <div class="space-y-6">
    <!-- Font Size -->
    <div class="flex items-center justify-between">
      <div>
        <Label class="text-sm font-medium">{{ t('settings.editorFontSize') }}</Label>
        <p class="text-xs text-muted-foreground">{{ t('settings.editorFontSizeDesc') }}</p>
      </div>
      <Select :model-value="String(settingsStore.settings.editorFontSize)" @update:model-value="handleFontSize">
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

    <!-- Tab Size -->
    <div class="flex items-center justify-between">
      <div>
        <Label class="text-sm font-medium">{{ t('settings.editorTabSize') }}</Label>
        <p class="text-xs text-muted-foreground">{{ t('settings.editorTabSizeDesc') }}</p>
      </div>
      <Select :model-value="String(settingsStore.settings.editorTabSize)" @update:model-value="handleTabSize">
        <SelectTrigger class="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="size in [2, 4, 8]" :key="size" :value="String(size)">
            {{ size }} spaces
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <Separator />

    <!-- Word Wrap -->
    <div class="flex items-center justify-between">
      <div>
        <Label class="text-sm font-medium">{{ t('settings.editorWordWrap') }}</Label>
        <p class="text-xs text-muted-foreground">{{ t('settings.editorWordWrapDesc') }}</p>
      </div>
      <Switch
        :checked="settingsStore.settings.editorWordWrap"
        @update:checked="settingsStore.update({ editorWordWrap: $event })"
      />
    </div>

    <Separator />

    <!-- Minimap -->
    <div class="flex items-center justify-between">
      <div>
        <Label class="text-sm font-medium">{{ t('settings.editorMinimap') }}</Label>
        <p class="text-xs text-muted-foreground">{{ t('settings.editorMinimapDesc') }}</p>
      </div>
      <Switch
        :checked="settingsStore.settings.editorMinimap"
        @update:checked="settingsStore.update({ editorMinimap: $event })"
      />
    </div>
  </div>
</template>
