import { useMessageCenterStore } from '@/stores/message-center'

export function useToast() {
  const messageCenter = useMessageCenterStore()

  return {
    success(message: string, description?: string) {
      messageCenter.addMessage({ type: 'success', title: message, description })
    },
    error(message: string, description?: string) {
      messageCenter.addMessage({ type: 'error', title: message, description })
    },
    warning(message: string, description?: string) {
      messageCenter.addMessage({ type: 'warning', title: message, description })
    },
    info(message: string, description?: string) {
      messageCenter.addMessage({ type: 'info', title: message, description })
    },
    loading(message: string, description?: string) {
      messageCenter.addMessage({ type: 'loading', title: message, description })
    },
    dismiss(_id?: string | number) {
      // no-op, messages managed by message center
    },
    promise<T>(
      promise: Promise<T>,
      opts: { loading: string; success: string; error: string }
    ) {
      const loadingId = messageCenter.addMessage({ type: 'loading', title: opts.loading, persistent: true })
      return promise.then(
        (result) => {
          messageCenter.updateMessage(loadingId, { type: 'success', title: opts.success, persistent: false, autoClose: 3000 })
          // 手动设置 autoClose 定时器（updateMessage 不会自动触发）
          setTimeout(() => messageCenter.deleteMessage(loadingId), 3000)
          return result
        },
        (err) => {
          messageCenter.updateMessage(loadingId, { type: 'error', title: opts.error, persistent: false, autoClose: 5000 })
          setTimeout(() => messageCenter.deleteMessage(loadingId), 5000)
          throw err
        },
      )
    },
  }
}
