<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-vue-next'

const props = defineProps<{
  open: boolean
  fileName: string
  currentPermissions: number | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: [mode: number]
}>()

const { t } = useI18n()
const saving = ref(false)

// 权限位
const ownerRead = ref(false)
const ownerWrite = ref(false)
const ownerExec = ref(false)
const groupRead = ref(false)
const groupWrite = ref(false)
const groupExec = ref(false)
const otherRead = ref(false)
const otherWrite = ref(false)
const otherExec = ref(false)

const octalInput = ref('644')

// 从复选框计算八进制值
const computedOctal = computed(() => {
  let mode = 0
  if (ownerRead.value) mode |= 0o400
  if (ownerWrite.value) mode |= 0o200
  if (ownerExec.value) mode |= 0o100
  if (groupRead.value) mode |= 0o040
  if (groupWrite.value) mode |= 0o020
  if (groupExec.value) mode |= 0o010
  if (otherRead.value) mode |= 0o004
  if (otherWrite.value) mode |= 0o002
  if (otherExec.value) mode |= 0o001
  return mode
})

// 权限字符串预览
const permissionString = computed(() => {
  const m = computedOctal.value
  let s = ''
  s += (m & 0o400) ? 'r' : '-'
  s += (m & 0o200) ? 'w' : '-'
  s += (m & 0o100) ? 'x' : '-'
  s += (m & 0o040) ? 'r' : '-'
  s += (m & 0o020) ? 'w' : '-'
  s += (m & 0o010) ? 'x' : '-'
  s += (m & 0o004) ? 'r' : '-'
  s += (m & 0o002) ? 'w' : '-'
  s += (m & 0o001) ? 'x' : '-'
  return s
})

function setFromOctal(mode: number) {
  ownerRead.value = !!(mode & 0o400)
  ownerWrite.value = !!(mode & 0o200)
  ownerExec.value = !!(mode & 0o100)
  groupRead.value = !!(mode & 0o040)
  groupWrite.value = !!(mode & 0o020)
  groupExec.value = !!(mode & 0o010)
  otherRead.value = !!(mode & 0o004)
  otherWrite.value = !!(mode & 0o002)
  otherExec.value = !!(mode & 0o001)
}

// 复选框变化时同步八进制输入
watch(computedOctal, (val) => {
  octalInput.value = val.toString(8).padStart(3, '0')
})

// 八进制输入变化时同步复选框
function handleOctalInput(value: string) {
  octalInput.value = value
  const num = parseInt(value, 8)
  if (!isNaN(num) && num >= 0 && num <= 0o777) {
    setFromOctal(num)
  }
}

// 打开时初始化
watch(
  () => props.open,
  (open) => {
    if (open && props.currentPermissions != null) {
      const mode = props.currentPermissions & 0o777
      setFromOctal(mode)
      octalInput.value = mode.toString(8).padStart(3, '0')
    }
  },
)

async function handleConfirm() {
  saving.value = true
  try {
    emit('confirm', computedOctal.value)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[420px]">
      <DialogHeader>
        <DialogTitle>{{ t('fileEditor.permissions') }} - {{ fileName }}</DialogTitle>
      </DialogHeader>

      <div class="space-y-4">
        <!-- 权限矩阵 -->
        <div class="rounded-md border border-border">
          <table class="w-full text-xs">
            <thead>
              <tr class="border-b border-border bg-muted/50">
                <th class="px-3 py-2 text-left font-medium" />
                <th class="px-3 py-2 text-center font-medium">{{ t('fileEditor.permRead') }}</th>
                <th class="px-3 py-2 text-center font-medium">{{ t('fileEditor.permWrite') }}</th>
                <th class="px-3 py-2 text-center font-medium">{{ t('fileEditor.permExec') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-b border-border">
                <td class="px-3 py-2 font-medium">{{ t('fileEditor.permOwner') }}</td>
                <td class="px-3 py-2 text-center"><input type="checkbox" v-model="ownerRead" class="accent-primary h-3.5 w-3.5 cursor-pointer" /></td>
                <td class="px-3 py-2 text-center"><input type="checkbox" v-model="ownerWrite" class="accent-primary h-3.5 w-3.5 cursor-pointer" /></td>
                <td class="px-3 py-2 text-center"><input type="checkbox" v-model="ownerExec" class="accent-primary h-3.5 w-3.5 cursor-pointer" /></td>
              </tr>
              <tr class="border-b border-border">
                <td class="px-3 py-2 font-medium">{{ t('fileEditor.permGroup') }}</td>
                <td class="px-3 py-2 text-center"><input type="checkbox" v-model="groupRead" class="accent-primary h-3.5 w-3.5 cursor-pointer" /></td>
                <td class="px-3 py-2 text-center"><input type="checkbox" v-model="groupWrite" class="accent-primary h-3.5 w-3.5 cursor-pointer" /></td>
                <td class="px-3 py-2 text-center"><input type="checkbox" v-model="groupExec" class="accent-primary h-3.5 w-3.5 cursor-pointer" /></td>
              </tr>
              <tr>
                <td class="px-3 py-2 font-medium">{{ t('fileEditor.permOther') }}</td>
                <td class="px-3 py-2 text-center"><input type="checkbox" v-model="otherRead" class="accent-primary h-3.5 w-3.5 cursor-pointer" /></td>
                <td class="px-3 py-2 text-center"><input type="checkbox" v-model="otherWrite" class="accent-primary h-3.5 w-3.5 cursor-pointer" /></td>
                <td class="px-3 py-2 text-center"><input type="checkbox" v-model="otherExec" class="accent-primary h-3.5 w-3.5 cursor-pointer" /></td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 八进制输入 + 预览 -->
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted-foreground">{{ t('fileEditor.permOctal') }}:</span>
            <Input
              :model-value="octalInput"
              class="w-20 font-mono text-sm"
              maxlength="4"
              @update:model-value="handleOctalInput"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted-foreground">{{ t('fileEditor.permPreview') }}:</span>
            <code class="rounded bg-muted px-2 py-1 font-mono text-sm">{{ permissionString }}</code>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">
          {{ t('common.cancel') }}
        </Button>
        <Button :disabled="saving" @click="handleConfirm">
          <Loader2 v-if="saving" class="mr-2 h-4 w-4 animate-spin" />
          {{ t('common.confirm') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
