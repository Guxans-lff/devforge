import { h } from 'vue'
import { toast } from 'vue-sonner'
import { CheckCircle2, XCircle, AlertTriangle, Info, Loader2 } from 'lucide-vue-next'

export function useToast() {
  return {
    success(message: string, description?: string) {
      toast.success(message, {
        description,
        icon: h(CheckCircle2, { class: 'h-4 w-4 text-green-500' }),
      })
    },
    error(message: string, description?: string) {
      toast.error(message, {
        description,
        icon: h(XCircle, { class: 'h-4 w-4 text-destructive' }),
      })
    },
    warning(message: string, description?: string) {
      toast.warning(message, {
        description,
        icon: h(AlertTriangle, { class: 'h-4 w-4 text-yellow-500' }),
      })
    },
    info(message: string, description?: string) {
      toast.info(message, {
        description,
        icon: h(Info, { class: 'h-4 w-4 text-blue-500' }),
      })
    },
    loading(message: string, description?: string) {
      return toast.loading(message, {
        description,
        icon: h(Loader2, { class: 'h-4 w-4 animate-spin text-muted-foreground' }),
      })
    },
    dismiss(id?: string | number) {
      toast.dismiss(id)
    },
    promise<T>(
      promise: Promise<T>,
      opts: { loading: string; success: string; error: string }
    ) {
      return toast.promise(promise, opts)
    },
  }
}
