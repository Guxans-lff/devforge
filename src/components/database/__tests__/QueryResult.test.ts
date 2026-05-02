import { mount, flushPromises } from '@vue/test-utils'
import { computed, defineComponent, h, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  primaryKeysState,
  usePrimaryKeysMock,
  computeColumnStatsAsyncMock,
  saveMock,
  toastSuccessMock,
  toastErrorMock,
  createPassthroughStub,
} = vi.hoisted(() => ({
  primaryKeysState: {
    primaryKeys: { value: [] as string[] },
    pkLoading: { value: false },
  },
  usePrimaryKeysMock: vi.fn(),
  computeColumnStatsAsyncMock: vi.fn(),
  saveMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  createPassthroughStub: (name: string) => defineComponent({
    name,
    setup(_props, { slots, attrs }) {
      return () => h('div', attrs, slots.default?.())
    },
  }),
}))

vi.mock('vue-i18n', () => ({
  createI18n: () => ({
    global: {
      t: (key: string) => key,
      locale: { value: 'zh-CN' },
    },
    install: vi.fn(),
  }),
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@tanstack/vue-table', () => ({
  FlexRender: defineComponent({
    name: 'FlexRender',
    props: ['render', 'props'],
    setup(props) {
      return () => h('span', String(props.render ?? ''))
    },
  }),
  createColumnHelper: () => ({
    accessor: vi.fn((key, def) => ({
      id: key,
      columnDef: {
        header: def.header ?? key,
        cell: def.cell ?? (() => ''),
      },
      size: 160,
      minSize: 60,
      maxSize: 500,
    })),
  }),
  getCoreRowModel: () => vi.fn(),
  getSortedRowModel: () => vi.fn(),
  useVueTable: (options: any) => {
    const makeHeader = (column: any) => ({
      id: column.id,
      column: {
        id: column.id,
        columnDef: column.columnDef,
        getCanResize: () => false,
        getIsResizing: () => false,
        getResizeHandler: () => () => undefined,
        getIsSorted: () => false,
        getToggleSortingHandler: () => () => undefined,
      },
      getContext: () => ({}),
      getSize: () => column.size ?? 160,
      getResizeHandler: () => () => undefined,
    })

    const resolve = (value: any) => {
      if (value && typeof value === 'object' && 'value' in value) return value.value
      return typeof value === 'function' ? value() : value
    }

    const getColumns = () => resolve(options.columns) ?? []
    const getData = () => resolve(options.data) ?? []

    return {
      getRowModel: () => {
        const headers = getColumns().map(makeHeader)
        const rows = getData().map((row: any, index: number) => ({
          id: String(index),
          index,
          original: row,
          getVisibleCells: () => headers.map((header: any, colIndex: number) => ({
            id: `${index}-${header.id}`,
            column: header.column,
            getContext: () => ({
              getValue: () => row[colIndex],
            }),
          })),
        }))
        return { rows }
      },
      getFlatHeaders: () => getColumns().map(makeHeader),
      setColumnSizing: vi.fn(),
      getState: () => ({ columnSizing: {} }),
    }
  },
}))


vi.mock('@/composables/useAdaptiveOverscan', () => ({
  useAdaptiveOverscan: () => ({
    overscan: ref(20),
    attach: vi.fn(),
  }),
}))

vi.mock('@/composables/usePrimaryKey', () => ({
  usePrimaryKeys: usePrimaryKeysMock,
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
  }),
}))

vi.mock('@/api/database', () => ({
  writeTextFile: vi.fn(),
  dbExecuteQueryInDatabase: vi.fn(),
  dbGenerateScript: vi.fn(),
  dbGetTableData: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: saveMock,
}))

vi.mock('@/utils/exportData', () => ({
  formatData: vi.fn(() => 'export-content'),
  getFilters: vi.fn(() => []),
}))

vi.mock('@/utils/columnStatistics', () => ({
  computeColumnStatsAsync: computeColumnStatsAsyncMock,
}))

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/types/error', () => ({
  parseBackendError: (error: unknown) => String(error),
}))

vi.mock('@/components/database/ExportDialog.vue', () => ({
  default: defineComponent({
    name: 'ExportDialog',
    setup() {
      return () => h('div')
    },
  }),
}))

vi.mock('@/components/database/RowDetailSheet.vue', () => ({
  default: defineComponent({
    name: 'RowDetailSheet',
    emits: ['update:open', 'navigate'],
    setup(_props, { slots }) {
      return () => h('div', slots.default?.())
    },
  }),
}))

vi.mock('@/components/database/ColumnStatsBar.vue', () => ({
  default: defineComponent({
    name: 'ColumnStatsBar',
    props: ['stats', 'columnName'],
    setup(props) {
      return () => h('div', {
        'data-testid': 'column-stats-bar',
        'data-column': props.columnName,
      }, `总计:${props.stats?.basic?.totalCount ?? ''}`)
    },
  }),
}))

vi.mock('@/components/database/chart/ChartPanel.vue', () => {
  const ChartPanel = defineComponent({
    name: 'ChartPanel',
    setup() {
      return () => h('div')
    },
  })
  return {
    __esModule: true,
    __isTeleport: false,
    __isKeepAlive: false,
    name: 'ChartPanel',
    default: ChartPanel,
  }
})

vi.mock('lucide-vue-next', () => {
  const createIcon = (name: string) => defineComponent({
    name,
    setup() {
      return () => h('svg', { 'data-icon': name })
    },
  })

  return {
    ArrowUpDown: createIcon('ArrowUpDown'),
    ArrowUp: createIcon('ArrowUp'),
    ArrowDown: createIcon('ArrowDown'),
    Clock: createIcon('Clock'),
    AlertCircle: createIcon('AlertCircle'),
    CheckCircle2: createIcon('CheckCircle2'),
    Hash: createIcon('Hash'),
    Download: createIcon('Download'),
    Trash2: createIcon('Trash2'),
    Filter: createIcon('Filter'),
    ShieldAlert: createIcon('ShieldAlert'),
    WifiOff: createIcon('WifiOff'),
    KeyRound: createIcon('KeyRound'),
    Eye: createIcon('Eye'),
    Loader2: createIcon('Loader2'),
    RotateCcw: createIcon('RotateCcw'),
    Activity: createIcon('Activity'),
    Play: createIcon('Play'),
    Table: createIcon('Table'),
    BarChart3: createIcon('BarChart3'),
    Settings2: createIcon('Settings2'),
    Pin: createIcon('Pin'),
    PinOff: createIcon('PinOff'),
    Sparkles: createIcon('Sparkles'),
    Wand2: createIcon('Wand2'),
    Copy: createIcon('Copy'),
  }
})

vi.mock('@/components/ui/button', () => ({
  Button: defineComponent({
    name: 'Button',
    emits: ['click'],
    setup(_props, { slots, attrs, emit }) {
      return () => h('button', {
        ...attrs,
        onClick: (event: MouseEvent) => emit('click', event),
      }, slots.default?.())
    },
  }),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: createPassthroughStub('DropdownMenu'),
  DropdownMenuContent: createPassthroughStub('DropdownMenuContent'),
  DropdownMenuItem: defineComponent({
    name: 'DropdownMenuItem',
    emits: ['click'],
    setup(_props, { slots, attrs, emit }) {
      return () => h('button', {
        ...attrs,
        class: ['dropdown-menu-item', attrs.class],
        onClick: (event: MouseEvent) => emit('click', event),
      }, slots.default?.())
    },
  }),
  DropdownMenuSeparator: createPassthroughStub('DropdownMenuSeparator'),
  DropdownMenuTrigger: createPassthroughStub('DropdownMenuTrigger'),
}))

vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: createPassthroughStub('ConfirmDialog'),
}))

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: createPassthroughStub('ContextMenu'),
  ContextMenuContent: createPassthroughStub('ContextMenuContent'),
  ContextMenuItem: defineComponent({
    name: 'ContextMenuItem',
    emits: ['click'],
    setup(_props, { slots, attrs, emit }) {
      return () => h('button', {
        ...attrs,
        class: ['context-menu-item', attrs.class],
        onClick: (event: MouseEvent) => emit('click', event),
      }, slots.default?.())
    },
  }),
  ContextMenuSeparator: createPassthroughStub('ContextMenuSeparator'),
  ContextMenuTrigger: createPassthroughStub('ContextMenuTrigger'),
}))

import QueryResult from '@/components/database/QueryResult.vue'
import { dbGetTableData, dbGenerateScript, writeTextFile } from '@/api/database'

function makeResult() {
  return {
    columns: [
      { name: 'id', dataType: 'INT', nullable: false },
      { name: 'name', dataType: 'VARCHAR', nullable: true },
    ],
    rows: [
      [10, 'Ada'],
      [11, 'Linus'],
    ],
    affectedRows: 0,
    executionTimeMs: 8,
    isError: false,
    error: null,
    totalCount: 2,
    truncated: false,
    tableName: 'users',
  }
}

function mountQueryResult(
  options?: {
    tableBrowse?: {
      database: string
      table: string
      currentPage: number
      pageSize: number
      whereClause?: string
      orderBy?: string
      filterOperators?: Record<string, string>
      showFilters?: boolean
      showChart?: boolean
      selectedRowIndex?: number
      rowDetailOpen?: boolean
      pinnedColumns?: {
        left?: string[]
        right?: string[]
      }
    }
    result?: ReturnType<typeof makeResult>
  },
) {
  return mount(QueryResult, {
    attachTo: document.body,
    props: {
      result: options?.result ?? makeResult(),
      loading: false,
      loadingMore: false,
      hasMoreServerRows: true,
      showReconnect: false,
      connectionId: 'conn-1',
      database: 'demo',
      tableName: 'users',
      driver: 'mysql',
      isTableBrowse: true,
      tableBrowse: options?.tableBrowse,
    },
  })
}

describe('QueryResult 表浏览状态回填', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    primaryKeysState.primaryKeys.value = ['id']
    primaryKeysState.pkLoading.value = false
    usePrimaryKeysMock.mockReturnValue(primaryKeysState)
    computeColumnStatsAsyncMock.mockResolvedValue({
      basic: { totalCount: 2, uniqueCount: 2, nullCount: 0, nullPercent: 0, nonNullCount: 2 },
      numeric: { min: 10, max: 11, avg: 10.5, sum: 21, median: 10.5 },
      string: null,
    })
    saveMock.mockResolvedValue('/tmp/export.sql')
  })

  it('展示从 tableBrowse 回填的服务端筛选值、操作符和排序状态', async () => {
    const wrapper = mountQueryResult({
      tableBrowse: {
      database: 'demo',
      table: 'users',
      currentPage: 1,
      pageSize: 200,
      whereClause: "`name` LIKE '%Ada%' AND `id` >= '10'",
      orderBy: '`id` DESC',
      filterOperators: { name: 'LIKE', id: '>=' },
      },
    })

    await flushPromises()

    await wrapper.findAll('button').find(btn => btn.text().includes('database.filter'))?.trigger('click')
    await wrapper.setProps({
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
        whereClause: "`name` LIKE '%Ada%' AND `id` >= '10'",
        orderBy: '`id` DESC',
        filterOperators: { name: 'LIKE', id: '>=' },
        showFilters: true,
      },
    })
    await flushPromises()

    const operatorSelects = wrapper.findAll('select')
    const filterInputs = wrapper.findAll('input[aria-label$="database.filterPlaceholder"]')
    const sortIcons = wrapper.findAll('svg[data-icon="ArrowDown"]')
    expect(operatorSelects).toHaveLength(2)
    expect((operatorSelects[0]!.element as HTMLSelectElement).value).toBe('>=')
    expect((operatorSelects[1]!.element as HTMLSelectElement).value).toBe('LIKE')
    expect((filterInputs[0]!.element as HTMLInputElement).value).toBe('10')
    expect((filterInputs[1]!.element as HTMLInputElement).value).toBe('Ada')
    expect(sortIcons.length).toBeGreaterThan(0)
    expect(wrapper.html()).toContain('data-icon="ArrowDown"')

    wrapper.unmount()
  })

  it('缺少显式 filterOperators 时从 whereClause 推导操作符并禁用 NULL 输入框', async () => {
    const wrapper = mountQueryResult({
      tableBrowse: {
      database: 'demo',
      table: 'users',
      currentPage: 1,
      pageSize: 200,
      whereClause: "`name` IN ('Ada', 'Linus') AND `id` IS NULL",
      },
    })

    await flushPromises()

    await wrapper.findAll('button').find(btn => btn.text().includes('database.filter'))?.trigger('click')
    await wrapper.setProps({
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
        whereClause: "`name` IN ('Ada', 'Linus') AND `id` IS NULL",
        showFilters: true,
      },
    })
    await flushPromises()

    const operatorSelects = wrapper.findAll('select')
    const filterInputs = wrapper.findAll('input[aria-label$="database.filterPlaceholder"]')

    expect((operatorSelects[0]!.element as HTMLSelectElement).value).toBe('IS NULL')
    expect((operatorSelects[1]!.element as HTMLSelectElement).value).toBe('IN')
    expect((filterInputs[0]!.element as HTMLInputElement).disabled).toBe(true)
    expect((filterInputs[0]!.element as HTMLInputElement).value).toBe('')
    expect((filterInputs[1]!.element as HTMLInputElement).value).toBe('Ada, Linus')

    wrapper.unmount()
  })

  it('同表结果刷新时不重置 tableBrowse 回填的显示态，避免筛选面板与图表视图闪回默认值', async () => {
    const wrapper = mountQueryResult({
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
        whereClause: "`name` LIKE '%Ada%'",
        filterOperators: { name: 'LIKE' },
        showFilters: true,
        showChart: true,
        selectedRowIndex: 1,
        rowDetailOpen: true,
        pinnedColumns: {
          left: ['id'],
          right: [],
        },
      },
    })

    await flushPromises()

    await wrapper.setProps({
      result: {
        ...makeResult(),
        executionTimeMs: 12,
      },
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
        whereClause: "`name` LIKE '%Ada%'",
        filterOperators: { name: 'LIKE' },
        showFilters: true,
        showChart: true,
        selectedRowIndex: 1,
        rowDetailOpen: true,
        pinnedColumns: {
          left: ['id'],
          right: [],
        },
      },
    })
    await flushPromises()

    const filterInputs = wrapper.findAll('input[aria-label$="database.filterPlaceholder"]')
    expect(filterInputs.length).toBeGreaterThan(0)
    expect((filterInputs[1]!.element as HTMLInputElement).value).toBe('Ada')
    expect(wrapper.text()).toContain('配置图表')
    expect(wrapper.text()).toContain('取消固定')

    wrapper.unmount()
  })

  it('表浏览结果区固定列时同步 pinnedColumns，避免切 tab 后丢失列布局偏好', async () => {
    const wrapper = mountQueryResult({
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
        pinnedColumns: {
          left: ['id'],
          right: [],
        },
      },
    })

    await flushPromises()

    const pinButtons = wrapper.findAll('button').filter(btn => btn.text().includes('固定到左侧'))
    expect(pinButtons.length).toBeGreaterThan(0)

    await pinButtons[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('syncTableBrowse')?.[0]).toEqual([{ pinnedColumns: { left: ['id', 'name'], right: [] } }])

    await wrapper.setProps({
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
        pinnedColumns: {
          left: ['id', 'name'],
          right: [],
        },
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('取消固定')

    const unpinButtons = wrapper.findAll('button').filter(btn => btn.text().includes('取消固定'))
    expect(unpinButtons.length).toBeGreaterThan(0)

    await unpinButtons[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('syncTableBrowse')?.[1]).toEqual([{ pinnedColumns: { left: ['name'], right: [] } }])

    wrapper.unmount()
  })

  it('表浏览结果区打开详情后按导航同步行状态，避免重建后丢失定位', async () => {
    const wrapper = mountQueryResult({
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
        selectedRowIndex: 1,
        rowDetailOpen: true,
      },
    })

    await flushPromises()

    await wrapper.findComponent({ name: 'RowDetailSheet' }).vm.$emit('update:open', false)
    await flushPromises()
    expect(wrapper.emitted('syncTableBrowse')?.[0]).toEqual([{ selectedRowIndex: 1, rowDetailOpen: false }])

    await wrapper.setProps({
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
        selectedRowIndex: 1,
        rowDetailOpen: true,
      },
    })
    await flushPromises()

    await wrapper.findComponent({ name: 'RowDetailSheet' }).vm.$emit('navigate', 'next')
    await flushPromises()
    expect(wrapper.emitted('syncTableBrowse')?.[1]).toEqual([{ selectedRowIndex: 1, rowDetailOpen: true }])

    wrapper.unmount()
  })

  it('表浏览结果区切换图表视图时同步 showChart，避免切 tab 后丢失当前视图', async () => {
    const wrapper = mountQueryResult({
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
        showChart: false,
      },
    })

    await flushPromises()

    const buttons = wrapper.findAll('button')
    const tableButton = buttons.find(btn => btn.text().includes('表格数据'))
    const chartButton = buttons.find(btn => btn.text().includes('可视化分析'))
    expect(tableButton).toBeTruthy()
    expect(chartButton).toBeTruthy()

    await chartButton!.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('syncTableBrowse')?.[0]).toEqual([{ showChart: true }])

    await wrapper.setProps({
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
        showChart: true,
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('配置图表')

    await tableButton!.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('syncTableBrowse')?.[1]).toEqual([{ showChart: false }])

    wrapper.unmount()
  })

  it('切换结果区筛选面板时发出 tableBrowse 显示态同步事件', async () => {
    const wrapper = mountQueryResult({
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
        showFilters: false,
      },
    })

    await flushPromises()

    const filterButton = wrapper.findAll('button').find(btn => btn.text().includes('database.filter'))
    expect(filterButton).toBeTruthy()

    await filterButton!.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('syncTableBrowse')?.[0]).toEqual([{ showFilters: true }])

    await filterButton!.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('syncTableBrowse')?.[1]).toEqual([{ showFilters: false }])

    wrapper.unmount()
  })

  it('关闭筛选面板时仅同步显示态，不清空 tableBrowse 中已有服务端筛选条件', async () => {
    const wrapper = mountQueryResult({
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
        whereClause: "`name` LIKE '%Ada%'",
        filterOperators: { name: 'LIKE' },
        showFilters: true,
      },
    })

    await flushPromises()

    const filterButton = wrapper.findAll('button').find(btn => btn.text().includes('database.filter'))
    expect(filterButton).toBeTruthy()

    await filterButton!.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('syncTableBrowse')?.[0]).toEqual([{ showFilters: false }])
    expect(wrapper.emitted('serverFilter')).toBeUndefined()

    wrapper.unmount()
  })

  it('同一列统计重复展开时复用缓存，避免重复计算统计结果', async () => {
    const wrapper = mountQueryResult()
    await flushPromises()

    const statsTriggers = wrapper.findAll('button').filter(btn => btn.text().includes('列统计'))
    expect(statsTriggers.length).toBeGreaterThan(0)

    await statsTriggers[0]!.trigger('click')
    await flushPromises()
    expect(computeColumnStatsAsyncMock).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('总计')

    await statsTriggers[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('总计')

    await statsTriggers[0]!.trigger('click')
    await flushPromises()
    expect(computeColumnStatsAsyncMock).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('总计')

    wrapper.unmount()
  })

  it('单击单元格不会自动复制，只有显式点击复制按钮才会复制建议 SQL', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    })

    const wrapper = mountQueryResult({
      result: {
        columns: [
          { name: 'id', dataType: 'INT', nullable: false },
          { name: 'name', dataType: 'VARCHAR', nullable: true },
        ],
        rows: [
          [10, 'Ada'],
          [11, 'Linus'],
        ],
        affectedRows: 0,
        executionTimeMs: 5,
        isError: true,
        error: 'sql error',
        totalCount: null,
        truncated: false,
        tableName: 'users',
      },
    })

    await flushPromises()

    await wrapper.findAll('button')[0]?.trigger('click')
    await flushPromises()

    expect(writeTextMock).not.toHaveBeenCalled()

    await wrapper.setProps({
      sqlErrorAnalysis: {
        loading: false,
        summary: '字段名错误',
        fixSql: 'SELECT * FROM users;',
      },
    })
    await flushPromises()

    const copyButton = wrapper.findAll('button').find(btn => btn.text().includes('复制'))
    expect(copyButton).toBeTruthy()

    await copyButton!.trigger('click')
    await flushPromises()

    expect(writeTextMock).toHaveBeenCalledWith('SELECT * FROM users;')

    wrapper.unmount()
  })

  it('结果区重建时复用共享主键状态来源，不再各自维护独立查询状态', async () => {
    const wrapperA = mountQueryResult()
    await flushPromises()

    const wrapperB = mountQueryResult()
    await flushPromises()

    expect(usePrimaryKeysMock).toHaveBeenCalledTimes(2)
    expect(usePrimaryKeysMock.mock.results[0]?.value).toBe(usePrimaryKeysMock.mock.results[1]?.value)

    primaryKeysState.pkLoading.value = true
    primaryKeysState.primaryKeys.value = ['loading_pk']
    await wrapperA.vm.$forceUpdate()
    await wrapperB.vm.$forceUpdate()
    await flushPromises()
    expect(wrapperA.text()).toContain('PK: loading_pk')
    expect(wrapperB.text()).toContain('PK: loading_pk')

    primaryKeysState.pkLoading.value = false
    primaryKeysState.primaryKeys.value = ['order_id', 'line_no']
    await wrapperA.vm.$forceUpdate()
    await wrapperB.vm.$forceUpdate()
    await flushPromises()
    expect(wrapperA.text()).toContain('PK: order_id, line_no')
    expect(wrapperB.text()).toContain('PK: order_id, line_no')

    wrapperA.unmount()
    wrapperB.unmount()
  })

  it('表浏览导出复用 tableBrowse 中的筛选排序与 seek 状态，避免重新按默认条件导出', async () => {
    const saveMock = vi.mocked(await import('@tauri-apps/plugin-dialog')).save
    saveMock.mockResolvedValue('/tmp/users.sql')

    const getTableDataMock = vi.mocked(dbGetTableData)
    getTableDataMock.mockResolvedValueOnce({
      columns: [
        { name: 'id', dataType: 'INT', nullable: false },
        { name: 'name', dataType: 'VARCHAR', nullable: true },
      ],
      rows: [[30, 'Ada'], [31, 'Linus']],
      affectedRows: 0,
      executionTimeMs: 3,
      isError: false,
      error: null,
      totalCount: 4,
      truncated: false,
      tableName: 'users',
    })

    vi.mocked(dbGenerateScript).mockResolvedValue('CREATE TABLE `users` (`id` int);')
    vi.mocked(writeTextFile).mockResolvedValue(undefined)

    const wrapper = mountQueryResult({
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 2,
        pageSize: 100,
        whereClause: "`name` LIKE '%Ada%'",
        orderBy: undefined,
        seekOrderBy: 'id ASC',
        seekColumn: 'id',
        seekValue: 20,
      },
      result: {
        columns: [
          { name: 'id', dataType: 'INT', nullable: false },
          { name: 'name', dataType: 'VARCHAR', nullable: true },
        ],
        rows: [[21, 'Ada'], [22, 'Ada Byron']],
        affectedRows: 0,
        executionTimeMs: 8,
        isError: false,
        error: null,
        totalCount: 4,
        truncated: false,
        tableName: 'users',
      },
    })

    await flushPromises()

    const exportButton = wrapper.findAll('button').find(btn => btn.text().includes('SQL脚本'))
    expect(exportButton).toBeTruthy()

    await exportButton!.trigger('click')
    await flushPromises()

    expect(getTableDataMock).toHaveBeenCalledWith(
      'conn-1',
      'demo',
      'users',
      1,
      1000,
      "`name` LIKE '%Ada%'",
      'id ASC',
      'id',
      20,
    )
    expect(writeTextFile).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('服务端筛选条件变更后按最新 tableBrowse 回填输入态，且 load more 不重置筛选排序显示', async () => {
    const wrapper = mountQueryResult({
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
        whereClause: "`name` LIKE '%Ada%'",
        orderBy: '`id` DESC',
        filterOperators: { name: 'LIKE' },
      },
    })

    await flushPromises()

    await wrapper.findAll('button').find(btn => btn.text().includes('database.filter'))?.trigger('click')
    await wrapper.setProps({
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
        whereClause: "`name` LIKE '%Ada%'",
        orderBy: '`id` DESC',
        filterOperators: { name: 'LIKE' },
        showFilters: true,
      },
    })
    await flushPromises()

    let operatorSelects = wrapper.findAll('select')
    let filterInputs = wrapper.findAll('input[aria-label$="database.filterPlaceholder"]')
    expect((operatorSelects[1]!.element as HTMLSelectElement).value).toBe('LIKE')
    expect((filterInputs[1]!.element as HTMLInputElement).value).toBe('Ada')
    expect(wrapper.html()).toContain('data-icon="ArrowDown"')

    await wrapper.setProps({
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
        whereClause: "`id` >= '10' AND `name` LIKE '%Ada Lovelace%'",
        orderBy: '`name` ASC',
        filterOperators: { id: '>=', name: 'LIKE' },
        showFilters: true,
      },
      result: {
        columns: [
          { name: 'id', dataType: 'INT', nullable: false },
          { name: 'name', dataType: 'VARCHAR', nullable: true },
        ],
        rows: [
          [10, 'Ada Lovelace'],
          [11, 'Ada Byron'],
          [12, 'Ada Lovelace'],
        ],
        affectedRows: 0,
        executionTimeMs: 8,
        isError: false,
        error: null,
        totalCount: 5,
        truncated: false,
        tableName: 'users',
      },
    })
    await flushPromises()

    operatorSelects = wrapper.findAll('select')
    filterInputs = wrapper.findAll('input[aria-label$="database.filterPlaceholder"]')
    expect((operatorSelects[0]!.element as HTMLSelectElement).value).toBe('>=')
    expect((operatorSelects[1]!.element as HTMLSelectElement).value).toBe('LIKE')
    expect((filterInputs[0]!.element as HTMLInputElement).value).toBe('10')
    expect((filterInputs[1]!.element as HTMLInputElement).value).toBe('Ada Lovelace')
    expect(wrapper.html()).toContain('data-icon="ArrowUp"')

    await wrapper.vm.$emit('loadMore')
    await flushPromises()

    expect(wrapper.emitted('loadMore')).toHaveLength(1)
    expect((wrapper.findAll('input[aria-label$="database.filterPlaceholder"]')[0]!.element as HTMLInputElement).value).toBe('10')
    expect((wrapper.findAll('input[aria-label$="database.filterPlaceholder"]')[1]!.element as HTMLInputElement).value).toBe('Ada Lovelace')
    expect(wrapper.html()).toContain('data-icon="ArrowUp"')
    expect(wrapper.text()).toContain('3')

    wrapper.unmount()
  })
})
