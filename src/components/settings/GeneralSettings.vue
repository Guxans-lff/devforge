<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useTheme } from '@/composables/useTheme'
import { useLocale } from '@/composables/useLocale'
import { useSettingsStore } from '@/stores/settings'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Palette, Languages, Type } from 'lucide-vue-next'

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
  <div class="grid gap-4">
    <!-- Theme Card -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-all hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/5 text-primary/60 transition-colors group-hover:bg-primary/10 group-hover:text-primary">
          <Palette class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <Label class="text-[15px] font-bold tracking-tight">{{ t('settings.theme') }}</Label>
          <p class="text-xs text-muted-foreground/60 font-medium">{{ t('settings.themeDesc') }}</p>
        </div>
      </div>
      <Select :model-value="activeThemeId" @update:model-value="handleThemeChange($event as string)">
        <SelectTrigger class="w-48 h-10 rounded-xl bg-background shadow-sm border-white/5 font-bold text-xs ring-offset-background transition-all focus:ring-primary/20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent class="backdrop-blur-xl bg-background/80 border-border/20 rounded-xl">
          <SelectItem v-for="theme in themes" :key="theme.id" :value="theme.id" class="rounded-lg">
            <div class="flex items-center gap-2.5">
              <div
                class="h-3 w-3 rounded-full border border-border/50"
                :style="{ backgroundColor: theme.terminal.background }"
              />
              <span class="font-medium">{{ theme.name }}</span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Language Card -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-all hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/5 text-amber-500/60 transition-colors group-hover:bg-amber-500/10 group-hover:text-amber-500">
          <Languages class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <Label class="text-[15px] font-bold tracking-tight">{{ t('settings.language') }}</Label>
          <p class="text-xs text-muted-foreground/60 font-medium">{{ t('settings.languageDesc') }}</p>
        </div>
      </div>
      <Select :model-value="currentLocale" @update:model-value="handleLocaleChange($event as string)">
        <SelectTrigger class="w-48 h-10 rounded-xl bg-background shadow-sm border-white/5 font-bold text-xs transition-all focus:ring-primary/20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent class="backdrop-blur-xl bg-background/80 border-border/20 rounded-xl">
          <SelectItem value="zh-CN" class="rounded-lg font-medium">{{ t('language.zhCN') }}</SelectItem>
          <SelectItem value="en" class="rounded-lg font-medium">{{ t('language.en') }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- UI Font Size Card -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-all hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/5 text-emerald-500/60 transition-colors group-hover:bg-emerald-500/10 group-hover:text-emerald-500">
          <Type class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <Label class="text-[15px] font-bold tracking-tight">{{ t('settings.uiFontSize') }}</Label>
          <p class="text-xs text-muted-foreground/60 font-medium">{{ t('settings.uiFontSizeDesc') }}</p>
        </div>
      </div>
      <Select :model-value="String(settingsStore.settings.uiFontSize)" @update:model-value="handleUiFontSize($event as string)">
        <SelectTrigger class="w-48 h-10 rounded-xl bg-background shadow-sm border-white/5 font-bold text-xs transition-all focus:ring-primary/20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent class="backdrop-blur-xl bg-background/80 border-border/20 rounded-xl">
          <SelectItem v-for="size in [12, 13, 14, 15, 16, 18]" :key="size" :value="String(size)" class="rounded-lg font-bold">
            {{ size }}px
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  </div>
</template>
