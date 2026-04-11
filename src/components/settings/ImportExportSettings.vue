<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { open, save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@/api/database'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useNotification } from '@/composables/useNotification'
import { useConnectionStore } from '@/stores/connections'
import * as importExportApi from '@/api/import-export'
import type { ConnectionExport, ImportPreview, ImportOptions } from '@/api/import-export'
import { Download, Upload, FileJson, AlertCircle, CheckCircle2 } from 'lucide-vue-next'

const { t } = useI18n()
const notification = useNotification()
const connectionStore = useConnectionStore()

const isExporting = ref(false)
const isImporting = ref(false)
const importPreview = ref<ImportPreview | null>(null)
const importData = ref<ConnectionExport | null>(null)
const conflictStrategy = ref<ImportOptions['conflictStrategy']>('skip')
const includePasswords = ref(true)

// 读写文件的辅助函数
// readTextFile / writeTextFile 已从 @/api/database 导入

async function handleExport() {
  try {
    isExporting.value = true

    // 导出所有连接
    const data = await importExportApi.exportConnections()

    // 选择保存位置
    const filePath = await save({
      defaultPath: `devforge-connections-${Date.now()}.json`,
      filters: [{
        name: 'JSON',
        extensions: ['json'],
      }],
    })

    if (!filePath) {
      isExporting.value = false
      return
    }

    // 写入文件
    await writeTextFile(filePath, JSON.stringify(data, null, 2))

    notification.success(
      t('importExport.exportSuccess'),
      t('importExport.exportSuccessDesc', { count: data.connections.length })
    )
  } catch (error: unknown) {
    notification.error(
      t('importExport.exportFailed'),
      error instanceof Error ? error.message : String(error)
    )
  } finally {
    isExporting.value = false
  }
}

async function handleSelectFile() {
  try {
    // 选择文件
    const selected = await open({
      multiple: false,
      filters: [{
        name: 'JSON',
        extensions: ['json'],
      }],
    })

    if (!selected) return

    // 读取文件
    const content = await readTextFile(selected as string)
    const data: ConnectionExport = JSON.parse(content)

    // 保存数据供后续导入使用
    importData.value = data

    // 预览导入
    const preview = await importExportApi.previewImport(data)
    importPreview.value = preview

    notification.info(
      t('importExport.previewReady'),
      t('importExport.previewReadyDesc', {
        total: preview.connections.length,
        new: preview.connections.length - preview.conflicts.length,
        existing: preview.conflicts.length,
      })
    )
  } catch (error: unknown) {
    notification.error(
      t('importExport.previewFailed'),
      error instanceof Error ? error.message : String(error)
    )
  }
}

async function handleImport() {
  if (!importPreview.value || !importData.value) return

  try {
    isImporting.value = true

    // 执行导入
    const result = await importExportApi.importConnections(importData.value, {
      conflictStrategy: conflictStrategy.value,
      importPasswords: includePasswords.value,
    })

    notification.success(
      t('importExport.importSuccess'),
      t('importExport.importSuccessDesc', {
        imported: result.imported,
        skipped: result.skipped,
      })
    )

    // 刷新侧边栏连接列表
    await connectionStore.loadConnections()

    // 清除预览和数据
    importPreview.value = null
    importData.value = null
  } catch (error: unknown) {
    notification.error(
      t('importExport.importFailed'),
      error instanceof Error ? error.message : String(error)
    )
  } finally {
    isImporting.value = false
  }
}

function clearPreview() {
  importPreview.value = null
  importData.value = null
  conflictStrategy.value = 'skip'
  includePasswords.value = false
}
</script>

<template>
  <div class="space-y-6">
    <!-- 导出部分 -->
    <div class="space-y-4">
      <div>
        <h3 class="text-base font-medium">{{ t('importExport.export') }}</h3>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('importExport.exportDesc') }}
        </p>
      </div>

      <Button
        :disabled="isExporting"
        @click="handleExport"
      >
        <Download v-if="!isExporting" class="mr-2 h-4 w-4" />
        <div v-else class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        {{ t('importExport.exportConnections') }}
      </Button>
    </div>

    <div class="border-t border-border" />

    <!-- 导入部分 -->
    <div class="space-y-4">
      <div>
        <h3 class="text-base font-medium">{{ t('importExport.import') }}</h3>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('importExport.importDesc') }}
        </p>
      </div>

      <!-- 选择文件 -->
      <Button
        variant="outline"
        :disabled="isImporting"
        @click="handleSelectFile"
      >
        <FileJson class="mr-2 h-4 w-4" />
        {{ t('importExport.selectFile') }}
      </Button>

      <!-- 预览信息 -->
      <div v-if="importPreview" class="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
        <div class="flex items-start gap-3">
          <CheckCircle2 class="h-5 w-5 shrink-0 text-df-success" />
          <div class="flex-1 space-y-2">
            <p class="text-sm font-medium">{{ t('importExport.previewTitle') }}</p>
            <div class="space-y-1 text-sm text-muted-foreground">
              <p>{{ t('importExport.totalConnections') }}: {{ importPreview.connections.length }}</p>
              <p>{{ t('importExport.newConnections') }}: {{ importPreview.connections.length - importPreview.conflicts.length }}</p>
              <p>{{ t('importExport.existingConnections') }}: {{ importPreview.conflicts.length }}</p>
            </div>
          </div>
        </div>

        <!-- 冲突策略 -->
        <div class="space-y-3">
          <Label>{{ t('importExport.conflictStrategy') }}</Label>
          <Select :model-value="conflictStrategy" @update:model-value="(v) => conflictStrategy = v as ImportOptions['conflictStrategy']">
            <SelectTrigger class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="skip">
                {{ t('importExport.strategySkip') }}
              </SelectItem>
              <SelectItem value="overwrite">
                {{ t('importExport.strategyOverwrite') }}
              </SelectItem>
              <SelectItem value="rename">
                {{ t('importExport.strategyRename') }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 密码选项 -->
        <div class="flex items-center justify-between">
          <Label for="passwords" class="font-normal">
            {{ t('importExport.importPasswords') }}
          </Label>
          <Switch id="passwords" v-model:checked="includePasswords" />
        </div>

        <!-- 警告 -->
        <div v-if="conflictStrategy === 'overwrite'" class="flex items-start gap-2 rounded-md bg-destructive/10 p-3">
          <AlertCircle class="h-4 w-4 shrink-0 text-destructive" />
          <p class="text-sm text-destructive">
            {{ t('importExport.overwriteWarning') }}
          </p>
        </div>

        <!-- 操作按钮 -->
        <div class="flex gap-2">
          <Button
            :disabled="isImporting"
            @click="handleImport"
          >
            <Upload v-if="!isImporting" class="mr-2 h-4 w-4" />
            <div v-else class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {{ t('importExport.startImport') }}
          </Button>
          <Button
            variant="outline"
            :disabled="isImporting"
            @click="clearPreview"
          >
            {{ t('common.cancel') }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
