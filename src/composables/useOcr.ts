/**
 * OCR 文字识别 composable
 * 基于 Tesseract.js (WASM) 实现前端 OCR
 * 支持中文(chi_sim) + 英文(eng)，可框选区域识别
 */
import { ref, shallowRef } from 'vue'
import { createWorker, type Worker, type LoggerMessage } from 'tesseract.js'

export interface OcrWord {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

export interface OcrLine {
  text: string
  confidence: number
  words: OcrWord[]
}

export interface OcrResult {
  text: string
  confidence: number
  lines: OcrLine[]
}

export function useOcr() {
  /** OCR Worker 实例（惰性初始化） */
  const worker = shallowRef<Worker | null>(null)

  /** 是否正在初始化 worker */
  const initializing = ref(false)

  /** 初始化完成通知（避免忙轮询） */
  let initPromise: Promise<Worker> | null = null

  /** 是否正在识别 */
  const recognizing = ref(false)

  /** 识别进度 (0-1) */
  const progress = ref(0)

  /** 最近一次识别结果 */
  const result = shallowRef<OcrResult | null>(null)

  /** 错误信息 */
  const error = ref<string | null>(null)

  /** 支持的语言包 */
  const languages = ['eng', 'chi_sim']

  /**
   * 初始化 Tesseract worker（首次调用耗时 ~2-3s，后续复用）
   */
  async function initWorker() {
    if (worker.value) return worker.value
    if (initPromise) return initPromise

    initializing.value = true
    error.value = null
    initPromise = (async () => {
      try {
        const w = await createWorker(languages, undefined, {
          logger: (m: LoggerMessage) => {
            if (m.status === 'recognizing text') {
              progress.value = m.progress
            }
          },
        })
        worker.value = w
        return w
      } catch (e) {
        error.value = `OCR 初始化失败: ${e}`
        initPromise = null
        throw e
      } finally {
        initializing.value = false
      }
    })()
    return initPromise
  }

  /**
   * 识别图片中的文字
   * @param image 图片源（base64 data URL、Blob、或 ImageData）
   * @param rectangle 可选：只识别指定区域
   */
  async function recognize(
    image: string | Blob | ImageData,
    rectangle?: { left: number; top: number; width: number; height: number },
  ): Promise<OcrResult> {
    recognizing.value = true
    progress.value = 0
    error.value = null
    result.value = null

    try {
      const w = await initWorker()
      const options = rectangle ? { rectangle } : {}
      const { data } = await w.recognize(image, options)

      const ocrResult: OcrResult = {
        text: data.text,
        confidence: data.confidence,
        lines: ((data as unknown as Record<string, unknown>).lines as Array<Record<string, unknown>> ?? []).map((line) => ({
          text: line.text as string,
          confidence: line.confidence as number,
          words: ((line.words as Array<Record<string, unknown>>) ?? []).map((word) => ({
            text: word.text as string,
            confidence: word.confidence as number,
            bbox: word.bbox as { x0: number; y0: number; x1: number; y1: number },
          })),
        })),
      }

      result.value = ocrResult
      return ocrResult
    } catch (e) {
      error.value = `识别失败: ${e}`
      throw e
    } finally {
      recognizing.value = false
      progress.value = 0
    }
  }

  /**
   * 图像预处理：灰度化 + 自适应反色 + 对比度增强
   * Tesseract 对黑底白字识别差，需要转为白底黑字
   */
  function preprocessForOcr(source: HTMLCanvasElement): HTMLCanvasElement {
    const w = source.width
    const h = source.height
    const srcCtx = source.getContext('2d')!
    const imageData = srcCtx.getImageData(0, 0, w, h)
    const data = imageData.data

    // 1. 灰度化 + 统计平均亮度
    const gray = new Uint8Array(w * h)
    let totalBrightness = 0
    for (let i = 0; i < gray.length; i++) {
      const r = data[i * 4]!
      const g = data[i * 4 + 1]!
      const b = data[i * 4 + 2]!
      // 加权灰度
      const v = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
      gray[i] = v
      totalBrightness += v
    }
    const avgBrightness = totalBrightness / gray.length

    // 2. 如果是深色背景（平均亮度 < 128），反色
    const invert = avgBrightness < 128
    if (invert) {
      for (let i = 0; i < gray.length; i++) {
        gray[i] = 255 - gray[i]!
      }
    }

    // 3. 写回 canvas（灰度图）
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    const outCtx = out.getContext('2d')!
    const outData = outCtx.createImageData(w, h)
    for (let i = 0; i < gray.length; i++) {
      const v = gray[i]!
      outData.data[i * 4] = v
      outData.data[i * 4 + 1] = v
      outData.data[i * 4 + 2] = v
      outData.data[i * 4 + 3] = 255
    }
    outCtx.putImageData(outData, 0, 0)
    return out
  }

  /**
   * 从 Canvas 导出指定区域为 Blob，用于 OCR 识别
   * 自动进行图像预处理（灰度化 + 反色）以提高识别率
   */
  async function recognizeFromCanvas(
    canvas: HTMLCanvasElement,
    rect?: { x: number; y: number; w: number; h: number },
  ): Promise<OcrResult> {
    // 如果指定了区域，先裁剪
    let source = canvas
    if (rect) {
      const tmpCanvas = document.createElement('canvas')
      tmpCanvas.width = rect.w
      tmpCanvas.height = rect.h
      const ctx = tmpCanvas.getContext('2d')!
      ctx.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h)
      source = tmpCanvas
    }

    // 预处理：灰度化 + 自适应反色
    const processed = preprocessForOcr(source)

    const blob = await new Promise<Blob>((resolve) =>
      processed.toBlob((b) => resolve(b!), 'image/png'),
    )
    return recognize(blob)
  }

  /**
   * 销毁 worker 释放资源
   */
  async function terminate() {
    if (worker.value) {
      await worker.value.terminate()
      worker.value = null
    }
  }

  return {
    // 状态
    initializing,
    recognizing,
    progress,
    result,
    error,
    // 操作
    recognize,
    recognizeFromCanvas,
    terminate,
  }
}
