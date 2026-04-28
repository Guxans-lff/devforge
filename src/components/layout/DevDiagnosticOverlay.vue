<script setup lang="ts">
/**
 * 临时诊断浮层：自动检测屏幕中心点的元素栈 + 全屏 fixed 元素
 * 通过页面 UI 直接展示，绕开 DevTools 控制台粘贴限制
 *
 * 右下角小按钮：
 *  - 「诊断」：列出屏幕中心 8 层元素 + 所有全屏 fixed 元素
 *  - 「解锁」：强制把所有 z>=40 全屏 fixed 元素的 pointer-events 禁掉
 */
import { onMounted, ref, shallowRef } from 'vue'

interface InspectedNode {
  tag: string
  id: string
  cls: string
  slot: string | undefined
  state: string | undefined
  pe: string
  pos: string
  z: string
  size: string
}

const visible = ref(true)
const expanded = ref(true)
const stack = shallowRef<InspectedNode[]>([])
const fullScreenFixed = shallowRef<InspectedNode[]>([])
const globalPe = ref('')
const killed = ref<string[]>([])

function describe(el: Element): InspectedNode {
  const s = window.getComputedStyle(el)
  const r = el.getBoundingClientRect()
  return {
    tag: el.tagName.toLowerCase(),
    id: (el as HTMLElement).id || '',
    cls: typeof (el as HTMLElement).className === 'string'
      ? (el as HTMLElement).className.slice(0, 120)
      : '',
    slot: (el as HTMLElement).dataset?.slot,
    state: (el as HTMLElement).dataset?.state,
    pe: s.pointerEvents,
    pos: s.position,
    z: s.zIndex,
    size: `${Math.round(r.width)}x${Math.round(r.height)}`,
  }
}

function runInspect() {
  const x = window.innerWidth / 2
  const y = window.innerHeight / 2
  // 不限制层数，看看到底命中多少层
  stack.value = document
    .elementsFromPoint(x, y)
    .filter(el => !el.closest('[data-devforge-diag]'))
    .slice(0, 20)
    .map(describe)

  // 额外：扫描 #app 第一层子元素，看它们的位置/尺寸/pe
  const app = document.getElementById('app')
  if (app) {
    const children = [...app.children]
    console.log('[Diag] #app children:', children.map(c => ({
      tag: c.tagName,
      cls: (c.className?.toString?.() || '').slice(0, 80),
      pe: getComputedStyle(c).pointerEvents,
      pos: getComputedStyle(c).position,
      rect: c.getBoundingClientRect(),
    })))
  }

  fullScreenFixed.value = [...document.querySelectorAll<HTMLElement>('*')]
    .filter((el) => {
      if (el.closest('[data-devforge-diag]')) return false
      const s = window.getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return (
        s.position === 'fixed'
        && r.width >= window.innerWidth * 0.85
        && r.height >= window.innerHeight * 0.85
      )
    })
    .slice(0, 20)
    .map(describe)

  globalPe.value = `body=${getComputedStyle(document.body).pointerEvents}; html=${getComputedStyle(document.documentElement).pointerEvents}`
}

function runUnlock() {
  document.body.style.pointerEvents = ''
  document.documentElement.style.pointerEvents = ''
  const list: string[] = []
  document.querySelectorAll<HTMLElement>('*').forEach((el) => {
    if (el.closest('[data-devforge-diag]')) return
    const s = window.getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const z = Number.parseInt(s.zIndex || '0', 10)
    if (
      s.position === 'fixed'
      && r.width >= window.innerWidth * 0.85
      && r.height >= window.innerHeight * 0.85
      && Number.isFinite(z)
      && z >= 40
    ) {
      el.style.setProperty('pointer-events', 'none', 'important')
      list.push(`<${el.tagName.toLowerCase()} class="${(el.className?.toString?.() || '').slice(0, 60)}" z=${z}>`)
    }
  })
  killed.value = list
  runInspect()
}

/**
 * 强力修复：扫描 #app 全树，找出所有 inline style 含 pointer-events:none
 * 或者 computed pointer-events 是 none 的可见元素，全部强制改为 auto
 */
function runFixPointerEvents() {
  const list: string[] = []
  const app = document.getElementById('app')
  if (!app) return
  const all = app.querySelectorAll<HTMLElement>('*')
  all.forEach((el) => {
    if (el.closest('[data-devforge-diag]')) return
    const s = window.getComputedStyle(el)
    if (s.pointerEvents === 'none') {
      const r = el.getBoundingClientRect()
      // 只处理可见的元素
      if (r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none') {
        el.style.setProperty('pointer-events', 'auto', 'important')
        list.push(`<${el.tagName.toLowerCase()} class="${(el.className?.toString?.() || '').slice(0, 60)}" size=${Math.round(r.width)}x${Math.round(r.height)}>`)
      }
    }
  })
  // 同时清掉 body / html 的 inline pointer-events
  document.body.style.pointerEvents = ''
  document.documentElement.style.pointerEvents = ''
  killed.value = list
  runInspect()
  console.log('[Diag] 已强制把', list.length, '个 pointer-events:none 元素改回 auto')
}

onMounted(() => {
  setTimeout(runInspect, 1500)
})
</script>

<template>
  <div
    v-if="visible"
    data-devforge-diag
    style="
      position: fixed;
      right: 8px;
      bottom: 8px;
      z-index: 2147483647;
      max-width: 520px;
      max-height: 70vh;
      overflow: auto;
      background: rgba(20, 20, 24, 0.95);
      color: #e6e6e6;
      font: 11px/1.5 ui-monospace, monospace;
      border: 1px solid #555;
      border-radius: 6px;
      padding: 8px 10px;
      pointer-events: auto;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    "
  >
    <div style="display: flex; gap: 6px; margin-bottom: 6px; align-items: center;">
      <strong style="color: #fbbf24;">[Diag]</strong>
      <button
        style="padding: 2px 8px; background: #2563eb; color: white; border: 0; border-radius: 3px; cursor: pointer;"
        @click="runInspect"
      >
        诊断
      </button>
      <button
        style="padding: 2px 8px; background: #dc2626; color: white; border: 0; border-radius: 3px; cursor: pointer;"
        @click="runUnlock"
      >
        强制解锁
      </button>
      <button
        style="padding: 2px 8px; background: #16a34a; color: white; border: 0; border-radius: 3px; cursor: pointer;"
        @click="runFixPointerEvents"
      >
        修复PE
      </button>
      <button
        style="padding: 2px 8px; background: #444; color: white; border: 0; border-radius: 3px; cursor: pointer;"
        @click="expanded = !expanded"
      >
        {{ expanded ? '收起' : '展开' }}
      </button>
      <button
        style="padding: 2px 8px; background: #444; color: white; border: 0; border-radius: 3px; cursor: pointer;"
        @click="visible = false"
      >
        ×
      </button>
    </div>

    <template v-if="expanded">
      <div style="margin-bottom: 4px;">
        <span style="color: #94a3b8;">global pe:</span> {{ globalPe }}
      </div>

      <div v-if="killed.length" style="margin-bottom: 6px; color: #fca5a5;">
        <strong>已禁用：</strong>
        <ul style="margin: 2px 0; padding-left: 16px;">
          <li v-for="(item, i) in killed" :key="i">{{ item }}</li>
        </ul>
      </div>

      <div style="margin-bottom: 4px; color: #94a3b8;">
        <strong style="color: #fbbf24;">中心点元素栈 (上→下):</strong>
      </div>
      <ol style="margin: 0 0 6px 0; padding-left: 18px;">
        <li
          v-for="(n, i) in stack"
          :key="i"
          style="margin-bottom: 2px; word-break: break-all;"
        >
          <code>&lt;{{ n.tag }}{{ n.id ? ` #${n.id}` : '' }}{{ n.slot ? ` slot=${n.slot}` : '' }}{{ n.state ? ` state=${n.state}` : '' }}&gt;</code>
          <div style="color: #94a3b8; padding-left: 6px;">
            pe={{ n.pe }} pos={{ n.pos }} z={{ n.z }} size={{ n.size }}
          </div>
          <div v-if="n.cls" style="color: #6b7280; padding-left: 6px; font-size: 10px;">
            {{ n.cls }}
          </div>
        </li>
      </ol>

      <div v-if="fullScreenFixed.length" style="margin-bottom: 4px; color: #94a3b8;">
        <strong style="color: #fbbf24;">全屏 fixed 元素 ({{ fullScreenFixed.length }}):</strong>
      </div>
      <ol v-if="fullScreenFixed.length" style="margin: 0; padding-left: 18px;">
        <li
          v-for="(n, i) in fullScreenFixed"
          :key="i"
          style="margin-bottom: 2px; word-break: break-all;"
        >
          <code>&lt;{{ n.tag }}{{ n.slot ? ` slot=${n.slot}` : '' }}{{ n.state ? ` state=${n.state}` : '' }}&gt;</code>
          <span style="color: #94a3b8;"> pe={{ n.pe }} z={{ n.z }}</span>
          <div v-if="n.cls" style="color: #6b7280; padding-left: 6px; font-size: 10px;">
            {{ n.cls }}
          </div>
        </li>
      </ol>
    </template>
  </div>
</template>
