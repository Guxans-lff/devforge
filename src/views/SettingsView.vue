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
import ImportExportSettings from '@/components/settings/ImportExportSettings.vue'
import DiagnosticsSection from '@/components/settings/DiagnosticsSection.vue'
import UpdateSection from '@/components/settings/UpdateSection.vue'
import { RotateCcw, Settings } from 'lucide-vue-next'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const showResetConfirm = ref(false)

const tabTriggerClass = 'rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-[background-color,color,box-shadow] data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md'

function handleReset() {
  showResetConfirm.value = true
}

function confirmReset() {
  settingsStore.reset()
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-background">
    <!-- Premium Header -->
    <header role="banner" class="relative z-10 flex items-center justify-between border-b border-border/50 bg-background/50 px-8 py-5 backdrop-blur-md">
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
          <Settings class="h-5 w-5" />
        </div>
        <div>
          <h1 class="text-xl font-black tracking-tight text-foreground">
            {{ t('settings.title') }}
          </h1>
          <p class="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-widest">{{ t('common.preferences') || 'Preferences' }}</p>
        </div>
      </div>
      
      <Button
        variant="outline"
        size="sm"
        :aria-label="t('settings.resetAll')"
        class="h-9 gap-2 rounded-xl border-border/50 bg-background/50 px-4 text-xs font-bold transition-[background-color,color,border-color] hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
        @click="handleReset"
      >
        <RotateCcw class="h-3.5 w-3.5" />
        {{ t('settings.resetAll') }}
      </Button>
    </header>

    <!-- Content -->
    <ScrollArea class="min-h-0 flex-1">
      <div class="mx-auto max-w-3xl px-8 py-10">
        <Tabs default-value="general" class="w-full">
          <!-- Tab 导航 -->
          <div class="mb-10 flex justify-center">
            <TabsList :aria-label="t('settings.settingsCategories')" class="h-10 bg-muted/30 p-1 rounded-xl border border-border/10 backdrop-blur-sm inline-flex gap-0.5">
              <TabsTrigger value="general" :class="tabTriggerClass">
                {{ t('settings.general') }}
              </TabsTrigger>
              <TabsTrigger value="editor" :class="tabTriggerClass">
                {{ t('settings.editor') }}
              </TabsTrigger>
              <TabsTrigger value="terminal" :class="tabTriggerClass">
                {{ t('settings.terminalSettings') }}
              </TabsTrigger>
              <TabsTrigger value="shortcuts" :class="tabTriggerClass">
                {{ t('settings.shortcuts') }}
              </TabsTrigger>
              <TabsTrigger value="import-export" :class="tabTriggerClass">
                {{ t('settings.importExport') }}
              </TabsTrigger>
              <TabsTrigger value="diagnostics" :class="tabTriggerClass">
                {{ t('settings.diagnostics') }}
              </TabsTrigger>
              <TabsTrigger value="update" :class="tabTriggerClass">
                {{ t('updater.tabTitle') }}
              </TabsTrigger>
            </TabsList>
          </div>

          <!-- Animated Content Sections -->
          <div class="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both">
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

            <TabsContent value="import-export">
              <ImportExportSettings />
            </TabsContent>

            <TabsContent value="diagnostics">
              <DiagnosticsSection />
            </TabsContent>

            <TabsContent value="update">
              <UpdateSection />
            </TabsContent>
          </div>
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
