# DevForge 项目改进计划

> 文档版本：v1.0
> 创建时间：2026-04-20
> 文档目的：基于项目现状分析，制定系统性的改进方案

---

## 一、项目现状概览

### 1.1 技术栈

| 类别 | 技术选型 |
|------|----------|
| 前端框架 | Vue 3 + TypeScript + Composition API |
| 构建工具 | Vite 7.x |
| 样式方案 | Tailwind CSS v4 |
| 状态管理 | Pinia 3.x |
| 桌面框架 | Tauri 2.x (Rust) |
| 代码编辑器 | Monaco Editor |
| 终端模拟 | Xterm.js |
| 数据可视化 | ECharts |

### 1.2 项目规模

- **前端组件**：约 260 个
- **Composables**：45 个
- **Pinia Stores**：11 个
- **TypeScript 类型定义**：29 个
- **Tauri 命令**：32 个模块
- **后端服务**：40 个

### 1.3 当前问题

根据测试运行结果，存在以下问题：
- 6 个单元测试失败
- Vue 生命周期警告（`onBeforeUnmount`）
- 部分虚拟滚动相关 bug

---

## 二、优先级划分

### 🔴 P0 - 紧急修复（1周内）

| 问题 | 位置 | 影响 |
|------|------|------|
| 虚拟滚动测试失败 | `src/components/database/__tests__/` | 核心功能稳定性 |
| useAdaptiveOverscan 测试失败 | `src/composables/__tests__/` | 滚动性能 |
| app-startup 测试失败 | `src/__tests__/` | 应用启动流程 |
| Vue 生命周期警告 | 测试环境 | 代码质量 |

### 🟡 P1 - 重要优化（2-4周）

1. **设计系统实施**
   - 全局样式变量优化
   - 毛玻璃效果实现
   - 微交互动画

2. **性能优化**
   - 代码分割细化
   - 大型依赖懒加载
   - 状态管理优化

3. **用户体验**
   - 加载状态优化
   - 错误处理增强
   - 操作反馈改进

### 🟢 P2 - 长期改进（1-3月）

1. **架构优化**
   - 模块化重构
   - 插件化架构
   - 状态持久化优化

2. **质量保障**
   - 测试覆盖率提升
   - E2E 测试引入
   - 文档完善

3. **安全加固**
   - 输入验证增强
   - 权限控制细化
   - 审计日志

---

## 三、详细改进方案

### 3.1 测试修复计划

#### 3.1.1 虚拟滚动测试

**问题文件**：
- `src/components/database/__tests__/virtual-scroll-bug-condition.test.ts`
- `src/components/database/__tests__/virtual-scroll-preservation.test.ts`

**修复策略**：
1. 检查测试中的 DOM 断言是否与实际渲染一致
2. 验证 CSS Grid 样式属性的正确性
3. 确保 `will-change` 和 `transition-colors` 的预期行为

#### 3.1.2 useAdaptiveOverscan 测试

**问题**：快速滚动时 overscan 增大逻辑未按预期工作

**修复策略**：
1. 检查滚动速度计算逻辑
2. 验证 debounce/throttle 实现
3. 确保状态回落机制正确

#### 3.1.3 app-startup 测试

**问题**：应用启动流程测试失败

**修复策略**：
1. 检查 Tauri invoke mock 是否正确
2. 验证状态恢复时机
3. 确保错误日志记录逻辑

### 3.2 设计系统实施方案

#### 3.2.1 第一阶段：全局样式（1周）

```css
/* src/styles/index.css 优化方向 */
:root {
  /* 柔和的对比度 */
  --background: 240 10% 4%;
  --foreground: 0 0% 98%;
  
  /* 增强的阴影层级 */
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1);
  
  /* Glow 发光效果 */
  --glow-primary: 0 0 20px oklch(0.7 0.15 250 / 0.3);
  --glow-focus: 0 0 0 3px oklch(0.7 0.15 250 / 0.2);
}
```

#### 3.2.2 第二阶段：布局优化（1周）

**MainLayout.vue 改进**：
- 主视口浮动效果
- 圆角和内阴影
- 边框层级区分

**ActivityBar 改进**：
- 选中状态发光指示条
- Hover Tooltip 优化
- 图标动画过渡

**TabBar 改进**：
- VSCode/Zed 风格标签页
- 平滑高亮过渡
- 拖拽排序动画

#### 3.2.3 第三阶段：视图层优化（2周）

**WelcomeView**：
- Hero 欢迎语渐变文字
- 卡片悬浮效果
- 快捷入口动画

**TerminalView**：
- 终端边框微光效果
- 焦点状态视觉反馈

**FileManagerView**：
- 文件列表行悬浮动画
- 路径导航栏优化

**DatabaseView**：
- SplitPanes 分割线优化
- 编辑器与结果表格视觉区分

### 3.3 性能优化方案

#### 3.3.1 代码分割优化

```typescript
// 当前实现已较好，可进一步优化
const DatabaseView = defineAsyncComponent(() => 
  import('@/views/DatabaseView.vue')
)

// 建议：添加 loading 和 error 状态
const DatabaseView = defineAsyncComponent({
  loader: () => import('@/views/DatabaseView.vue'),
  loadingComponent: SkeletonLoader,
  errorComponent: ErrorFallback,
  delay: 200,
  timeout: 10000,
})
```

#### 3.3.2 大型依赖处理

| 依赖 | 当前方式 | 优化建议 |
|------|----------|----------|
| Monaco Editor | vite-plugin-monaco-editor | 确认 Worker 正确内联 |
| ECharts | 全量引入 | 按需引入图表类型 |
| Tesseract.js | 直接引入 | 延迟到 OCR 功能激活时加载 |

#### 3.3.3 状态管理优化

```typescript
// 使用 storeToRefs 避免不必要的响应式
import { storeToRefs } from 'pinia'
const { connections, activeTab } = storeToRefs(workspaceStore)

// 大型数据集使用 shallowRef
import { shallowRef } from 'vue'
const largeDataset = shallowRef([])

// 非响应式数据使用 markRaw
import { markRaw } from 'vue'
const staticConfig = markRaw({ ... })
```

### 3.4 用户体验改进

#### 3.4.1 加载状态

```vue
<!-- 骨架屏组件示例 -->
<template>
  <div class="animate-pulse">
    <div class="h-4 bg-muted rounded w-3/4 mb-2"></div>
    <div class="h-4 bg-muted rounded w-1/2 mb-2"></div>
    <div class="h-4 bg-muted rounded w-5/6"></div>
  </div>
</template>
```

#### 3.4.2 错误边界

```vue
<!-- 统一错误处理组件 -->
<template>
  <slot v-if="!hasError" />
  <ErrorFallback v-else :error="error" @retry="resetError" />
</template>

<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'

const hasError = ref(false)
const error = ref<Error | null>(null)

onErrorCaptured((err) => {
  hasError.value = true
  error.value = err
  // 上报错误日志
  console.error('[ErrorBoundary]', err)
  return false
})

function resetError() {
  hasError.value = false
  error.value = null
}
</script>
```

#### 3.4.3 操作反馈

- Toast 通知统一使用 vue-sonner
- 长时间操作显示进度条
- 危险操作二次确认

---

## 四、实施计划

### 4.1 第一周：测试修复

| 日期 | 任务 | 产出 |
|------|------|------|
| Day 1-2 | 修复虚拟滚动测试 | 测试通过 |
| Day 3 | 修复 useAdaptiveOverscan 测试 | 测试通过 |
| Day 4 | 修复 app-startup 测试 | 测试通过 |
| Day 5 | 修复 Vue 生命周期警告 | 警告消除 |

### 4.2 第二周：设计系统基础

| 日期 | 任务 | 产出 |
|------|------|------|
| Day 1-2 | 全局样式变量优化 | CSS 变量更新 |
| Day 3-4 | MainLayout 浮动效果 | 布局改进 |
| Day 5 | ActivityBar 优化 | 交互改进 |

### 4.3 第三周：设计系统进阶

| 日期 | 任务 | 产出 |
|------|------|------|
| Day 1-2 | TabBar 现代化改造 | 标签页改进 |
| Day 3-4 | WelcomeView 优化 | 首页改进 |
| Day 5 | 微交互动画 | 动画库 |

### 4.4 第四周：性能优化

| 日期 | 任务 | 产出 |
|------|------|------|
| Day 1-2 | 代码分割细化 | Bundle 优化 |
| Day 3-4 | 状态管理优化 | 性能提升 |
| Day 5 | 性能测试验证 | 性能报告 |

---

## 五、验证标准

### 5.1 测试验证

```bash
# 所有测试通过
pnpm test

# 测试覆盖率 > 80%
pnpm test:coverage
```

### 5.2 性能验证

- 首屏加载时间 < 2s
- 切换标签页响应 < 100ms
- 虚拟滚动帧率 > 50fps

### 5.3 设计验证

- 开发者预览：`pnpm dev`
- Tauri 预览：`pnpm tauri:dev`
- 明暗模式切换流畅

---

## 六、风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 测试修复引入新 bug | 中 | 中 | 充分回归测试 |
| 设计改动影响现有功能 | 低 | 高 | 组件级别隔离改动 |
| 性能优化效果不明显 | 中 | 低 | 基准测试对比 |

---

## 七、相关文档

- [设计优化方案](./design_optimization_plan.md)
- [代码审查报告](./code-review-report.md)
- [AI 模块评估报告](./ai-module-assessment-report.md)

---

> **下一步行动**：确认优先级后，从 P0 测试修复开始实施。
