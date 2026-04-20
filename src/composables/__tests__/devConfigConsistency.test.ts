import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function readViteDevPort(): number {
  const configPath = path.resolve(process.cwd(), 'vite.config.ts')
  const content = fs.readFileSync(configPath, 'utf-8')
  const match = content.match(/server:\s*\{[\s\S]*?port:\s*(\d+)/)
  if (!match) {
    throw new Error('Unable to read Vite dev server port from vite.config.ts')
  }
  return Number(match[1])
}

function readTauriDevUrl(): string {
  const configPath = path.resolve(process.cwd(), 'src-tauri/tauri.conf.json')
  const raw = fs.readFileSync(configPath, 'utf-8')
  const parsed = JSON.parse(raw) as {
    build?: {
      devUrl?: string
    }
  }
  return parsed.build?.devUrl ?? ''
}

describe('dev config consistency', () => {
  it('keeps tauri devUrl aligned with vite dev server port', () => {
    const vitePort = readViteDevPort()
    const tauriDevUrl = readTauriDevUrl()

    expect(tauriDevUrl).toBe(`http://localhost:${vitePort}`)
  })
})
