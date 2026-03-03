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
      messageCenter.addMessage({ type: 'loading', title: opts.loading })
      return promise.then(
        (result) => {
          messageCenter.addMessage({ type: 'success', title: opts.success })
          return result
        },
        (err) => {
          messageCenter.addMessage({ type: 'error', title: opts.error })
          throw err
        },
      )
    },
  }
}
