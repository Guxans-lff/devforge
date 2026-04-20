import { parseFileMarkers } from '@/utils/file-markers'
import type { ContentBlock } from '@/types/ai'

export function containsImages(content: string): boolean {
  return /<file\s+[^>]*type="image"[^>]*>/i.test(content)
}

export function parseContentBlocks(content: string): ContentBlock[] {
  const segments = parseFileMarkers(content)
  const blocks: ContentBlock[] = []

  for (const segment of segments) {
    if (segment.type === 'text') {
      if (segment.content.trim()) {
        blocks.push({ type: 'text', text: segment.content })
      }
    } else if (segment.type === 'file' && segment.fileType === 'image') {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: inferMediaType(segment.name),
          data: extractBase64Data(segment.content),
        },
      })
    }
  }

  return blocks
}

export function inferMediaType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop()
  const typeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  }
  return typeMap[ext || ''] || 'image/jpeg'
}

export function extractBase64Data(dataUrl: string): string {
  const matches = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/)
  return matches?.[1] || dataUrl
}
