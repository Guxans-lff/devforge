<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useTheme } from '@/composables/useTheme'
import { useLocale } from '@/composables/useLocale'
import { useSettingsStore } from '@/stores/settings'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'

const { t } = useI18n()
const { activeThemeId, themes, setColorTheme } = useTheme()
const { currentLocale, setLocale } = useLocale()
const settingsStore = useSettingsStore()

function handleThemeChange(value: string) {
  setColorTheme(value)
}

function handleLocaleChange(value: string) {
  setLocale(value as 'zh-CN' | 'en')
}

function handleUiFontSize(value: string) {
  settingsStore.update({ uiFontSize: Number(value) })
}
</script>

<template>
  <div class="space-y-6">
    <!-- Theme -->
    <div class="flex items-center justify-between">
      <div>
        <Label class="text-sm font-medium">{{ t('settings.theme') }}</Label>
        <p class="text-xs text-muted-foreground">{{ t('settings.themeDesc') }}</p>
      </div>
      <Select :model-value="activeThemeId" @update:model-value="handleThemeChange">
        <SelectTrigger class="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="theme in themes" :key="theme.id" :value="theme.id">
            <div class="flex items-center gap-2">
              <div
                class="h-3 w-3 rounded-full border border-border"
                :style="{ backgroundColor: theme.terminal.background }"
              />
              {{ theme.name }}
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <Separator />

    <!-- Language -->
    <div class="flex items-center justify-between">
      <div>
        <Label class="text-sm font-medium">{{ t('settings.language') }}</Label>
        <p class="text-xs text-muted-foreground">{{ t('settings.languageDesc') }}</p>
      </div>
      <Select :model-value="currentLocale" @update:model-value="handleLocaleChange">
        <SelectTrigger class="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="zh-CN">{{ t('language.zhCN') }}</SelectItem>
          <SelectItem value="en">{{ t('language.en') }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <Separator />

    <!-- UI Font Size -->
    <div class="flex items-center justify-between">
      <div>
        <Label class="text-sm font-medium">{{ t('settings.uiFontSize') }}</Label>
        <p class="text-xs text-muted-foreground">{{ t('settings.uiFontSizeDesc') }}</p>
      </div>
      <Select :model-value="String(settingsStore.settings.uiFontSize)" @update:model-value="handleUiFontSize">
        <SelectTrigger class="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="size in [12, 13, 14, 15, 16, 18]" :key="size" :value="String(size)">
            {{ size }}px
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  </div>
</template>
