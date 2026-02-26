<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import GeneralSettings from '@/components/settings/GeneralSettings.vue'
import EditorSettings from '@/components/settings/EditorSettings.vue'
import TerminalSettings from '@/components/settings/TerminalSettings.vue'
import ShortcutSettings from '@/components/settings/ShortcutSettings.vue'
import { RotateCcw, Settings, Code, Terminal, Keyboard } from 'lucide-vue-next'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const showResetConfirm = ref(false)

function handleReset() {
  showResetConfirm.value = true
}

function confirmReset() {
  settingsStore.reset()
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border px-6 py-3">
      <h1 class="text-lg font-semibold">{{ t('settings.title') }}</h1>
      <Button variant="ghost" size="sm" class="text-muted-foreground" @click="handleReset">
        <RotateCcw class="mr-1.5 h-3.5 w-3.5" />
        {{ t('settings.resetAll') }}
      </Button>
    </div>

    <!-- Content -->
    <ScrollArea class="min-h-0 flex-1">
      <div class="mx-auto max-w-2xl px-6 py-6">
        <Tabs default-value="general">
          <TabsList class="mb-6 w-full justify-start">
            <TabsTrigger value="general" class="gap-1.5">
              <Settings class="h-3.5 w-3.5" />
              {{ t('settings.general') }}
            </TabsTrigger>
            <TabsTrigger value="editor" class="gap-1.5">
              <Code class="h-3.5 w-3.5" />
              {{ t('settings.editor') }}
            </TabsTrigger>
            <TabsTrigger value="terminal" class="gap-1.5">
              <Terminal class="h-3.5 w-3.5" />
              {{ t('settings.terminalSettings') }}
            </TabsTrigger>
            <TabsTrigger value="shortcuts" class="gap-1.5">
              <Keyboard class="h-3.5 w-3.5" />
              {{ t('settings.shortcuts') }}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <GeneralSettings />
          </TabsContent>

          <TabsContent value="editor">
            <EditorSettings />
          </TabsContent>

          <TabsContent value="terminal">
            <TerminalSettings />
          </TabsContent>

          <TabsContent value="shortcuts">
            <ShortcutSettings />
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>

    <!-- Reset Confirmation -->
    <ConfirmDialog
      v-model:open="showResetConfirm"
      :title="t('settings.resetConfirm')"
      :confirm-label="t('settings.resetAll')"
      :cancel-label="t('common.cancel')"
      variant="destructive"
      @confirm="confirmReset"
    />
  </div>
</template>
