import { useMessageCenterStore } from '@/stores/message-center'
import type { MessageType, MessageAction } from '@/stores/message-center'

export interface NotificationOptions {
  title: string
  description?: string
  type?: MessageType
  progress?: number
  actions?: MessageAction[]
  persistent?: boolean
  autoClose?: number
}

export function useNotification() {
  const messageCenter = useMessageCenterStore()

  function notify(options: NotificationOptions) {
    return messageCenter.addMessage({
      type: options.type || 'info',
      title: options.title,
      description: options.description,
      progress: options.progress,
      actions: options.actions,
      persistent: options.persistent,
      autoClose: options.autoClose,
    })
  }

  function success(title: string, description?: string, autoClose = 3000) {
    return notify({
      type: 'success',
      title,
      description,
      autoClose,
    })
  }

  function error(title: string, description?: string, persistent = false) {
    return notify({
      type: 'error',
      title,
      description,
      persistent,
    })
  }

  function warning(title: string, description?: string, autoClose = 5000) {
    return notify({
      type: 'warning',
      title,
      description,
      autoClose,
    })
  }

  function info(title: string, description?: string, autoClose = 3000) {
    return notify({
      type: 'info',
      title,
      description,
      autoClose,
    })
  }

  function loading(title: string, description?: string) {
    return notify({
      type: 'loading',
      title,
      description,
      persistent: true,
    })
  }

  function progress(title: string, initialProgress = 0, description?: string) {
    return notify({
      type: 'progress',
      title,
      description,
      progress: initialProgress,
      persistent: true,
    })
  }

  function updateProgress(id: string, progress: number) {
    messageCenter.updateProgress(id, progress)
  }

  function updateMessage(id: string, updates: Partial<NotificationOptions>) {
    messageCenter.updateMessage(id, updates)
  }

  function dismiss(id: string) {
    messageCenter.deleteMessage(id)
  }

  return {
    notify,
    success,
    error,
    warning,
    info,
    loading,
    progress,
    updateProgress,
    updateMessage,
    dismiss,
  }
}
