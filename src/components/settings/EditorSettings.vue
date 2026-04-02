<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Type, PanelLeft, WrapText, Layout } from 'lucide-vue-next'

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
  <div class="grid gap-4">
    <!-- Font Size Card -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-[background-color,border-color] hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/5 text-primary/50 transition-colors group-hover:bg-primary/10 group-hover:text-primary/80">
          <Type class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <Label class="text-[15px] font-bold tracking-tight">{{ t('settings.editorFontSize') }}</Label>
          <p class="text-xs text-muted-foreground/60 font-medium">{{ t('settings.editorFontSizeDesc') }}</p>
        </div>
      </div>
      <Select :model-value="String(settingsStore.settings.editorFontSize)" @update:model-value="handleFontSize($event as string)">
        <SelectTrigger class="w-40 h-10 rounded-xl bg-background shadow-sm border-border/50 font-bold text-xs transition-[border-color,box-shadow] focus:ring-primary/20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent class="bg-popover border-border/20 rounded-xl">
          <SelectItem v-for="size in [12, 13, 14, 15, 16, 18, 20, 22, 24]" :key="size" :value="String(size)" class="rounded-lg font-bold">
            {{ size }}px
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Tab Size Card -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-[background-color,border-color] hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/5 text-primary/50 transition-colors group-hover:bg-primary/10 group-hover:text-primary/80">
          <PanelLeft class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <Label class="text-[15px] font-bold tracking-tight">{{ t('settings.editorTabSize') }}</Label>
          <p class="text-xs text-muted-foreground/60 font-medium">{{ t('settings.editorTabSizeDesc') }}</p>
        </div>
      </div>
      <Select :model-value="String(settingsStore.settings.editorTabSize)" @update:model-value="handleTabSize($event as string)">
        <SelectTrigger class="w-40 h-10 rounded-xl bg-background shadow-sm border-border/50 font-bold text-xs transition-[border-color,box-shadow] focus:ring-primary/20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent class="bg-popover border-border/20 rounded-xl">
          <SelectItem v-for="size in [2, 4, 8]" :key="size" :value="String(size)" class="rounded-lg font-bold">
            {{ size }} {{ size === 1 ? 'space' : 'spaces' }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Word Wrap Card -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-[background-color,border-color] hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/5 text-primary/50 transition-colors group-hover:bg-primary/10 group-hover:text-primary/80">
          <WrapText class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <Label class="text-[15px] font-bold tracking-tight">{{ t('settings.editorWordWrap') }}</Label>
          <p class="text-xs text-muted-foreground/60 font-medium">{{ t('settings.editorWordWrapDesc') }}</p>
        </div>
      </div>
      <Switch
        :checked="settingsStore.settings.editorWordWrap"
        @update:checked="settingsStore.update({ editorWordWrap: $event })"
        class="scale-90"
      />
    </div>

    <!-- Minimap Card -->
    <div class="group flex items-center justify-between p-5 bg-muted/10 border border-border/10 rounded-2xl transition-[background-color,border-color] hover:bg-muted/20 hover:border-border/30">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/5 text-primary/50 transition-colors group-hover:bg-primary/10 group-hover:text-primary/80">
          <Layout class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <Label class="text-[15px] font-bold tracking-tight">{{ t('settings.editorMinimap') }}</Label>
          <p class="text-xs text-muted-foreground/60 font-medium">{{ t('settings.editorMinimapDesc') }}</p>
        </div>
      </div>
      <Switch
        :checked="settingsStore.settings.editorMinimap"
        @update:checked="settingsStore.update({ editorMinimap: $event })"
        class="scale-90"
      />
    </div>
  </div>
</template>
