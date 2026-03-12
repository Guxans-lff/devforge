<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { invoke } from '@tauri-apps/api/core'
import { useTheme } from '@/composables/useTheme'
import { useLocale } from '@/composables/useLocale'
import { useSettingsStore } from '@/stores/settings'
import { useConnectionStore } from '@/stores/connections'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Palette, Languages, Type, FolderOpen } from 'lucide-vue-next'
import { open } from '@tauri-apps/plugin-dialog'

const { t } = useI18n()
const { activeThemeId, themes, setColorTheme } = useTheme()
const { currentLocale, setLocale } = useLocale()
const settingsStore = useSettingsStore()
const connectionStore = useConnectionStore()
import { toast } from 'vue-sonner'

function handleThemeChange(value: string) {
  setColorTheme(value)
}

function handleLocaleChange(value: string) {
  setLocale(value as 'zh-CN' | 'en')
}

function handleUiFontSize(value: string) {
  settingsStore.update({ uiFontSize: Number(value) })
}

async function handleChoosePath() {
  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath: settingsStore.settings.dataStoragePath,
    title: t('settings.choosePath')
  })
  
  if (selected && typeof selected === 'string') {
    settingsStore.update({ dataStoragePath: selected })
    // 同步到后端 boot.json，并即时热重载
    try {
      await invoke('update_boot_config', { dataStoragePath: selected })
      // 成功后立即触发全局数据刷新
      await connectionStore.loadConnections()
      
      toast.success(t('settings.migrationSuccess'), {
        description: t('settings.dataReloadedSuccess') || '数据库已成功热重构，数据已即时更新',
        duration: 3000
      })
    } catch (e: any) {
      toast.error(t('settings.migrationFailed'), {
        description: e.toString()
      })
    }
  }
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

    <!-- Data Storage Path Card -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-all hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/5 text-blue-500/60 transition-colors group-hover:bg-blue-500/10 group-hover:text-blue-500">
          <FolderOpen class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <div class="flex items-center gap-2">
            <Label class="text-[15px] font-bold tracking-tight">{{ t('settings.dataStoragePath') }}</Label>
            <span class="px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-[9px] font-bold text-emerald-500 border border-emerald-500/20 uppercase tracking-tighter">Instant Effect</span>
          </div>
          <p class="text-xs text-muted-foreground/60 font-medium max-w-[400px]">
            {{ t('settings.dataStoragePathDesc') }}
            <span class="block mt-1 p-1 px-2 rounded bg-background/50 border border-white/5 font-mono text-[10px] text-primary/80 truncate">{{ settingsStore.settings.dataStoragePath }}</span>
          </p>
        </div>
      </div>
      <button 
        @click="handleChoosePath"
        class="flex items-center gap-2 px-4 h-10 rounded-xl bg-background border border-white/5 hover:bg-muted/30 hover:border-primary/30 transition-all font-bold text-xs"
      >
        <FolderOpen class="h-3.5 w-3.5" />
        {{ t('settings.choosePath') }}
      </button>
    </div>
  </div>
</template>
