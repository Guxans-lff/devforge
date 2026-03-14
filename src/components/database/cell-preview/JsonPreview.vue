<script setup lang="ts">
import { computed, ref } from 'vue'
import { Copy, ChevronRight, ChevronDown, Table2, Code2, Search } from 'lucide-vue-next'
import { useToast } from '@/composables/useToast'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  /** JSON 字符串或已解析的对象 */
  value: string
}>()

const { t } = useI18n()
const toast = useToast()

/** 视图模式：tree（树状）或 table（表格，仅数组时可用） */
const viewMode = ref<'tree' | 'table'>('tree')
const searchQuery = ref('')

/** 解析 JSON */
const parsed = computed(() => {
  try {
    return typeof props.value === 'string' ? JSON.parse(props.value) : props.value
  } catch {
    return null
  }
})

/** 是否为数组（可切换表格视图） */
const isArray = computed(() => Array.isArray(parsed.value))

/** 表格视图：提取数组对象的列名 */
const tableColumns = computed(() => {
  if (!isArray.value || !parsed.value?.length) return []
  const keys = new Set<string>()
  for (const item of parsed.value) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      Object.keys(item).forEach(k => keys.add(k))
    }
  }
  return Array.from(keys)
})

/** 格式化 JSON 字符串（带语法高亮） */
const formattedJson = computed(() => {
  if (parsed.value === null) return props.value
  return JSON.stringify(parsed.value, null, 2)
})

// === 折叠/展开 ===
/** 已折叠的 JSON 路径 Set */
const collapsedPaths = ref<Set<string>>(new Set())

function toggleCollapse(path: string) {
  const next = new Set(collapsedPaths.value)
  if (next.has(path)) {
    next.delete(path)
  } else {
    next.add(path)
  }
  collapsedPaths.value = next
}

/** 全部展开 */
function expandAll() {
  collapsedPaths.value = new Set()
}

/** 全部折叠（仅折叠第一层） */
function collapseAll() {
  const paths = new Set<string>()
  if (parsed.value && typeof parsed.value === 'object') {
    Object.keys(parsed.value).forEach(k => {
      if (typeof parsed.value[k] === 'object' && parsed.value[k] !== null) {
        paths.add(`$.${k}`)
      }
    })
  }
  collapsedPaths.value = paths
}

/** 复制 JSON 路径 */
function copyPath(path: string) {
  navigator.clipboard.writeText(path).then(() => {
    toast.success(t('toast.copySuccess'))
  }).catch(() => {})
}

/** 复制整个格式化 JSON */
function copyFormatted() {
  navigator.clipboard.writeText(formattedJson.value).then(() => {
    toast.success(t('toast.copySuccess'))
  }).catch(() => {})
}

/** 递归渲染节点所需的类型 */
interface JsonNode {
  key: string
  value: unknown
  path: string
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
  children?: JsonNode[]
  childCount?: number
}

/** 构建 JSON 树 */
function buildTree(data: unknown, path: string = '$', key: string = '$'): JsonNode {
  if (data === null || data === undefined) {
    return { key, value: null, path, type: 'null' }
  }
  if (Array.isArray(data)) {
    return {
      key, value: data, path, type: 'array',
      childCount: data.length,
      children: data.map((item, i) => buildTree(item, `${path}[${i}]`, String(i))),
    }
  }
  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>)
    return {
      key, value: data, path, type: 'object',
      childCount: entries.length,
      children: entries.map(([k, v]) => buildTree(v, `${path}.${k}`, k)),
    }
  }
  return {
    key, value: data, path,
    type: typeof data as 'string' | 'number' | 'boolean',
  }
}

const tree = computed(() => buildTree(parsed.value))

/** 值的显示颜色 */
function getValueClass(type: string): string {
  switch (type) {
    case 'string': return 'text-green-600 dark:text-green-400'
    case 'number': return 'text-blue-600 dark:text-blue-400'
    case 'boolean': return 'text-amber-600 dark:text-amber-400'
    case 'null': return 'text-muted-foreground/50 italic'
    default: return ''
  }
}

/** 格式化原始值显示 */
function formatPrimitive(value: unknown, type: string): string {
  if (type === 'null') return 'null'
  if (type === 'string') return `"${String(value)}"`
  return String(value)
}

/** 格式化对象/数组的摘要标签（避免模板中大括号语法冲突） */
function formatBracketLabel(type: string, count?: number): string {
  return type === 'array' ? `[${count}]` : `{${count}}`
}

/** 格式化叶子节点的值（如果是对象/数组则显示摘要，否则显示原始值） */
function formatNodeValue(node: JsonNode): string {
  if (node.type === 'object' || node.type === 'array') {
    return formatBracketLabel(node.type, node.childCount)
  }
  return formatPrimitive(node.value, node.type)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 工具栏 -->
    <div class="flex items-center gap-2 border-b border-border/50 px-3 py-1.5 shrink-0">
      <div class="flex items-center gap-1.5 flex-1">
        <Search class="h-3 w-3 text-muted-foreground" />
        <input
          v-model="searchQuery"
          placeholder="搜索 key 或 value..."
          class="h-6 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
        />
      </div>
      <div class="flex items-center gap-1">
        <button
          class="text-[10px] px-1.5 py-0.5 rounded-sm"
          :class="viewMode === 'tree' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50'"
          @click="viewMode = 'tree'"
        >
          <Code2 class="h-3 w-3" />
        </button>
        <button
          v-if="isArray"
          class="text-[10px] px-1.5 py-0.5 rounded-sm"
          :class="viewMode === 'table' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50'"
          @click="viewMode = 'table'"
        >
          <Table2 class="h-3 w-3" />
        </button>
        <div class="w-px h-3 bg-border/50 mx-0.5" />
        <button class="text-[10px] px-1.5 py-0.5 rounded-sm text-muted-foreground hover:bg-muted/50" @click="expandAll">展开</button>
        <button class="text-[10px] px-1.5 py-0.5 rounded-sm text-muted-foreground hover:bg-muted/50" @click="collapseAll">折叠</button>
        <button class="text-[10px] px-1.5 py-0.5 rounded-sm text-muted-foreground hover:bg-muted/50" @click="copyFormatted">
          <Copy class="h-3 w-3" />
        </button>
      </div>
    </div>

    <!-- 树视图 -->
    <div v-if="viewMode === 'tree'" class="flex-1 overflow-auto p-2">
      <div v-if="parsed !== null" class="text-xs font-mono">
        <template v-for="child in tree.children ?? [tree]" :key="child.path">
          <div
            class="json-node"
            :class="{ 'opacity-40': searchQuery && !child.key.toLowerCase().includes(searchQuery.toLowerCase()) && !String(child.value).toLowerCase().includes(searchQuery.toLowerCase()) }"
          >
            <!-- 可折叠节点（对象/数组） -->
            <template v-if="child.type === 'object' || child.type === 'array'">
              <div class="flex items-start gap-0.5 group hover:bg-muted/30 rounded-sm px-1 py-0.5">
                <button class="mt-0.5 shrink-0" @click="toggleCollapse(child.path)">
                  <ChevronRight v-if="collapsedPaths.has(child.path)" class="h-3 w-3 text-muted-foreground" />
                  <ChevronDown v-else class="h-3 w-3 text-muted-foreground" />
                </button>
                <span class="text-purple-600 dark:text-purple-400 cursor-pointer" @click="copyPath(child.path)">{{ child.key }}</span>
                <span class="text-muted-foreground/50 ml-1">
                  {{ formatBracketLabel(child.type, child.childCount) }}
                </span>
              </div>
              <!-- 子节点 -->
              <div v-if="!collapsedPaths.has(child.path)" class="ml-4 border-l border-border/30 pl-1">
                <div
                  v-for="sub in child.children"
                  :key="sub.path"
                  class="json-node"
                >
                  <template v-if="sub.type === 'object' || sub.type === 'array'">
                    <div class="flex items-start gap-0.5 group hover:bg-muted/30 rounded-sm px-1 py-0.5">
                      <button class="mt-0.5 shrink-0" @click="toggleCollapse(sub.path)">
                        <ChevronRight v-if="collapsedPaths.has(sub.path)" class="h-3 w-3 text-muted-foreground" />
                        <ChevronDown v-else class="h-3 w-3 text-muted-foreground" />
                      </button>
                      <span class="text-purple-600 dark:text-purple-400 cursor-pointer" @click="copyPath(sub.path)">{{ sub.key }}</span>
                      <span class="text-muted-foreground/50 ml-1">
                        {{ formatBracketLabel(sub.type, sub.childCount) }}
                      </span>
                    </div>
                    <div v-if="!collapsedPaths.has(sub.path)" class="ml-4 border-l border-border/30 pl-1">
                      <div v-for="leaf in sub.children" :key="leaf.path" class="flex items-start gap-0.5 hover:bg-muted/30 rounded-sm px-1 py-0.5">
                        <span class="w-3 shrink-0" />
                        <span class="text-purple-600 dark:text-purple-400 cursor-pointer" @click="copyPath(leaf.path)">{{ leaf.key }}</span>
                        <span class="text-muted-foreground/50 mx-0.5">:</span>
                        <span :class="getValueClass(leaf.type)" class="break-all">
                          {{ formatNodeValue(leaf) }}
                        </span>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="flex items-start gap-0.5 hover:bg-muted/30 rounded-sm px-1 py-0.5">
                      <span class="w-3 shrink-0" />
                      <span class="text-purple-600 dark:text-purple-400 cursor-pointer" @click="copyPath(sub.path)">{{ sub.key }}</span>
                      <span class="text-muted-foreground/50 mx-0.5">:</span>
                      <span :class="getValueClass(sub.type)" class="break-all">{{ formatPrimitive(sub.value, sub.type) }}</span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
            <!-- 叶子节点 -->
            <template v-else>
              <div class="flex items-start gap-0.5 hover:bg-muted/30 rounded-sm px-1 py-0.5">
                <span class="w-3 shrink-0" />
                <span class="text-purple-600 dark:text-purple-400 cursor-pointer" @click="copyPath(child.path)">{{ child.key }}</span>
                <span class="text-muted-foreground/50 mx-0.5">:</span>
                <span :class="getValueClass(child.type)" class="break-all">{{ formatPrimitive(child.value, child.type) }}</span>
              </div>
            </template>
          </div>
        </template>
      </div>
      <div v-else class="text-xs text-destructive p-2">JSON 解析失败</div>
    </div>

    <!-- 表格视图（仅数组时可用） -->
    <div v-else-if="viewMode === 'table' && isArray" class="flex-1 overflow-auto">
      <table class="w-full text-xs border-collapse">
        <thead class="sticky top-0 bg-muted/80 backdrop-blur-sm">
          <tr>
            <th class="border border-border/50 px-2 py-1 text-left font-semibold text-muted-foreground">#</th>
            <th
              v-for="col in tableColumns"
              :key="col"
              class="border border-border/50 px-2 py-1 text-left font-semibold text-muted-foreground"
            >
              {{ col }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, i) in parsed" :key="i" class="hover:bg-muted/20">
            <td class="border border-border/50 px-2 py-1 text-muted-foreground/50 tabular-nums">{{ i }}</td>
            <td
              v-for="col in tableColumns"
              :key="col"
              class="border border-border/50 px-2 py-1 font-mono"
              :class="item?.[col] === null || item?.[col] === undefined ? 'text-muted-foreground/40 italic' : ''"
            >
              {{ item?.[col] === null || item?.[col] === undefined ? 'null' : typeof item[col] === 'object' ? JSON.stringify(item[col]) : item[col] }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
