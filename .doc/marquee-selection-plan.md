# FilePane 鼠标拖拽框选（Marquee Selection）

## Context

文件管理器的 FilePane 组件当前只支持 Ctrl+Click 多选和 Shift+Click 范围选择，不支持鼠标拖拽框选。用户希望像 Windows 资源管理器一样在空白区域拖拽画框选中多个文件。

## 修改文件

仅修改 `src/components/file-manager/FilePane.vue`

## 实现方案

### 核心思路

- 在空白区域 mousedown → 进入"待框选"状态
- 鼠标移动超过 4px 阈值 → 正式激活框选
- 在文件行上 mousedown → 保持原有拖放行为（draggable）
- 用 `data-row-index` 属性区分点击位置
- 选中计算用纯数学（index = y / ROW_HEIGHT），不依赖 DOM

### 1. 添加状态

```ts
// 框选状态
const isMarqueePending = ref(false)         // mousedown 了但还没超过阈值
const isMarqueeActive = ref(false)          // 正式激活框选（超过阈值）
const marqueeOrigin = ref({ x: 0, y: 0 })  // mousedown 时的视口坐标（clientX/Y 相对于容器）
const marqueeStart = ref({ x: 0, y: 0 })   // 内容坐标系（含 scrollTop）
const marqueeEnd = ref({ x: 0, y: 0 })     // 内容坐标系（含 scrollTop）
const lastMouseViewportY = ref(0)           // 最后一次 mousemove 的视口 Y（用于自动滚动时重算）
const marqueePreSelection = ref<Set<string>>(new Set())
const autoScrollTimer = ref<number | null>(null)
```

### 2. 坐标系说明

- **视口坐标**：clientY - containerRect.top，即相对于 scrollContainerRef 可见区域的坐标
- **内容坐标**：视口坐标 + scrollTop，即相对于整个虚拟列表内容的绝对坐标
- 框选矩形的**选中计算**用内容坐标（与 ROW_HEIGHT 对齐）
- 框选矩形的**渲染**用视口坐标（不随滚动移动）

### 3. 事件处理

#### mousedown（scrollContainerRef）
```
1. 只响应左键（button === 0）
2. target.closest('[data-row-index]') 非空 → return（让原生 drag 接管）
3. event.preventDefault()（防止文本选中）
4. 记录 marqueeOrigin（视口坐标）和 marqueeStart（内容坐标）
5. Ctrl 按下 → marqueePreSelection = 当前 selectedEntries 的副本
   否则 → marqueePreSelection 清空，clearSelection()
6. isMarqueePending = true
7. document 上注册 mousemove / mouseup
```

#### mousemove（document 级别）
```
1. 如果 isMarqueePending（还没激活）：
   - 计算与 marqueeOrigin 的距离
   - 距离 < 4px → return（不激活）
   - 距离 >= 4px → isMarqueePending = false, isMarqueeActive = true
2. 计算视口坐标和内容坐标，更新 marqueeEnd
3. 记录 lastMouseViewportY
4. 调用 handleAutoScroll(viewportY, containerHeight)
5. 调用 updateMarqueeSelection()
```

#### mouseup（document 级别）
```
1. 如果 isMarqueePending（没超过阈值 = 单击空白区域）：
   - 如果没按 Ctrl → clearSelection()（点击空白取消选择）
2. isMarqueePending = false, isMarqueeActive = false
3. stopAutoScroll()
4. 移除 document 事件监听
```

#### updateMarqueeSelection（纯数学）
```
rect = { top: min(start.y, end.y), bottom: max(start.y, end.y) }
startIndex = max(0, floor(rect.top / ROW_HEIGHT))
endIndex = min(entries.length - 1, floor(rect.bottom / ROW_HEIGHT))

newSelection = new Set(marqueePreSelection)  // Ctrl 模式下保留原选择
for i in [startIndex, endIndex]:
  if 行 i 与 rect 纵向有交集:
    newSelection.add(entries[i].path)
selectedEntries = newSelection
```

### 4. 边缘自动滚动

```
AUTO_SCROLL_ZONE = 40px
AUTO_SCROLL_SPEED = 8px/帧

handleAutoScroll(viewportY, containerHeight):
  如果 viewportY < 40 → scrollDelta = 负值（向上滚，越靠近边缘越快）
  如果 viewportY > height - 40 → scrollDelta = 正值（向下滚）
  否则 → 停止自动滚动

  setInterval(16ms):
    container.scrollTop += scrollDelta
    // 关键：用 lastMouseViewportY + 新的 scrollTop 重新计算 marqueeEnd
    marqueeEnd.y = lastMouseViewportY + container.scrollTop
    updateMarqueeSelection()
```

重点：自动滚动时始终用 `lastMouseViewportY + scrollTop` 重新计算，不累加，避免鼠标同时移动时的冲突。

### 5. 框选矩形渲染

在 scrollContainerRef 内部，用 absolute 定位，视口坐标。scrollContainerRef 已有 `relative` 类。

```html
<!-- scrollContainerRef 内部第一个子元素 -->
<div
  v-if="marqueeDisplayRect"
  class="pointer-events-none absolute z-20 border border-primary/60 bg-primary/10"
  :style="{
    left: marqueeDisplayRect.left + 'px',
    top: marqueeDisplayRect.top + 'px',
    width: marqueeDisplayRect.width + 'px',
    height: marqueeDisplayRect.height + 'px',
  }"
/>
```

marqueeDisplayRect（computed）：将内容坐标转回视口坐标
```ts
startY_viewport = marqueeStart.y - scrollTop
endY_viewport = marqueeEnd.y - scrollTop
return {
  left: min(start.x, end.x),
  top: min(startY_viewport, endY_viewport),
  width: abs(end.x - start.x),
  height: abs(endY_viewport - startY_viewport),
}
```

但 absolute 定位在 overflow-auto 容器内会随内容滚动。解决：不用 absolute，改用 **fixed 定位 + 容器 getBoundingClientRect 偏移**，或者用 **pointer-events-none 的覆盖层**。

最终方案：在 scrollContainerRef **外部**（同级）放一个 fixed 定位的覆盖层，用 clip-path 裁剪到容器范围内。

```html
<!-- 与 scrollContainerRef 同级，在其后面 -->
<div
  v-if="marqueeDisplayRect"
  class="pointer-events-none fixed z-20 border border-primary/60 bg-primary/10"
  :style="marqueeDisplayStyle"
/>
```

marqueeDisplayStyle（computed）：
```ts
const containerRect = scrollContainerRef.getBoundingClientRect()
return {
  left: (containerRect.left + displayRect.left) + 'px',
  top: (containerRect.top + displayRect.top) + 'px',
  width: displayRect.width + 'px',
  height: displayRect.height + 'px',
}
```

用 fixed 定位最简单可靠，不受滚动影响，且 scrollContainerRef 的 overflow:auto 不会裁剪它（因为它在外部）。但需要手动裁剪到容器范围 — 在 marqueeDisplayRect 计算时 clamp top/bottom 到 [0, containerHeight] 即可。

### 6. 模板改动

- scrollContainerRef 加 `@mousedown="handleMarqueeMouseDown"`
- 每个文件行加 `:data-row-index="vRow.index"`
- scrollContainerRef 后面加框选矩形 DOM（fixed 定位）

### 7. 清理

```ts
onBeforeUnmount(() => {
  stopAutoScroll()
  document.removeEventListener('mousemove', handleMarqueeMouseMove)
  document.removeEventListener('mouseup', handleMarqueeMouseUp)
})
```

### 8. 与现有功能的兼容

| 操作 | 行为 |
|------|------|
| 空白区域单击 | 清空选择（mouseup 时判断未超过阈值） |
| 空白区域拖拽 | 框选 |
| Ctrl + 空白区域拖拽 | 追加框选 |
| 文件行单击 | 原有 handleClick 逻辑 |
| 文件行拖拽 | 原有 draggable 文件拖放 |
| Ctrl+Click | 原有切换选择 |
| Shift+Click | 原有范围选择 |
| Ctrl+A | 原有全选 |
| 右键 | 原有右键菜单，不触发框选 |

## 验证

1. 空白区域拖拽 → 蓝色半透明框选矩形，经过的行实时高亮选中
2. 拖拽不到 4px 松开 → 不出现框选矩形，清空选择（单击空白）
3. Ctrl+拖拽 → 追加选择，不清除已有选择
4. 文件行上拖拽 → 正常触发文件拖放，不触发框选
5. 文件列表很长时，框选到边缘自动滚动，选中范围正确扩展
6. Ctrl+Click、Shift+Click 等已有选择方式不受影响
7. vue-tsc 类型检查通过
