<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useConnectionStore } from '@/stores/connections'
import { useMessageCenterStore } from '@/stores/message-center'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Database,
  Terminal,
  FolderOpen,
  Settings,
  Home,
  X,
  Bell,
  Play,
  TerminalSquare,
  GitBranch,
  Camera,
  Cable,
  Container,
} from 'lucide-vue-next'
import type { TabType } from '@/types/workspace'
import { parseEnvironment } from '@/api/connection'
import { ENV_PRESETS } from '@/types/environment'
import MessageCenter from './MessageCenter.vue'

const workspace = useWorkspaceStore()
const connectionStore = useConnectionStore()
const messageCenter = useMessageCenterStore()
const { t } = useI18n()

const iconMap: Record<TabType, typeof Database> = {
  database: Database,
  terminal: Terminal,
  'file-manager': FolderOpen,
  settings: Settings,
  welcome: Home,
  'terminal-player': Play,
  'multi-exec': TerminalSquare,
  redis: Container,
  git: GitBranch,
  screenshot: Camera,
  tunnel: Cable,
}

function getTabIcon(type: TabType) {
  return iconMap[type] ?? Home
}

function handleMiddleClick(event: MouseEvent, tabId: string) {
  if (event.button === 1) {
    event.preventDefault()
    workspace.closeTab(tabId)
  }
}

// 右键菜单状态
const contextMenu = ref<{ visible: boolean; x: number; y: number; tabId: string }>({
  visible: false, x: 0, y: 0, tabId: '',
})

const contextTab = computed(() => workspace.tabs.find((t) => t.id === contextMenu.value.tabId))

function handleContextMenu(e: MouseEvent, tabId: string) {
  e.preventDefault()
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, tabId }
}

function closeContextMenu() {
  contextMenu.value = { ...contextMenu.value, visible: false }
}

function closeCurrentTab() {
  const tabId = contextMenu.value.tabId
  closeContextMenu()
  workspace.closeTab(tabId)
}

function closeOtherTabs() {
  const tabId = contextMenu.value.tabId
  closeContextMenu()
  const closable = workspace.tabs.filter((t) => t.id !== tabId && t.closable)
  for (const tab of closable) {
    workspace.closeTab(tab.id)
  }
}

function closeTabsToLeft() {
  const tabId = contextMenu.value.tabId
  closeContextMenu()
  const idx = workspace.tabs.findIndex((t) => t.id === tabId)
  if (idx <= 0) return
  const closable = workspace.tabs.slice(0, idx).filter((t) => t.closable)
  for (const tab of closable) {
    workspace.closeTab(tab.id)
  }
}

function closeTabsToRight() {
  const tabId = contextMenu.value.tabId
  closeContextMenu()
  const idx = workspace.tabs.findIndex((t) => t.id === tabId)
  if (idx < 0) return
  const closable = workspace.tabs.slice(idx + 1).filter((t) => t.closable)
  for (const tab of closable) {
    workspace.closeTab(tab.id)
  }
}

function closeAllTabs() {
  closeContextMenu()
  const closable = workspace.tabs.filter((t) => t.closable)
  for (const tab of closable) {
    workspace.closeTab(tab.id)
  }
}

/** 获取标签页对应连接的环境色，无环境则返回 null */
function getTabEnvironmentColor(tab: { type: TabType; connectionId?: string }): string | null {
  if (tab.type !== 'database' || !tab.connectionId) return null
  const conn = connectionStore.connections.get(tab.connectionId)
  if (!conn) return null
  const env = parseEnvironment(conn.record.configJson)
  if (!env) return null
  return ENV_PRESETS[env]?.color ?? null
}

// ===== Tab 滚动溢出处理 =====
const tabScrollRef = ref<HTMLDivElement | null>(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)

/** 检测是否存在溢出 */
function updateScrollState() {
  const el = tabScrollRef.value
  if (!el) return
  canScrollLeft.value = el.scrollLeft > 1
  canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}

/** 鼠标滚轮转换为水平滚动 */
function handleTabWheel(e: WheelEvent) {
  const el = tabScrollRef.value
  if (!el) return
  if (el.scrollWidth <= el.clientWidth) return
  e.preventDefault()
  el.scrollLeft += e.deltaY !== 0 ? e.deltaY : e.deltaX
}

/** 确保活跃 tab 可见 */
function scrollActiveTabIntoView() {
  nextTick(() => {
    const el = tabScrollRef.value
    if (!el) return
    const activeEl = el.querySelector('[aria-selected="true"]') as HTMLElement | null
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    }
    updateScrollState()
  })
}

// 标签变化时更新滚动状态 + 滚动到活跃标签
watch(() => workspace.tabs.length, scrollActiveTabIntoView)
watch(() => workspace.activeTabId, scrollActiveTabIntoView)

onMounted(() => {
  updateScrollState()
  const el = tabScrollRef.value
  if (el) el.addEventListener('scroll', updateScrollState, { passive: true })
})

onBeforeUnmount(() => {
  const el = tabScrollRef.value
  if (el) el.removeEventListener('scroll', updateScrollState)
})
</script>

<template>
  <nav :aria-label="t('tab.navigation')" class="relative z-[35] flex h-11 items-center bg-df-tabbar-bg select-none transition-colors duration-200">
    <!-- 底部固态基准线 (Base Foundation Line) -->
    <div class="absolute bottom-0 left-0 right-0 h-[1px] bg-foreground/5 dark:bg-white/5 z-0" />

    <!-- 左侧溢出渐变指示器 -->
    <div
      v-if="canScrollLeft"
      class="absolute left-0 top-0 bottom-0 w-8 z-20 pointer-events-none bg-gradient-to-r from-df-tabbar-bg to-transparent"
    />

    <div
      ref="tabScrollRef"
      class="flex-1 h-11 relative z-10 overflow-x-auto overflow-y-hidden tab-scroll-container"
      @wheel="handleTabWheel"
    >
      <div class="flex h-11 items-end px-2 pb-[1px]" role="tablist">
        <TooltipProvider :delay-duration="500">
          <Tooltip v-for="tab in workspace.tabs" :key="tab.id">
            <TooltipTrigger as-child>
              <button
                role="tab"
                :aria-selected="workspace.activeTabId === tab.id"
                :aria-label="tab.type === 'welcome' ? t('tab.homepage') : tab.title"
                class="tab-item group relative flex items-center h-[34px] transition-colors duration-200 px-6 mx-[1px] focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none focus-visible:z-10"
                :class="[
                  workspace.activeTabId === tab.id ? 'active' : 'inactive'
                ]"
                @click="workspace.setActiveTab(tab.id)"
                @mousedown="handleMiddleClick($event, tab.id)"
                @contextmenu="handleContextMenu($event, tab.id)"
              >
                <!-- 像素级 Chrome 背景层 (含动态环境色支持) -->
                <div 
                  class="tab-shape-container absolute inset-0 -z-10 pointer-events-none"
                  :class="{ 'is-active-shape': workspace.activeTabId === tab.id }"
                  :style="workspace.activeTabId === tab.id && getTabEnvironmentColor(tab) ? { '--env-color': getTabEnvironmentColor(tab)! } : {}"
                >
                  <div class="tab-shape-main" />
                </div>
                
                <div class="relative flex items-center gap-2 z-10">
                  <component 
                    :is="getTabIcon(tab.type)" 
                    class="h-3.5 w-3.5 shrink-0 transition-colors duration-300"
                    :class="workspace.activeTabId === tab.id ? 'text-foreground' : 'text-muted-foreground/50'"
                  />
                  
                  <div class="tab-title-container relative flex-1 min-w-0 max-w-[140px] overflow-hidden">
                    <span 
                      class="text-[11px] font-bold tracking-tight whitespace-nowrap transition-colors duration-200 block mt-[0.5px]"
                      :class="workspace.activeTabId === tab.id ? 'text-foreground' : 'text-muted-foreground/70'"
                    >
                      {{ tab.type === 'welcome' ? t('tab.homepage') : tab.title }}
                    </span>
                  </div>

                  <!-- Dirty indicator -->
                  <div v-if="tab.dirty" class="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.6)]" />

                  <!-- Close button -->
                  <button
                    v-if="tab.closable"
                    :aria-label="t('common.close')"
                    class="tab-close-btn ml-1 -mr-1.5 flex h-6 w-6 items-center justify-center rounded-full transition-[opacity,scale] duration-200"
                    @click.stop="workspace.closeTab(tab.id)"
                  >
                    <X class="h-2.5 w-2.5" />
                  </button>
                </div>

                <!-- 垂直分割线 (Vertical Separator) -->
                <div class="tab-separator absolute right-[-1px] top-1/2 -translate-y-1/2 w-[1px] h-3 bg-foreground/10 dark:bg-foreground/5 transition-opacity duration-200" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" class="text-[10px] font-bold">
              {{ tab.title }}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>

    <!-- 右侧溢出渐变指示器 -->
    <div
      v-if="canScrollRight"
      class="absolute right-[52px] top-0 bottom-0 w-8 z-20 pointer-events-none bg-gradient-to-l from-df-tabbar-bg to-transparent"
    />

    <!-- 右侧功能区 (Elevated for interaction) -->
    <div class="relative z-[100] flex h-full items-center gap-1 px-2 border-l border-black/[0.04] dark:border-white/5 shrink-0 bg-df-tabbar-action-bg">
      <!-- 消息中心按钮 -->
      <TooltipProvider :delay-duration="300">
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              :aria-label="t('tooltip.messageCenter')"
              class="relative flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground/60 transition-[background-color,color,scale] hover:bg-primary/10 hover:text-primary active:scale-90 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
              :class="{ 'bg-primary/15 text-primary': messageCenter.isOpen }"
              @click.stop="messageCenter.togglePanel()"
            >
              <Bell class="h-4 w-4" />
              <!-- 未读呼吸点 -->
              <div
                v-if="messageCenter.unreadCount > 0"
                class="absolute right-2 top-2 h-2 w-2 rounded-full border-2 border-background bg-destructive shadow-[0_0_4px_rgba(var(--color-destructive),0.5)]"
              >
                <div class="absolute inset-0 animate-ping rounded-full bg-destructive opacity-40"></div>
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" class="text-[11px] font-medium">{{ t('tooltip.messageCenter') }}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>

    <!-- Message Center Panel -->
    <MessageCenter />
  </nav>

  <!-- 右键菜单 -->
  <Teleport to="body">
    <div
      v-if="contextMenu.visible"
      class="fixed inset-0 z-50"
      @click="closeContextMenu"
      @contextmenu.prevent="closeContextMenu"
    />
    <div
      v-if="contextMenu.visible"
      class="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-md"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
    >
      <button
        class="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
        :disabled="!contextTab?.closable"
        :class="{ 'opacity-40 pointer-events-none': !contextTab?.closable }"
        @click="closeCurrentTab"
      >
        {{ t('common.close') }}
      </button>
      <button
        class="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
        @click="closeOtherTabs"
      >
        {{ t('innerTab.closeOthers') }}
      </button>
      <button
        class="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
        @click="closeTabsToLeft"
      >
        {{ t('innerTab.closeLeft') }}
      </button>
      <button
        class="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
        @click="closeTabsToRight"
      >
        {{ t('innerTab.closeRight') }}
      </button>
      <div class="my-1 h-px bg-border" />
      <button
        class="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
        @click="closeAllTabs"
      >
        {{ t('innerTab.closeAll') }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
@reference "tailwindcss";

.tab-item {
  position: relative;
  flex-shrink: 0;
  cursor: pointer;
  z-index: 10;
  margin-top: 7px; /* 预留顶部指示条空间并下压，使下沿贴底 */
  padding-bottom: 0px;
}

.tab-item.active {
  z-index: 30;
}

.tab-item.inactive:hover {
  z-index: 20;
}

/* Chrome 风格背景容器 */
.tab-shape-container {
  transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
  bottom: 0;
}

/* 活跃 Tab 的物理层级：稍微提升 z-index 确保覆盖边缘 */
.is-active-shape {
  z-index: 10;
}

.tab-shape-main {
  position: absolute;
  inset: 0;
  border-radius: 8px 8px 0 0;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 顶级设计师渐隐方案：仅在标题真正溢出时（> 110px）触发 30px 的高级淡出 */
.tab-title-container {
  mask-image: linear-gradient(to right, black 110px, transparent 140px);
  -webkit-mask-image: linear-gradient(to right, black 110px, transparent 140px);
}

/* 分割线逻辑 (Separator Logic) */
.tab-separator {
  opacity: 0.4; /* 降噪处理：幽灵虚线级显现 */
}

/* 当自身活跃、或是下一个标签活跃时，隐藏右侧分割线 */
.tab-item.active .tab-separator,
.tab-item:has(+ .tab-item.active) .tab-separator,
.tab-item:last-child .tab-separator {
  opacity: 0;
}

/* 活跃状态：物理一体化同步 (打开式) */
.active .tab-shape-main {
  background-color: var(--background);
  bottom: -1.5px; /* 物理沉降：刺穿底线 */
}


.dark .active .tab-shape-main {
  background-color: var(--background);
}

.active .tab-shape-container::before,
.active .tab-shape-container::after {
  content: "";
  position: absolute;
  bottom: -1.5px; /* 同步沉降 */
  width: 12px;
  height: 12px;
  background-color: var(--background);
  pointer-events: none;
}


.dark .active .tab-shape-container::before,
.dark .active .tab-shape-container::after {
  background-color: var(--background);
}

.active .tab-shape-container::before {
  left: -12px;
  mask: radial-gradient(circle at 0 0, transparent 12px, black 12.5px);
  -webkit-mask: radial-gradient(circle at 0 0, transparent 12px, black 12.5px);
}

.active .tab-shape-container::after {
  right: -12px;
  mask: radial-gradient(circle at 12px 0, transparent 12px, black 12.5px);
  -webkit-mask: radial-gradient(circle at 12px 0, transparent 12px, black 12.5px);
}

/* 悬浮状态：精致胶囊背景 (Pill Style) */
.inactive:hover .tab-shape-main {
  background-color: color-mix(in srgb, black, transparent 94%);
  inset: 2px 4px 4px 4px;
  border-radius: 6px;
}

.dark .inactive:hover .tab-shape-main {
  background-color: color-mix(in srgb, white, transparent 92%);
}

/* 关闭按钮专业化 */
.tab-close-btn {
  @apply opacity-0 scale-75;
  color: color-mix(in srgb, var(--foreground), transparent 80%);
}

.tab-close-btn:hover {
  background-color: color-mix(in srgb, black, transparent 95%);
  color: color-mix(in srgb, var(--foreground), transparent 40%);
}

.dark .tab-close-btn:hover {
  background-color: color-mix(in srgb, white, transparent 90%);
}

.active .tab-close-btn {
  @apply opacity-40 scale-100;
}

.tab-item:hover .tab-close-btn {
  @apply opacity-100 scale-100;
}

/* 滚动条：完全隐藏，依靠鼠标滚轮横滚 + 两侧渐变指示器导航 */
.tab-scroll-container {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.tab-scroll-container::-webkit-scrollbar {
  display: none;
}
</style>
