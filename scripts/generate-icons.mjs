/**
 * DevForge 闪电图标生成脚本
 * 生成 Tauri 需要的所有尺寸图标
 */
import { execSync } from 'child_process'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const ICONS_DIR = join(ROOT, 'src-tauri', 'icons')

// DevForge 闪电 SVG — 深色背景 + 蓝紫主色调闪电
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1a2e"/>
      <stop offset="100%" stop-color="#16213e"/>
    </linearGradient>
    <linearGradient id="bolt" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="#7c6fff"/>
      <stop offset="50%" stop-color="#5b8cff"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>
  <!-- 圆角矩形背景 -->
  <rect width="512" height="512" rx="108" fill="url(#bg)"/>
  <!-- 内部微妙边框 -->
  <rect x="4" y="4" width="504" height="504" rx="104" fill="none" stroke="#ffffff08" stroke-width="2"/>
  <!-- 闪电 glow -->
  <path d="M280 56 L168 264 L248 264 L216 456 L360 224 L272 224 L312 56 Z"
        fill="#5b8cff" opacity="0.15" filter="url(#glow)" transform="translate(2,2)"/>
  <!-- 闪电主体 -->
  <path d="M280 56 L168 264 L248 264 L216 456 L360 224 L272 224 L312 56 Z"
        fill="url(#bolt)"/>
  <!-- 闪电高光 -->
  <path d="M280 56 L168 264 L248 264 L216 456 L360 224 L272 224 L312 56 Z"
        fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2"/>
</svg>`

// 需要生成的尺寸列表
const sizes = [
  { name: '32x32.png', size: 32 },
  { name: '128x128.png', size: 128 },
  { name: '128x128@2x.png', size: 256 },
  { name: 'icon.png', size: 512 },
  // Windows Store logos
  { name: 'Square30x30Logo.png', size: 30 },
  { name: 'Square44x44Logo.png', size: 44 },
  { name: 'Square71x71Logo.png', size: 71 },
  { name: 'Square89x89Logo.png', size: 89 },
  { name: 'Square107x107Logo.png', size: 107 },
  { name: 'Square142x142Logo.png', size: 142 },
  { name: 'Square150x150Logo.png', size: 150 },
  { name: 'Square284x284Logo.png', size: 284 },
  { name: 'Square310x310Logo.png', size: 310 },
  { name: 'StoreLogo.png', size: 50 },
]

async function main() {
  // 动态导入 sharp
  let sharp
  try {
    sharp = (await import('sharp')).default
  } catch {
    console.log('安装 sharp...')
    execSync('pnpm add -D sharp', { cwd: ROOT, stdio: 'inherit' })
    sharp = (await import('sharp')).default
  }

  // 写入 SVG 临时文件
  const svgPath = join(ICONS_DIR, '_temp.svg')
  writeFileSync(svgPath, SVG)

  console.log('生成 PNG 图标...')
  for (const { name, size } of sizes) {
    const outPath = join(ICONS_DIR, name)
    await sharp(Buffer.from(SVG))
      .resize(size, size)
      .png()
      .toFile(outPath)
    console.log(`  ✓ ${name} (${size}x${size})`)
  }

  // 生成 ICO（包含 16, 24, 32, 48, 256 多层）
  console.log('生成 ICO 文件...')
  const icoSizes = [16, 24, 32, 48, 256]
  const pngBuffers = await Promise.all(
    icoSizes.map(s => sharp(Buffer.from(SVG)).resize(s, s).png().toBuffer())
  )

  // 手动构建 ICO 格式
  const ico = buildIco(pngBuffers, icoSizes)
  writeFileSync(join(ICONS_DIR, 'icon.ico'), ico)
  console.log('  ✓ icon.ico (16,24,32,48,256)')

  // 生成 ICNS（macOS）— 用 PNG 替代即可，Tauri 在 macOS 构建时会处理
  // 这里直接复制 512px PNG 为 icon.icns 的源
  await sharp(Buffer.from(SVG))
    .resize(512, 512)
    .png()
    .toFile(join(ICONS_DIR, 'icon.icns.png'))
  console.log('  ✓ icon.icns.png (512, macOS 构建源)')

  // 清理临时文件
  try { (await import('fs')).unlinkSync(svgPath) } catch {}

  console.log('\n全部图标生成完成！')
}

// 构建 ICO 文件格式
function buildIco(pngBuffers, sizes) {
  const numImages = pngBuffers.length
  const headerSize = 6
  const dirEntrySize = 16
  const dataOffset = headerSize + dirEntrySize * numImages

  // 计算总大小
  let totalDataSize = 0
  for (const buf of pngBuffers) totalDataSize += buf.length

  const buffer = Buffer.alloc(dataOffset + totalDataSize)

  // ICO Header
  buffer.writeUInt16LE(0, 0)      // Reserved
  buffer.writeUInt16LE(1, 2)      // Type: ICO
  buffer.writeUInt16LE(numImages, 4) // Number of images

  let currentOffset = dataOffset
  for (let i = 0; i < numImages; i++) {
    const size = sizes[i]
    const pngBuf = pngBuffers[i]
    const entryOffset = headerSize + i * dirEntrySize

    buffer.writeUInt8(size === 256 ? 0 : size, entryOffset)     // Width
    buffer.writeUInt8(size === 256 ? 0 : size, entryOffset + 1) // Height
    buffer.writeUInt8(0, entryOffset + 2)                        // Color palette
    buffer.writeUInt8(0, entryOffset + 3)                        // Reserved
    buffer.writeUInt16LE(1, entryOffset + 4)                     // Color planes
    buffer.writeUInt16LE(32, entryOffset + 6)                    // Bits per pixel
    buffer.writeUInt32LE(pngBuf.length, entryOffset + 8)         // Size of image data
    buffer.writeUInt32LE(currentOffset, entryOffset + 12)        // Offset to image data

    pngBuf.copy(buffer, currentOffset)
    currentOffset += pngBuf.length
  }

  return buffer
}

main().catch(console.error)
