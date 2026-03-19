# FilePane 列标题排序 + 键入跳转

## Context

文件管理器 FilePane 当前没有列标题表头，排序是后端固定的（目录优先 + 名称字母序），也不支持键入字母快速跳转到匹配文件。参考 xftp，需要：
1. 添加可点击的列标题表头（名称 / 大小 / 修改时间），点击切换排序
2. Windows 资源管理器风格的键入跳转：在文件列表获得焦点时按字母键，自动跳转到第一个匹配的文件

## 修改文件

- `src/components/file-manager/FilePane.vue` — 主要改动
- `src/locales/zh-CN.ts` — 添加表头翻译
- `src/locales/en.ts` — 添加表头翻译

## 实现方案

### 1. 前端排序

后端排序保持不变（目录优先 + 名称），前端在此基础上二次排序。

```ts
type SortField = 'name' | 'size' | 'modified'
type SortDirection = 'asc' | 'desc'

const sortField = ref<SortField>('name')
const sortDirection = ref<SortDirection>('asc')

const sortedEntries = computed(() => {
  // 先分离目录和文件（目录始终在前）
  const dirs = props.entries.filter(e => e.isDir)
  const files = props.entries.filter(e => !e.isDir)

  const compareFn = (a, b) => {
    // 按 sortField 比较
    // sortDirection === 'desc' 时反转
  }

  dirs.sort(compareFn)
  files.sort(compareFn)
  return [...dirs, ...files]
})
```

所有使用 `props.entries` 的地方改为 `sortedEntries`（虚拟滚动 count、行渲染、选择逻辑等）。

### 2. 列标题表头

在 PathBar 和文件列表之间插入一行表头，布局与文件行一致（gap-3 px-3）：

```
[图标占位 16px] [名称 ↑ flex-1] [大小 w-16] [修改时间 w-28]
```

- 点击列标题 → 同字段切换方向（asc↔desc），不同字段默认 asc
- 当前排序列显示 ↑ 或 ↓ ���标（lucide: ArrowUp / ArrowDown）
- 表头高度 28px，与文件行一致
- 样式：text-xs text-muted-foreground，hover 高亮

### 3. 键入跳转（Type-ahead）

在已有的 `handleKeyDown` 中扩展：

```ts
let typeAheadBuffer = ''
let typeAheadTimer: ReturnType<typeof setTimeout> | null = null

// 在 handleKeyDown 中：
// 如果按键是可打印字符（单个字母/数字），且没有 Ctrl/Meta 修饰：
//   1. 追加到 typeAheadBuffer
//   2. 重置 500ms 清空定时器
//   3. 在 sortedEntries 中找第一个 name 以 buffer 开头的（不区分大小写）
//   4. 选中该文件并滚动到可见位置（virtualizer.scrollToIndex）
```

关键点：
- 连续输入 "as" → 匹配 "assets" 而不是先跳到 "a" 开头再跳到 "s" 开头
- 500ms 无输入后清空 buffer，下次按键重新开始
- 用 `virtualizer.scrollToIndex(index, { align: 'center' })` 滚动到目标行

### 4. 模板改动

```html
<!-- 在 PathBar 之后、scrollContainerRef 之前插入 -->
<div class="flex items-center gap-3 px-3 border-b border-border text-[11px]
            text-muted-foreground select-none"
     :style="{ height: ROW_HEIGHT + 'px', paddingLeft: '13px' }">
  <!-- 图标占位 -->
  <div class="w-4 shrink-0" />
  <!-- 名称列 -->
  <div class="flex-1 flex items-center gap-1 cursor-pointer hover:text-foreground"
       @click="toggleSort('name')">
    <span>{{ t('fileManager.columnName') }}</span>
    <ArrowUp/ArrowDown v-if="sortField === 'name'" class="h-3 w-3" />
  </div>
  <!-- 大小列 -->
  <div class="w-16 shrink-0 text-right flex items-center justify-end gap-1 cursor-pointer hover:text-foreground"
       @click="toggleSort('size')">
    <span>{{ t('fileManager.columnSize') }}</span>
    <ArrowUp/ArrowDown v-if="sortField === 'size'" class="h-3 w-3" />
  </div>
  <!-- 修改时间列 -->
  <div class="w-28 shrink-0 text-right flex items-center justify-end gap-1 cursor-pointer hover:text-foreground"
       @click="toggleSort('modified')">
    <span>{{ t('fileManager.columnModified') }}</span>
    <ArrowUp/ArrowDown v-if="sortField === 'modified'" class="h-3 w-3" />
  </div>
</div>
```

### 5. i18n

zh-CN:
```
columnName: '名称',
columnSize: '大小',
columnModified: '修改时间',
```

en:
```
columnName: 'Name',
columnSize: 'Size',
columnModified: 'Modified',
```

### 6. 注意事项

- `sortedEntries` 替换 `props.entries` 的位置：virtualizer count、getVirtualItems 渲染、handleClick、isSelected、selectAll、框选 updateMarqueeSelection、selectedItems computed
- 排序状态在切换目录时不重置（保持用户偏好）
- 表头不参与虚拟滚动，固定在列表顶部

## 验证

1. 点击"名称"列标题 → 文件按名称升序排列，再点 → 降序，图标跟随变化
2. 点击"大小"列标题 → 按大小排序，目录始终在前
3. 点击"修改时间"列标题 → 按时间排序
4. 在文件列表中按 "a" → 跳转到第一个 a 开头的文件并选中
5. 快速输入 "as" → 跳转到 "assets" 而不是 "s" 开头的文件
6. 500ms 后再按 "b" → 跳转到 b 开头的文件（buffer 已清空）
7. 框选、Ctrl+Click、Shift+Click、Ctrl+A 等选择功能不受影响
8. vue-tsc 类型检查通过
