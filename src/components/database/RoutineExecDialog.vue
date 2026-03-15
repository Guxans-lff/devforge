<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Loader2, Play, Copy, ArrowRight } from 'lucide-vue-next'
import { dbGetRoutineParameters } from '@/api/database'
import type { RoutineParameter } from '@/types/database'

const props = defineProps<{
  open: boolean
  connectionId: string
  database: string
  routineName: string
  routineType: string // PROCEDURE | FUNCTION
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  execute: [sql: string]
}>()

const loading = ref(false)
const parameters = ref<RoutineParameter[]>([])
const paramValues = ref<Record<string, string>>({})
const error = ref('')

/** 参数模式的颜色映射 */
const modeColors: Record<string, string> = {
  IN: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  OUT: 'bg-green-500/10 text-green-600 dark:text-green-400',
  INOUT: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
}

/** IN 和 INOUT 参数需要用户填写 */
const inputParams = computed(() => parameters.value.filter(p => p.mode === 'IN' || p.mode === 'INOUT'))

/** MySQL 标识符转义（反引号内的反引号加倍） */
function escapeIdentifier(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}

/** 生成执行 SQL */
const generatedSql = computed(() => {
  const db = escapeIdentifier(props.database)
  const name = escapeIdentifier(props.routineName)
  const qualified = `${db}.${name}`

  if (parameters.value.length === 0) {
    return props.routineType === 'PROCEDURE'
      ? `CALL ${qualified}();`
      : `SELECT ${qualified}();`
  }

  // 为每个参数生成占位值
  const args = parameters.value.map(p => {
    const val = paramValues.value[p.name]
    if (!val && val !== '0') return 'NULL'
    // 数字类型不加引号
    if (/^(int|bigint|smallint|tinyint|decimal|numeric|float|double|real)/i.test(p.dataType)) {
      return val
    }
    // 字符串类型加引号并转义
    return `'${val.replace(/'/g, "''")}'`
  })

  if (props.routineType === 'PROCEDURE') {
    return `CALL ${qualified}(${args.join(', ')});`
  }
  return `SELECT ${qualified}(${args.join(', ')});`
})

onMounted(async () => {
  loading.value = true
  error.value = ''
  try {
    parameters.value = await dbGetRoutineParameters(
      props.connectionId,
      props.database,
      props.routineName,
      props.routineType,
    )
    // 初始化参数值
    const vals: Record<string, string> = {}
    for (const p of parameters.value) {
      vals[p.name] = ''
    }
    paramValues.value = vals
  } catch (e: any) {
    error.value = e?.message ?? String(e)
  } finally {
    loading.value = false
  }
})

function handleExecute() {
  emit('execute', generatedSql.value)
  emit('update:open', false)
}

function handleCopySql() {
  navigator.clipboard.writeText(generatedSql.value)
}

function close() {
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="close">
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2 text-sm">
          <Play class="h-4 w-4 text-primary" />
          执行{{ routineType === 'PROCEDURE' ? '存储过程' : '函数' }}
          <code class="ml-1 text-xs font-mono text-muted-foreground">{{ database }}.{{ routineName }}</code>
        </DialogTitle>
        <DialogDescription class="text-xs text-muted-foreground">
          填写参数后点击执行，SQL 将插入到当前查询标签页
        </DialogDescription>
      </DialogHeader>

      <!-- 加载中 -->
      <div v-if="loading" class="flex items-center justify-center py-8">
        <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
        <span class="ml-2 text-sm text-muted-foreground">加载参数列表...</span>
      </div>

      <!-- 错误 -->
      <div v-else-if="error" class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
        {{ error }}
      </div>

      <!-- 参数表单 -->
      <div v-else class="space-y-4">
        <!-- 无参数 -->
        <div v-if="parameters.length === 0" class="text-center py-4 text-sm text-muted-foreground">
          该{{ routineType === 'PROCEDURE' ? '存储过程' : '函数' }}无需参数
        </div>

        <!-- 参数列表 -->
        <div v-else class="space-y-3 max-h-[300px] overflow-y-auto pr-1">
          <div
            v-for="param in inputParams"
            :key="param.name"
            class="grid grid-cols-[120px_1fr] items-center gap-3"
          >
            <div class="flex items-center gap-1.5 min-w-0">
              <Badge variant="outline" class="shrink-0 text-[9px] px-1 py-0" :class="modeColors[param.mode]">
                {{ param.mode }}
              </Badge>
              <Label class="text-xs font-mono truncate" :title="param.name">{{ param.name }}</Label>
            </div>
            <div class="flex items-center gap-2">
              <Input
                v-model="paramValues[param.name]"
                class="h-8 text-xs font-mono"
                :placeholder="param.dtdIdentifier"
              />
            </div>
          </div>
        </div>

        <!-- 生成的 SQL 预览 -->
        <div class="rounded-md bg-muted/50 p-3">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">SQL 预览</span>
            <Button variant="ghost" size="sm" class="h-6 px-2 text-[10px]" @click="handleCopySql">
              <Copy class="h-3 w-3 mr-1" />
              复制
            </Button>
          </div>
          <code class="block text-xs font-mono text-foreground/80 whitespace-pre-wrap break-all">{{ generatedSql }}</code>
        </div>
      </div>

      <DialogFooter class="gap-2">
        <Button variant="outline" size="sm" @click="close">取消</Button>
        <Button size="sm" :disabled="loading || !!error" @click="handleExecute">
          <ArrowRight class="h-3.5 w-3.5 mr-1" />
          插入并执行
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
