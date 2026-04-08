<script setup lang="ts">
import { computed } from 'vue'
import { parseBackendError } from '@/types/error'
import { useI18n } from 'vue-i18n'
import { updateBootConfig } from '@/api/system'
import { useTheme } from '@/composables/useTheme'
import { useLocale } from '@/composables/useLocale'
import { useSettingsStore, type ThemeScheduleMode } from '@/stores/settings'
import { useConnectionStore } from '@/stores/connections'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Palette, Languages, Type, FolderOpen, Sun, Moon, Clock } from 'lucide-vue-next'
import { open } from '@tauri-apps/plugin-dialog'
import { toast } from 'vue-sonner'

const { t } = useI18n()
const { activeThemeId, themes, setColorTheme } = useTheme()
const { currentLocale, setLocale } = useLocale()
const settingsStore = useSettingsStore()
const connectionStore = useConnectionStore()

const scheduleMode = computed(() => settingsStore.settings.themeScheduleMode)
const isManual = computed(() => scheduleMode.value === 'manual')
const isSchedule = computed(() => scheduleMode.value === 'schedule')

// 按类型分组主题列表
const lightThemes = computed(() => themes.filter(t => t.type === 'light'))
const darkThemes = computed(() => themes.filter(t => t.type === 'dark'))

function handleThemeChange(value: string) {
  setColorTheme(value)
}

function handleScheduleModeChange(value: string) {
  settingsStore.update({ themeScheduleMode: value as ThemeScheduleMode })
}

function handleThemeLightChange(value: string) {
  settingsStore.update({ themeLightId: value })
}

function handleThemeDarkChange(value: string) {
  settingsStore.update({ themeDarkId: value })
}

function handleScheduleLightChange(e: Event) {
  const val = (e.target as HTMLInputElement).value
  if (val) settingsStore.update({ scheduleLight: val })
}

function handleScheduleDarkChange(e: Event) {
  const val = (e.target as HTMLInputElement).value
  if (val) settingsStore.update({ scheduleDark: val })
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
    try {
      await updateBootConfig(selected)
      await connectionStore.loadConnections()

      toast.success(t('settings.migrationSuccess'), {
        description: t('settings.dataReloadedSuccess') || '数据库已成功热重构，数据已即时更新',
        duration: 3000
      })
    } catch (e: unknown) {
      toast.error(t('settings.migrationFailed'), {
        description: parseBackendError(e).message
      })
    }
  }
}
</script>

<template>
  <div class="grid gap-4">
    <!-- Theme Card -->
    <div class="group p-5 bg-muted/10 border border-border/10 rounded-2xl transition-[background-color,border-color] hover:bg-muted/20 hover:border-border/30">
      <!-- 第一行：标题 + 调度模式选择 -->
      <div class="flex items-center justify-between">
        <div class="flex items-start gap-4">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/5 text-primary/50 transition-colors group-hover:bg-primary/10 group-hover:text-primary/80">
            <Palette class="h-5 w-5" />
          </div>
          <div class="space-y-0.5">
            <Label class="text-[15px] font-bold tracking-tight">{{ t('settings.theme') }}</Label>
            <p class="text-xs text-muted-foreground/60 font-medium">{{ t('settings.themeDesc') }}</p>
          </div>
        </div>
        <Select :model-value="scheduleMode" @update:model-value="handleScheduleModeChange($event as string)">
          <SelectTrigger class="w-48 h-10 rounded-xl bg-background shadow-sm border-border/50 font-bold text-xs ring-offset-background transition-[border-color,box-shadow] focus:ring-primary/20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent class="bg-popover border-border/20 rounded-xl">
            <SelectItem value="manual" class="rounded-lg font-medium">{{ t('settings.themeManual') }}</SelectItem>
            <SelectItem value="system" class="rounded-lg font-medium">{{ t('settings.themeSystem') }}</SelectItem>
            <SelectItem value="schedule" class="rounded-lg font-medium">{{ t('settings.themeSchedule') }}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- 手动模式：直接选主题 -->
      <div v-if="isManual" class="mt-4 pl-14">
        <Select :model-value="activeThemeId" @update:model-value="handleThemeChange($event as string)">
          <SelectTrigger class="w-full h-10 rounded-xl bg-background shadow-sm border-border/50 font-bold text-xs transition-[border-color,box-shadow] focus:ring-primary/20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent class="bg-popover border-border/20 rounded-xl">
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

      <!-- 跟随系统 / 定时切换 模式：白天+夜间主题选择 -->
      <div v-if="!isManual" class="mt-4 pl-14 space-y-3">
        <!-- 白天主题 -->
        <div class="flex items-center gap-3">
          <Sun class="h-4 w-4 text-df-warning shrink-0" />
          <Label class="text-xs font-medium text-muted-foreground w-16 shrink-0">{{ t('settings.themeDay') }}</Label>
          <Select :model-value="settingsStore.settings.themeLightId" @update:model-value="handleThemeLightChange($event as string)">
            <SelectTrigger class="flex-1 h-9 rounded-xl bg-background shadow-sm border-border/50 font-bold text-xs transition-[border-color,box-shadow] focus:ring-primary/20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent class="bg-popover border-border/20 rounded-xl">
              <SelectItem v-for="theme in lightThemes" :key="theme.id" :value="theme.id" class="rounded-lg">
                <div class="flex items-center gap-2.5">
                  <div class="h-3 w-3 rounded-full border border-border/50" :style="{ backgroundColor: theme.terminal.background }" />
                  <span class="font-medium">{{ theme.name }}</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          <!-- 定时模式：白天开始时间 -->
          <input
            v-if="isSchedule"
            type="time"
            :value="settingsStore.settings.scheduleLight"
            @change="handleScheduleLightChange"
            class="h-9 w-28 rounded-xl bg-background shadow-sm border border-border/50 px-3 text-xs font-bold text-foreground transition-[border-color,box-shadow] focus:ring-1 focus:ring-primary/20 focus:outline-none"
          />
        </div>
        <!-- 夜间主题 -->
        <div class="flex items-center gap-3">
          <Moon class="h-4 w-4 text-df-info shrink-0" />
          <Label class="text-xs font-medium text-muted-foreground w-16 shrink-0">{{ t('settings.themeNight') }}</Label>
          <Select :model-value="settingsStore.settings.themeDarkId" @update:model-value="handleThemeDarkChange($event as string)">
            <SelectTrigger class="flex-1 h-9 rounded-xl bg-background shadow-sm border-border/50 font-bold text-xs transition-[border-color,box-shadow] focus:ring-primary/20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent class="bg-popover border-border/20 rounded-xl">
              <SelectItem v-for="theme in darkThemes" :key="theme.id" :value="theme.id" class="rounded-lg">
                <div class="flex items-center gap-2.5">
                  <div class="h-3 w-3 rounded-full border border-border/50" :style="{ backgroundColor: theme.terminal.background }" />
                  <span class="font-medium">{{ theme.name }}</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          <!-- 定时模式：夜间开始时间 -->
          <input
            v-if="isSchedule"
            type="time"
            :value="settingsStore.settings.scheduleDark"
            @change="handleScheduleDarkChange"
            class="h-9 w-28 rounded-xl bg-background shadow-sm border border-border/50 px-3 text-xs font-bold text-foreground transition-[border-color,box-shadow] focus:ring-1 focus:ring-primary/20 focus:outline-none"
          />
        </div>
        <!-- 定时模式提示 -->
        <p v-if="isSchedule" class="text-[11px] text-muted-foreground/50 flex items-center gap-1.5">
          <Clock class="h-3 w-3" />
          {{ t('settings.themeScheduleHint') }}
        </p>
      </div>
    </div>

    <!-- Language Card -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-[background-color,border-color] hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/5 text-primary/50 transition-colors group-hover:bg-primary/10 group-hover:text-primary/80">
          <Languages class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <Label class="text-[15px] font-bold tracking-tight">{{ t('settings.language') }}</Label>
          <p class="text-xs text-muted-foreground/60 font-medium">{{ t('settings.languageDesc') }}</p>
        </div>
      </div>
      <Select :model-value="currentLocale" @update:model-value="handleLocaleChange($event as string)">
        <SelectTrigger class="w-48 h-10 rounded-xl bg-background shadow-sm border-border/50 font-bold text-xs transition-[border-color,box-shadow] focus:ring-primary/20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent class="bg-popover border-border/20 rounded-xl">
          <SelectItem value="zh-CN" class="rounded-lg font-medium">{{ t('language.zhCN') }}</SelectItem>
          <SelectItem value="en" class="rounded-lg font-medium">{{ t('language.en') }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- UI Font Size Card -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-[background-color,border-color] hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/5 text-primary/50 transition-colors group-hover:bg-primary/10 group-hover:text-primary/80">
          <Type class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <Label class="text-[15px] font-bold tracking-tight">{{ t('settings.uiFontSize') }}</Label>
          <p class="text-xs text-muted-foreground/60 font-medium">{{ t('settings.uiFontSizeDesc') }}</p>
        </div>
      </div>
      <Select :model-value="String(settingsStore.settings.uiFontSize)" @update:model-value="handleUiFontSize($event as string)">
        <SelectTrigger class="w-48 h-10 rounded-xl bg-background shadow-sm border-border/50 font-bold text-xs transition-[border-color,box-shadow] focus:ring-primary/20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent class="bg-popover border-border/20 rounded-xl">
          <SelectItem v-for="size in [12, 13, 14, 15, 16, 18]" :key="size" :value="String(size)" class="rounded-lg font-bold">
            {{ size }}px
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Data Storage Path Card -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-[background-color,border-color] hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/5 text-primary/50 transition-colors group-hover:bg-primary/10 group-hover:text-primary/80">
          <FolderOpen class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <div class="flex items-center gap-2">
            <Label class="text-[15px] font-bold tracking-tight">{{ t('settings.dataStoragePath') }}</Label>
            <span class="px-1.5 py-0.5 rounded-md bg-df-success/10 text-[9px] font-bold text-df-success border border-df-success/20 uppercase tracking-tighter">Instant Effect</span>
          </div>
          <p class="text-xs text-muted-foreground/60 font-medium max-w-[400px]">
            {{ t('settings.dataStoragePathDesc') }}
            <span class="block mt-1 p-1 px-2 rounded bg-background/50 border border-border/50 font-mono text-[10px] text-primary/80 truncate">{{ settingsStore.settings.dataStoragePath }}</span>
          </p>
        </div>
      </div>
      <button
        @click="handleChoosePath"
        :aria-label="t('settings.choosePath')"
        class="flex items-center gap-2 px-4 h-10 rounded-xl bg-background border border-border/50 hover:bg-muted/30 hover:border-primary/30 transition-[background-color,border-color] font-bold text-xs focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
      >
        <FolderOpen class="h-3.5 w-3.5" />
        {{ t('settings.choosePath') }}
      </button>
    </div>
  </div>
</template>
