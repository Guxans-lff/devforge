<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  RefreshCw,
  FolderPlus,
  Star,
  StarOff,
  HardDrive,
  Home,
  Download,
  FolderOpen,
} from 'lucide-vue-next'
import { getAvailableDrives } from '@/api/sftp'

const props = defineProps<{
  currentPath: string
  isRemote: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  navigate: [path: string]
  goUp: []
  refresh: []
  mkdir: []
}>()

const { t } = useI18n()
const pathInput = ref(props.currentPath)
const showDropdown = ref(false)
const showBookmarksDropdown = ref(false)
const availableDrives = ref<string[]>([])

// Navigation history
const history = ref<string[]>([props.currentPath])
const historyIndex = ref(0)
let navigatingFromHistory = false

// Bookmarks (stored in localStorage)
const bookmarksKey = computed(() => `pathbar_bookmarks_${props.isRemote ? 'remote' : 'local'}`)
const bookmarks = ref<Array<{ path: string; label: string }>>(loadBookmarks())

function loadBookmarks() {
  try {
    const saved = localStorage.getItem(bookmarksKey.value)
    return saved ? JSON.parse(saved) : []
  } catch {
    return []
  }
}

function saveBookmarks() {
  localStorage.setItem(bookmarksKey.value, JSON.stringify(bookmarks.value))
}

// Watch for external path changes
watch(() => props.currentPath, (newPath) => {
  pathInput.value = newPath

  // Skip history tracking when navigating via back/forward buttons
  if (navigatingFromHistory) {
    navigatingFromHistory = false
    return
  }

  // Add to history if it's a new path
  if (history.value[historyIndex.value] !== newPath) {
    // Remove any forward history
    history.value = history.value.slice(0, historyIndex.value + 1)
    // Add new path
    history.value.push(newPath)
    historyIndex.value = history.value.length - 1

    // Limit history to 50 items
    if (history.value.length > 50) {
      history.value.shift()
      historyIndex.value--
    }
  }
})

// Load available drives on mount (for local panel only)
onMounted(async () => {
  if (!props.isRemote) {
    try {
      availableDrives.value = await getAvailableDrives()
    } catch {
      // drives detection failed — bookmarks will still work
    }
  }
})

// Quick access locations for local
const localQuickAccess = computed(() => {
  const locations = []

  // Windows specific
  if (navigator.platform.includes('Win')) {
    locations.push(
      { icon: Home, label: t('fileManager.desktop'), path: 'C:\\Users\\Public\\Desktop' },
      { icon: Download, label: t('fileManager.downloads'), path: 'C:\\Users\\Public\\Downloads' },
      { icon: FolderOpen, label: t('fileManager.documents'), path: 'C:\\Users\\Public\\Documents' },
    )
    // Add actual available drives
    for (const drive of availableDrives.value) {
      // Ensure drive path ends with backslash (e.g. "D:" -> "D:\")
      const drivePath = drive.endsWith('\\') || drive.endsWith('/') ? drive : `${drive}\\`
      locations.push({ icon: HardDrive, label: drive, path: drivePath })
    }
  } else {
    // Unix-like systems
    locations.push(
      { icon: Home, label: t('fileManager.home'), path: '~' },
      { icon: FolderOpen, label: t('fileManager.root'), path: '/' },
    )
    // Add mount points
    for (const mount of availableDrives.value) {
      locations.push({ icon: HardDrive, label: mount, path: mount })
    }
  }

  return locations
})

const canGoBack = computed(() => historyIndex.value > 0)
const canGoForward = computed(() => historyIndex.value < history.value.length - 1)
const isBookmarked = computed(() =>
  bookmarks.value.some(b => b.path === props.currentPath)
)

// Quick access for remote (common Unix paths)
const remoteQuickAccess = computed(() => [
  { icon: Home, label: t('fileManager.home'), path: '~' },
  { icon: FolderOpen, label: t('fileManager.root'), path: '/' },
  { icon: FolderOpen, label: '/var', path: '/var' },
  { icon: FolderOpen, label: '/etc', path: '/etc' },
  { icon: FolderOpen, label: '/tmp', path: '/tmp' },
])

const quickAccess = computed(() =>
  props.isRemote ? remoteQuickAccess.value : localQuickAccess.value
)

function handleSubmit() {
  emit('navigate', pathInput.value)
}

function handleQuickNavigate(path: string) {
  pathInput.value = path
  emit('navigate', path)
  showDropdown.value = false
}

function goBack() {
  if (canGoBack.value) {
    navigatingFromHistory = true
    historyIndex.value--
    const path = history.value[historyIndex.value]
    pathInput.value = path
    emit('navigate', path)
  }
}

function goForward() {
  if (canGoForward.value) {
    navigatingFromHistory = true
    historyIndex.value++
    const path = history.value[historyIndex.value]
    pathInput.value = path
    emit('navigate', path)
  }
}

function toggleBookmark() {
  const index = bookmarks.value.findIndex(b => b.path === props.currentPath)
  if (index >= 0) {
    // Remove bookmark
    bookmarks.value.splice(index, 1)
  } else {
    // Add bookmark
    const pathParts = props.currentPath.split(/[/\\]/).filter(Boolean)
    const label = pathParts[pathParts.length - 1] || props.currentPath
    bookmarks.value.push({ path: props.currentPath, label })
  }
  saveBookmarks()
}

function navigateToBookmark(path: string) {
  pathInput.value = path
  emit('navigate', path)
  showBookmarksDropdown.value = false
}

function removeBookmark(path: string, event: Event) {
  event.stopPropagation()
  const index = bookmarks.value.findIndex(b => b.path === path)
  if (index >= 0) {
    bookmarks.value.splice(index, 1)
    saveBookmarks()
  }
}
</script>

<template>
  <div class="flex items-center gap-1 border-b border-border px-2 py-1">
    <TooltipProvider :delay-duration="300">
      <!-- Back button -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7 shrink-0"
            :disabled="!canGoBack"
            @click="goBack"
          >
            <ChevronLeft class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent><p>{{ t('fileManager.back') }}</p></TooltipContent>
      </Tooltip>

      <!-- Forward button -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7 shrink-0"
            :disabled="!canGoForward"
            @click="goForward"
          >
            <ChevronRight class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent><p>{{ t('fileManager.forward') }}</p></TooltipContent>
      </Tooltip>

      <!-- Go up button -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7 shrink-0"
            @click="emit('goUp')"
          >
            <ArrowUp class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent><p>{{ t('fileManager.parentDir') }}</p></TooltipContent>
      </Tooltip>
    </TooltipProvider>

    <!-- Quick access dropdown -->
    <DropdownMenu v-model:open="showDropdown">
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7 shrink-0"
        >
          <ChevronDown class="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-56">
        <DropdownMenuItem
          v-for="location in quickAccess"
          :key="location.path"
          @click="handleQuickNavigate(location.path)"
        >
          <component :is="location.icon" class="mr-2 h-4 w-4" />
          <span>{{ location.label }}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <!-- Path input -->
    <form @submit.prevent="handleSubmit" class="flex-1 min-w-0">
      <Input
        v-model="pathInput"
        class="h-7 text-xs font-mono"
        :placeholder="t('fileManager.enterPath')"
      />
    </form>

    <TooltipProvider :delay-duration="300">
      <!-- Refresh button -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7 shrink-0"
            @click="emit('refresh')"
          >
            <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': loading }" />
          </Button>
        </TooltipTrigger>
        <TooltipContent><p>{{ t('fileManager.refresh') }}</p></TooltipContent>
      </Tooltip>

      <!-- New folder button -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7 shrink-0"
            @click="emit('mkdir')"
          >
            <FolderPlus class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent><p>{{ t('fileManager.newFolder') }}</p></TooltipContent>
      </Tooltip>

      <!-- Bookmark toggle -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7 shrink-0"
            :class="{ 'text-yellow-500': isBookmarked }"
            @click="toggleBookmark"
          >
            <Star v-if="isBookmarked" class="h-3.5 w-3.5 fill-current" />
            <Star v-else class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent><p>{{ t('fileManager.bookmark') }}</p></TooltipContent>
      </Tooltip>
    </TooltipProvider>

    <!-- Bookmarks dropdown -->
    <DropdownMenu v-model:open="showBookmarksDropdown">
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7 shrink-0"
        >
          <ChevronDown class="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-64">
        <DropdownMenuItem
          v-if="bookmarks.length === 0"
          disabled
          class="text-muted-foreground text-xs"
        >
          {{ t('fileManager.noBookmarks') }}
        </DropdownMenuItem>
        <template v-else>
          <DropdownMenuItem
            v-for="bookmark in bookmarks"
            :key="bookmark.path"
            @click="navigateToBookmark(bookmark.path)"
            class="flex items-center justify-between"
          >
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <FolderOpen class="h-4 w-4 shrink-0" />
              <div class="flex flex-col min-w-0">
                <span class="text-sm truncate">{{ bookmark.label }}</span>
                <span class="text-xs text-muted-foreground truncate">{{ bookmark.path }}</span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              class="h-6 w-6 shrink-0 ml-2"
              @click="removeBookmark(bookmark.path, $event)"
            >
              <StarOff class="h-3 w-3" />
            </Button>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
