<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Type, MousePointer2, Activity, Keyboard, ScrollText } from 'lucide-vue-next'

const { t } = useI18n()
const settingsStore = useSettingsStore()

const MONO_FONTS = [
  { name: 'Cascadia Code', value: "'Cascadia Code', Consolas, monospace" },
  { name: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
  { name: 'Fira Code', value: "'Fira Code', monospace" },
  { name: 'Source Code Pro', value: "'Source Code Pro', monospace" },
  { name: 'Roboto Mono', value: "'Roboto Mono', monospace" },
  { name: 'Consolas', value: "Consolas, monospace" },
  { name: 'Monaco', value: "Monaco, monospace" },
  { name: 'Menlo', value: "Menlo, monospace" },
]

const isCustomFont = computed(() => {
  return !MONO_FONTS.some(f => f.value === settingsStore.settings.terminalFontFamily)
})

const selectedFontValue = computed(() => {
  return isCustomFont.value ? 'custom' : settingsStore.settings.terminalFontFamily
})

function handleFontSize(value: string) {
  settingsStore.update({ terminalFontSize: Number(value) })
}

function handleFontFamilyChange(value: string) {
  if (value === 'custom') {
    // Keep current value but mark as custom
  } else {
    settingsStore.update({ terminalFontFamily: value })
  }
}

function handleCursorStyle(value: string) {
  settingsStore.update({ terminalCursorStyle: value as 'block' | 'underline' | 'bar' })
}
</script>

<template>
  <div class="grid gap-4">
    <!-- Font Size Card -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-all hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/5 text-orange-500/60 transition-colors group-hover:bg-orange-500/10 group-hover:text-orange-500">
          <Type class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <Label class="text-[15px] font-bold tracking-tight">{{ t('settings.terminalFontSize') }}</Label>
          <p class="text-xs text-muted-foreground/60 font-medium">{{ t('settings.terminalFontSizeDesc') }}</p>
        </div>
      </div>
      <Select :model-value="String(settingsStore.settings.terminalFontSize)" @update:model-value="handleFontSize($event as string)">
        <SelectTrigger class="w-40 h-10 rounded-xl bg-background shadow-sm border-white/5 font-bold text-xs transition-all focus:ring-primary/20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent class="backdrop-blur-xl bg-background/80 border-border/20 rounded-xl">
          <SelectItem v-for="size in [12, 13, 14, 15, 16, 18, 20, 22, 24]" :key="size" :value="String(size)" class="rounded-lg font-bold">
            {{ size }}px
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Font Family Card -->
    <div class="group flex flex-col gap-4 p-5 bg-muted/10 border border-border/10 rounded-2xl transition-all hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-center justify-between">
        <div class="flex items-start gap-4 flex-1 min-w-0">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/5 text-blue-500/60 transition-colors group-hover:bg-blue-500/10 group-hover:text-blue-500 shrink-0">
            <Keyboard class="h-5 w-5" />
          </div>
          <div class="space-y-0.5 min-w-0">
            <Label class="text-[15px] font-bold tracking-tight">{{ t('settings.terminalFontFamily') }}</Label>
            <p class="text-xs text-muted-foreground/60 font-medium truncate">{{ t('settings.terminalFontFamilyDesc') }}</p>
          </div>
        </div>
        <Select :model-value="selectedFontValue" @update:model-value="handleFontFamilyChange($event as string)">
          <SelectTrigger class="w-48 h-10 rounded-xl bg-background shadow-sm border-white/5 font-bold text-xs transition-all focus:ring-primary/20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent class="backdrop-blur-xl bg-background/80 border-border/20 rounded-xl">
            <SelectItem v-for="font in MONO_FONTS" :key="font.value" :value="font.value" class="rounded-lg">
              <span :style="{ fontFamily: font.value }" class="font-medium">{{ font.name }}</span>
            </SelectItem>
            <SelectItem value="custom" class="rounded-lg font-medium text-muted-foreground">{{ t('settings.customFont') || 'Custom...' }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <!-- Custom Font Input Area -->
      <div v-if="isCustomFont || selectedFontValue === 'custom'" class="animate-in fade-in slide-in-from-top-2 duration-300">
        <Input
          :model-value="settingsStore.settings.terminalFontFamily"
          class="w-full h-10 rounded-xl bg-background/50 shadow-inner border-white/5 font-mono text-[11px] font-bold transition-all focus:ring-primary/20"
          :placeholder="'Enter font family string...'"
          @update:model-value="settingsStore.update({ terminalFontFamily: String($event) })"
        />
      </div>
    </div>

    <!-- Cursor Style Card -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-all hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/5 text-cyan-500/60 transition-colors group-hover:bg-cyan-500/10 group-hover:text-cyan-500">
          <MousePointer2 class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <Label class="text-[15px] font-bold tracking-tight">{{ t('settings.terminalCursorStyle') }}</Label>
          <p class="text-xs text-muted-foreground/60 font-medium">{{ t('settings.terminalCursorStyleDesc') }}</p>
        </div>
      </div>
      <Select :model-value="settingsStore.settings.terminalCursorStyle" @update:model-value="handleCursorStyle($event as string)">
        <SelectTrigger class="w-40 h-10 rounded-xl bg-background shadow-sm border-white/5 font-bold text-xs transition-all focus:ring-primary/20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent class="backdrop-blur-xl bg-background/80 border-border/20 rounded-xl">
          <SelectItem value="block" class="rounded-lg font-medium">{{ t('settings.cursorBlock') }}</SelectItem>
          <SelectItem value="underline" class="rounded-lg font-medium">{{ t('settings.cursorUnderline') }}</SelectItem>
          <SelectItem value="bar" class="rounded-lg font-medium">{{ t('settings.cursorBar') }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Cursor Blink Card -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-all hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/5 text-red-500/60 transition-colors group-hover:bg-red-500/10 group-hover:text-red-500">
          <Activity class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <Label class="text-[15px] font-bold tracking-tight">{{ t('settings.terminalCursorBlink') }}</Label>
          <p class="text-xs text-muted-foreground/60 font-medium">{{ t('settings.terminalCursorBlinkDesc') }}</p>
        </div>
      </div>
      <Switch
        :checked="settingsStore.settings.terminalCursorBlink"
        @update:checked="settingsStore.update({ terminalCursorBlink: $event })"
        class="scale-90"
      />
    </div>

    <!-- Scrollback Lines Card -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-all hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/5 text-emerald-500/60 transition-colors group-hover:bg-emerald-500/10 group-hover:text-emerald-500">
          <ScrollText class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <Label class="text-[15px] font-bold tracking-tight">{{ t('settings.terminalScrollback' as any) || '滚动缓冲区' }}</Label>
          <p class="text-xs text-muted-foreground/60 font-medium">{{ t('settings.terminalScrollbackDesc' as any) || '终端可回滚查看的历史行数' }}</p>
        </div>
      </div>
      <Select :model-value="String(settingsStore.settings.terminalScrollback ?? 5000)" @update:model-value="settingsStore.update({ terminalScrollback: Number($event) })">
        <SelectTrigger class="w-40 h-10 rounded-xl bg-background shadow-sm border-white/5 font-bold text-xs transition-all focus:ring-primary/20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent class="backdrop-blur-xl bg-background/80 border-border/20 rounded-xl">
          <SelectItem v-for="lines in [1000, 3000, 5000, 10000, 50000]" :key="lines" :value="String(lines)" class="rounded-lg font-bold">
            {{ lines.toLocaleString() }} 行
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  </div>
</template>
