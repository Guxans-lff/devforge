import { describe, it, expect } from 'vitest'

// 由于我们测试的是纯函数，先模拟这些函数
function containsImages(content: string): boolean {
  return /<file\s+[^>]*type="image"[^>]*>/i.test(content)
}

function inferMediaType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop()
  const typeMap: Record<string, string> = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp'
  }
  return typeMap[ext || ''] || 'image/jpeg'
}

function extractBase64Data(dataUrl: string): string {
  const matches = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/)
  return matches ? matches[1] : dataUrl
}

// 模拟 parseFileMarkers 函数（简化版本）
type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'file'; name: string; content: string; fileType?: 'text' | 'image' }

function parseFileMarkers(content: string): MessageSegment[] {
  const fileRegex = /<file\s+name="([^"]*?)"\s+[^>]*type="([^"]*?)"[^>]*>\s*(.*?)\s*<\/file>/gi
  const segments: MessageSegment[] = []

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = fileRegex.exec(content)) !== null) {
    // 前面的文本
    if (match.index > lastIndex) {
      const textPart = content.slice(lastIndex, match.index)
      if (textPart.trim()) {
        segments.push({ type: 'text', content: textPart })
      }
    }

    // 文件段落
    segments.push({
      type: 'file',
      name: match[1],
      content: match[3],
      fileType: match[2] as 'text' | 'image'
    })

    lastIndex = match.index + match[0].length
  }

  // 尾部文本
  if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex)
    if (remaining.trim()) {
      segments.push({ type: 'text', content: remaining })
    }
  }

  return segments.length > 0 ? segments : [{ type: 'text', content }]
}

// ContentBlock 类型定义
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

function parseContentBlocks(content: string): ContentBlock[] {
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
          data: extractBase64Data(segment.content)
        }
      })
    }
  }

  return blocks
}

describe('多模态消息处理', () => {
  it('应该检测出内容中包含图片', () => {
    const contentWithImage = 'Look at this: <file name="test.png" type="image">data:image/png;base64,abc</file>'
    expect(containsImages(contentWithImage)).toBe(true)

    const textOnly = 'This is just text'
    expect(containsImages(textOnly)).toBe(false)

    const textFileOnly = '<file name="config.json" type="text">{"key":"value"}</file>'
    expect(containsImages(textFileOnly)).toBe(false)
  })

  it('应该正确解析混合内容', () => {
    const content = 'Analyze this image: <file name="chart.png" type="image">data:image/png;base64,iVBORw0KG</file> What do you see?'
    const blocks = parseContentBlocks(content)

    expect(blocks).toHaveLength(3)

    // 第一个文本块
    expect(blocks[0]).toEqual({
      type: 'text',
      text: 'Analyze this image: '
    })

    // 图片块
    expect(blocks[1].type).toBe('image')
    if (blocks[1].type === 'image') {
      expect(blocks[1].source.type).toBe('base64')
      expect(blocks[1].source.media_type).toBe('image/png')
      expect(blocks[1].source.data).toBe('iVBORw0KG')
    }

    // 第二个文本块
    expect(blocks[2]).toEqual({
      type: 'text',
      text: ' What do you see?'
    })
  })

  it('应该推断正确的媒体类型', () => {
    expect(inferMediaType('photo.jpg')).toBe('image/jpeg')
    expect(inferMediaType('photo.jpeg')).toBe('image/jpeg')
    expect(inferMediaType('diagram.png')).toBe('image/png')
    expect(inferMediaType('animation.gif')).toBe('image/gif')
    expect(inferMediaType('modern.webp')).toBe('image/webp')
    expect(inferMediaType('unknown.bmp')).toBe('image/jpeg') // 默认值
  })

  it('应该正确提取 base64 数据', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA'
    expect(extractBase64Data(dataUrl)).toBe('iVBORw0KGgoAAAANSUhEUgAA')

    // 如果不是标准 data URL 格式，直接返回原值
    const plainData = 'iVBORw0KGgoAAAANSUhEUgAA'
    expect(extractBase64Data(plainData)).toBe('iVBORw0KGgoAAAANSUhEUgAA')
  })

  it('应该处理只有文本的内容', () => {
    const content = 'This is a simple text message without any files.'
    const blocks = parseContentBlocks(content)

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({
      type: 'text',
      text: 'This is a simple text message without any files.'
    })
  })

  it('应该处理只有图片的内容', () => {
    const content = '<file name="screenshot.png" type="image">data:image/png;base64,ABCD1234</file>'
    const blocks = parseContentBlocks(content)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('image')
    if (blocks[0].type === 'image') {
      expect(blocks[0].source.media_type).toBe('image/png')
      expect(blocks[0].source.data).toBe('ABCD1234')
    }
  })

  it('应该过滤掉空文本块', () => {
    const content = '   <file name="test.png" type="image">data:image/png;base64,ABC</file>   '
    const blocks = parseContentBlocks(content)

    // 空白文本应该被过滤掉，只留下图片块
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('image')
  })
})