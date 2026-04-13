<script setup lang="ts">
/**
 * ObjectEditorDialog - 数据库对象编辑对话框
 * 支持创建和编辑视图、存储过程、函数、触发器
 */
import { ref, computed, watch } from 'vue'
import { dbGetObjectDefinition, dbExecuteQueryInDatabase } from '@/api/database'
import { ensureErrorString } from '@/types/error'
import { Button } from '@/components/ui/button'
import { useMessage } from '@/stores/message-center'
import { Play, X, Loader2 } from 'lucide-vue-next'

const props = defineProps<{
  open: boolean
  connectionId: string
  database: string
  /** 对象类型: VIEW, PROCEDURE, FUNCTION, TRIGGER */
  objectType: string
  /** 对象名称（编辑模式下传入，新建时为空） */
  objectName?: string
  /** 触发器关联的表名（新建触发器时使用） */
  tableName?: string
}>()

const emit = defineEmits<{
  'update:open': [val: boolean]
  /** 对象创建/修改成功后触发，用于刷新对象树 */
  saved: []
}>()

const message = useMessage()
const sqlContent = ref('')
const isLoading = ref(false)
const isExecuting = ref(false)
const executionError = ref<string | null>(null)

/** 是否为编辑模式 */
const isEditMode = computed(() => !!props.objectName)

/** 对话框标题 */
const dialogTitle = computed(() => {
  const typeLabel: Record<string, string> = {
    VIEW: '视图',
    PROCEDURE: '存储过程',
    FUNCTION: '函数',
    TRIGGER: '触发器',
  }
  const label = typeLabel[props.objectType] ?? props.objectType
  return isEditMode.value ? `编辑${label}: ${props.objectName}` : `新建${label}`
})

/** 生成新建模板 SQL */
function generateTemplate(): string {
  const db = props.database
  switch (props.objectType) {
    case 'VIEW':
      return `CREATE VIEW \`${db}\`.\`new_view\` AS\nSELECT * FROM \`your_table\`\nWHERE 1 = 1;`
    case 'PROCEDURE':
      return `DELIMITER $$\nCREATE PROCEDURE \`${db}\`.\`new_procedure\`(\n  IN param1 INT,\n  OUT param2 VARCHAR(255)\n)\nBEGIN\n  -- 在此编写存储过程逻辑\n  SELECT param1;\nEND$$\nDELIMITER ;`
    case 'FUNCTION':
      return `DELIMITER $$\nCREATE FUNCTION \`${db}\`.\`new_function\`(\n  param1 INT\n)\nRETURNS INT\nDETERMINISTIC\nBEGIN\n  -- 在此编写函数逻辑\n  RETURN param1 * 2;\nEND$$\nDELIMITER ;`
    case 'TRIGGER':
      return `DELIMITER $$\nCREATE TRIGGER \`${db}\`.\`new_trigger\`\nBEFORE INSERT ON \`${props.tableName || 'your_table'}\`\nFOR EACH ROW\nBEGIN\n  -- 在此编写触发器逻辑\n  -- NEW.column_name 引用新值\n  -- OLD.column_name 引用旧值（UPDATE/DELETE）\nEND$$\nDELIMITER ;`
    default:
      return ''
  }
}

/** 加载现有对象定义 */
async function loadDefinition() {
  if (!isEditMode.value) {
    sqlContent.value = generateTemplate()
    return
  }
  isLoading.value = true
  try {
    const definition = await dbGetObjectDefinition(
      props.connectionId,
      props.database,
      props.objectName!,
      props.objectType,
    )
    // 对于编辑，需要将 CREATE 改为 CREATE OR REPLACE（视图）或先 DROP 再 CREATE（过程/函数/触发器）
    if (props.objectType === 'VIEW') {
      // MySQL 支持 CREATE OR REPLACE VIEW
      sqlContent.value = definition.replace(/^CREATE\s+/i, 'CREATE OR REPLACE ')
    } else {
      // 存储过程/函数/触发器需要先 DROP 再 CREATE
      const escapedName = props.objectName!.replace(/`/g, '``')
      const escapedDb = props.database.replace(/`/g, '``')
      const dropStmt = `DROP ${props.objectType} IF EXISTS \`${escapedDb}\`.\`${escapedName}\`;`
      sqlContent.value = `${dropStmt}\n\n${definition}`
    }
  } catch (e) {
    message.error('加载定义失败: ' + e)
    sqlContent.value = generateTemplate()
  } finally {
    isLoading.value = false
  }
}

/** 执行 SQL */
async function executeSql() {
  if (!sqlContent.value.trim() || isExecuting.value) return
  isExecuting.value = true
  executionError.value = null
  try {
    // 处理 DELIMITER：MySQL 的 DELIMITER 是客户端指令，不能直接发给服务器
    // 需要去掉 DELIMITER 行，提取真正的 SQL
    let sql = sqlContent.value
    const delimiterMatch = sql.match(/^DELIMITER\s+(\S+)/im)
    if (delimiterMatch) {
      const delim = delimiterMatch[1]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // 移除所有 DELIMITER 行
      sql = sql.replace(/^DELIMITER\s+\S+\s*$/gim, '')
      // 将自定义分隔符替换为分号
      sql = sql.replace(new RegExp(delim, 'g'), ';')
      sql = sql.trim()
    }

    const result = await dbExecuteQueryInDatabase(props.connectionId, props.database, sql)
    if (result.isError) {
      executionError.value = ensureErrorString(result.error) || '执行失败'
    } else {
      message.success(`${isEditMode.value ? '修改' : '创建'}成功`)
      emit('saved')
      close()
    }
  } catch (e) {
    executionError.value = String(e)
  } finally {
    isExecuting.value = false
  }
}

function close() {
  emit('update:open', false)
}

// 打开时加载内容
watch(() => props.open, (val) => {
  if (val) {
    executionError.value = null
    loadDefinition()
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      @click.self="close"
    >
      <div class="w-[800px] max-h-[80vh] flex flex-col rounded-2xl border border-border bg-background shadow-2xl">
        <!-- 标题栏 -->
        <div class="flex items-center justify-between border-b border-border/30 px-6 py-4">
          <h2 class="text-sm font-black tracking-tight">{{ dialogTitle }}</h2>
          <Button variant="ghost" size="icon" class="h-7 w-7 rounded-full" @click="close">
            <X class="h-4 w-4" />
          </Button>
        </div>

        <!-- 编辑器区域 -->
        <div class="flex-1 min-h-0 p-4">
          <div v-if="isLoading" class="flex items-center justify-center h-64">
            <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
          <textarea
            v-else
            v-model="sqlContent"
            class="w-full h-[400px] font-mono text-xs leading-relaxed rounded-xl border border-border/30 bg-muted/20 p-4 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            spellcheck="false"
            placeholder="输入 SQL..."
          />
        </div>

        <!-- 错误信息 -->
        <div v-if="executionError" class="mx-4 mb-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <pre class="whitespace-pre-wrap break-all">{{ executionError }}</pre>
        </div>

        <!-- 底部操作栏 -->
        <div class="flex items-center justify-between border-t border-border/30 px-6 py-3">
          <div class="text-[10px] text-muted-foreground/50">
            <template v-if="objectType !== 'VIEW'">
              提示: DELIMITER 语法会自动处理，无需手动修改
            </template>
          </div>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" class="h-8 text-xs" @click="close">
              取消
            </Button>
            <Button
              size="sm"
              class="h-8 text-xs gap-1.5"
              :disabled="!sqlContent.trim() || isExecuting"
              @click="executeSql"
            >
              <Play v-if="!isExecuting" class="h-3.5 w-3.5" />
              <Loader2 v-else class="h-3.5 w-3.5 animate-spin" />
              {{ isExecuting ? '执行中...' : '执行' }}
            </Button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
