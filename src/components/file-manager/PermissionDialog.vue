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
import { Loader2, ShieldCheck } from 'lucide-vue-next'

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
const permissions = ref<Record<string, boolean>>({
  ownerRead: false, ownerWrite: false, ownerExec: false,
  groupRead: false, groupWrite: false, groupExec: false,
  otherRead: false, otherWrite: false, otherExec: false
})

const octalInput = ref('644')

// 从对象计算八进制值
const computedOctal = computed(() => {
  let mode = 0
  const p = permissions.value
  if (p.ownerRead) mode |= 0o400
  if (p.ownerWrite) mode |= 0o200
  if (p.ownerExec) mode |= 0o100
  if (p.groupRead) mode |= 0o040
  if (p.groupWrite) mode |= 0o020
  if (p.groupExec) mode |= 0o010
  if (p.otherRead) mode |= 0o004
  if (p.otherWrite) mode |= 0o002
  if (p.otherExec) mode |= 0o001
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
  const p = permissions.value
  p.ownerRead = !!(mode & 0o400)
  p.ownerWrite = !!(mode & 0o200)
  p.ownerExec = !!(mode & 0o100)
  p.groupRead = !!(mode & 0o040)
  p.groupWrite = !!(mode & 0o020)
  p.groupExec = !!(mode & 0o010)
  p.otherRead = !!(mode & 0o004)
  p.otherWrite = !!(mode & 0o002)
  p.otherExec = !!(mode & 0o001)
}

// 复选框变化时同步八进制输入
watch(computedOctal, (val) => {
  octalInput.value = val.toString(8).padStart(3, '0')
})

// 八进制输入变化时同步复选框
function handleOctalInput(value: string | number) {
  const strValue = String(value)
  octalInput.value = strValue
  const num = parseInt(strValue, 8)
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
    <DialogContent class="sm:max-w-[380px] p-0 overflow-hidden border border-border/40 shadow-2xl rounded-2xl bg-background/98 backdrop-blur-3xl">
      <!-- Masterpiece Header -->
      <DialogHeader class="px-5 py-3 border-b border-muted/30 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <ShieldCheck class="h-3.5 w-3.5 text-primary" />
          <DialogTitle class="text-[12px] font-black uppercase tracking-widest text-foreground/70">
            {{ t('fileEditor.permissions') }}
          </DialogTitle>
        </div>
      </DialogHeader>

      <div class="p-5">
        <div class="space-y-5">
          <!-- 权限矩阵 -->
          <div class="rounded-xl border border-border/40 bg-muted/5 overflow-hidden">
            <table class="w-full text-[11px] border-collapse">
              <thead>
                <tr class="bg-muted/10 border-b border-border/20">
                  <th class="px-4 py-2.5 text-left font-black text-muted-foreground/40 uppercase tracking-widest" />
                  <th class="px-2 py-2.5 text-center font-black text-muted-foreground/40 uppercase tracking-widest">{{ t('fileEditor.permRead') }}</th>
                  <th class="px-2 py-2.5 text-center font-black text-muted-foreground/40 uppercase tracking-widest">{{ t('fileEditor.permWrite') }}</th>
                  <th class="px-2 py-2.5 text-center font-black text-muted-foreground/40 uppercase tracking-widest">{{ t('fileEditor.permExec') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border/10">
                <tr v-for="role in ['owner', 'group', 'other']" :key="role" class="hover:bg-primary/[0.02] transition-colors">
                  <td class="px-4 py-3 font-extrabold text-foreground/60 uppercase tracking-tight text-[10px]">
                    {{ t(`fileEditor.perm${role.charAt(0).toUpperCase() + role.slice(1)}`) }}
                  </td>
                  <td v-for="perm in ['Read', 'Write', 'Exec']" :key="perm" class="px-2 py-3 text-center">
                    <label class="relative inline-flex items-center justify-center group cursor-pointer">
                      <input 
                        type="checkbox" 
                        v-model="permissions[role + perm]" 
                        class="sr-only peer"
                      />
                      <div class="w-5 h-5 rounded-md border-2 border-border/60 bg-background transition-[background-color,border-color,box-shadow,scale] peer-checked:bg-primary peer-checked:border-primary peer-checked:shadow-[0_0_10px_rgba(var(--primary),0.2)] peer-focus:ring-4 peer-focus:ring-primary/10 group-active:scale-90"></div>
                      <div class="absolute inset-0 flex items-center justify-center text-white scale-0 transition-transform peer-checked:scale-100">
                        <svg class="w-3 h-3 fill-current" viewBox="0 0 20 20"><path d="M0 11l2-2 5 5L18 3l2 2L7 18z"/></svg>
                      </div>
                    </label>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 八进制输入 + 预览 -->
          <div class="grid grid-cols-2 gap-2.5">
            <div class="flex items-center justify-between px-3 py-2 rounded-xl border border-border/40 bg-muted/10">
              <span class="text-[9px] font-black text-muted-foreground/40 uppercase tracking-widest">{{ t('fileEditor.permOctal') }}</span>
              <Input
                :model-value="octalInput"
                class="h-7 w-12 border-none bg-transparent px-1 font-mono text-[13px] font-black text-center focus-visible:ring-0"
                maxlength="4"
                @update:model-value="handleOctalInput"
              />
            </div>
            <div class="flex items-center justify-between px-3 py-2 rounded-xl border border-primary/20 bg-primary/5">
              <span class="text-[9px] font-black text-primary/40 uppercase tracking-widest">{{ t('fileEditor.permPreview') }}</span>
              <code class="font-mono text-[11px] font-black text-primary tracking-wider">{{ permissionString }}</code>
            </div>
          </div>
        </div>

        <DialogFooter class="flex gap-2.5 mt-5 p-0 sm:justify-start">
          <Button 
            variant="outline" 
            class="flex-1 h-9 rounded-xl text-[11px] font-bold text-foreground/60 border-border/40 hover:bg-muted transition-colors" 
            @click="emit('update:open', false)"
          >
            {{ t('common.cancel') }}
          </Button>
          <Button 
            :disabled="saving" 
            class="flex-1 h-9 rounded-xl text-[11px] font-black shadow-lg shadow-primary/20 transition-[background-color,color,box-shadow,scale] active:scale-[0.96]" 
            @click="handleConfirm"
          >
            <Loader2 v-if="saving" class="mr-2 h-3 w-3 animate-spin" />
            {{ t('common.confirm') }}
          </Button>
        </DialogFooter>
      </div>
    </DialogContent>
  </Dialog>
</template>
