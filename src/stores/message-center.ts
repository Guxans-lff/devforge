import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type MessageType = 'success' | 'error' | 'warning' | 'info' | 'loading' | 'progress'

export interface MessageAction {
  label: string
  action: () => void
  variant?: 'default' | 'primary' | 'destructive'
}

export interface Message {
  id: string
  type: MessageType
  title: string
  description?: string
  timestamp: number
  read: boolean
  // 进度通知
  progress?: number  // 0-100
  // 可操作通知
  actions?: MessageAction[]
  // 持久通知（不自动消失）
  persistent?: boolean
  // 自动关闭时间（毫秒）
  autoClose?: number
}

export const useMessageCenterStore = defineStore('message-center', () => {
  const messages = ref<Message[]>([])
  const isOpen = ref(false)
  // 管理 autoClose 定时器引用，支持取消
  const autoCloseTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const unreadCount = computed(() => {
    return messages.value.filter(m => !m.read).length
  })

  function addMessage(msg: Omit<Message, 'id' | 'timestamp' | 'read'>) {
    const message: Message = {
      ...msg,
      id: `${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      read: false,
    }
    const next = [message, ...messages.value]
    messages.value = next.length > 100 ? next.slice(0, 100) : next

    // 自动关闭非持久通知（保存定时器引用以支持取消）
    if (!message.persistent && message.autoClose) {
      const timer = setTimeout(() => {
        autoCloseTimers.delete(message.id)
        deleteMessage(message.id)
      }, message.autoClose)
      autoCloseTimers.set(message.id, timer)
    }

    return message.id
  }

  function updateMessage(id: string, updates: Partial<Message>) {
    messages.value = messages.value.map(m =>
      m.id === id ? { ...m, ...updates } : m
    )
  }

  function updateProgress(id: string, progress: number) {
    updateMessage(id, { progress })
  }

  function markAsRead(id: string) {
    messages.value = messages.value.map(m =>
      m.id === id ? { ...m, read: true } : m
    )
  }

  function markAllAsRead() {
    messages.value = messages.value.map(m => m.read ? m : { ...m, read: true })
  }

  function deleteMessage(id: string) {
    // 清理该消息的 autoClose 定时器
    const timer = autoCloseTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      autoCloseTimers.delete(id)
    }
    messages.value = messages.value.filter(m => m.id !== id)
  }

  function clearAll() {
    // 清理所有 autoClose 定时器
    for (const timer of autoCloseTimers.values()) {
      clearTimeout(timer)
    }
    autoCloseTimers.clear()
    messages.value = []
  }

  function togglePanel() {
    isOpen.value = !isOpen.value
    if (isOpen.value) {
      markAllAsRead()
    }
  }

  return {
    messages,
    isOpen,
    unreadCount,
    addMessage,
    updateMessage,
    updateProgress,
    markAsRead,
    markAllAsRead,
    deleteMessage,
    clearAll,
    togglePanel,
  }
})

/**
 * 便捷的消息通知 Hook
 * 提供类似 message.success('...') 的链式调用 API
 */
export function useMessage() {
  const store = useMessageCenterStore()

  const notify = (type: MessageType, title: string, description?: string, autoClose = 3000) => {
    return store.addMessage({
      type,
      title,
      description,
      autoClose: type === 'loading' ? undefined : autoClose,
      persistent: type === 'loading'
    })
  }

  return {
    success: (title: string, description?: string) => notify('success', title, description),
    error: (title: string, description?: string) => notify('error', title, description),
    warning: (title: string, description?: string) => notify('warning', title, description),
    info: (title: string, description?: string) => notify('info', title, description),
    loading: (title: string, description?: string) => notify('loading', title, description),
    /** 这里的 id 可以用于之后的手动删除或更新 */
    add: store.addMessage,
    remove: store.deleteMessage,
  }
}
