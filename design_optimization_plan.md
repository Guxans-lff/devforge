# DevForge 设计优化方案 (Design Optimization Plan)

本项目 (DevForge) 旨在打造成一款极具设计感、现代化的开发者工具（集成了 SSH、文件管理、数据库）。当前架构采用 Vue 3 + Tailwind CSS v4 + Tauri。

## 🎯 整体设计目标 (Design Goals)
1. **现代化质感 (Modern & Premium)**：告别传统的干瘪后台面板，引入更多深度与光影。
2. **通用的毛玻璃与层级 (Glassmorphism & Depth)**：利用 Tailwind 的 `backdrop-blur`、半透明背景色 (`bg-background/80`) 与细腻边框区分视图层级。
3. **丝滑微交互 (Micro-interactions)**：在 Sidebar (侧边栏)、TabBar (标签页) 等核心导航处增加平滑过渡动画 (Transitions)；所有列表或表格的 hover 状态都应当能被用户本能地感知。
4. **精美的暗色模式 (Sleek Dark Mode)**：摒弃死板的纯黑/纯白，采用有色阶的深色背景（例如类似 GitHub Dimmed 或 Vercel 的色调），结合品牌色点缀。

---

## 🏗️ 核心模块规划 (Proposed Changes)

### 1. 全局样式与 Token (Global Styles)
- **`src/styles/index.css` & Tailwind 变量**：
  - 检查并优化 `background`、`foreground`、`muted`、`border` 等 CSS 变量，使对比度更柔和。
  - 引入更清晰的阴影层级与 `glow` 发光效果（用于终端或输入焦点）。

### 2. 核心布局层 (Layout)
- **MainLayout.vue**：为主视口内容区 (`main`) 增加圆角和细微内阴影/边框，使其在整体背景上“浮动 (Floating)”，与 Sidebar 形成明显界线。
- **Sidebar (侧边栏)**：
  - 图标采用 Lucide 现代风格，选中状态使用微发光的指示条 或 背景块。
  - 图标 Hover 时显示优雅的 Tooltip。
- **TabBar (顶部标签页)**：
  - 将标签页设计成类似现代 IDE (如 VSCode / Zed) 的风格，选中时有清晰且平滑的高亮背景块过渡。
- **BottomPanel (底部状态栏)**：
  - 采用极简设计，字号偏小，低明度，不喧宾夺主。

### 3. 核心视图层 (Views)
- **WelcomeView.vue**：
  - 加入大字体/渐变文字设计的 Hero 欢迎语。
  - “新建连接”等快捷入口采用卡片化设计，Hover 时微抬升 (`-translate-y-1` + 扩散阴影)。
- **TerminalView.vue**：
  - 终端包裹层 (Wrapper) 采用极其细微的边框，焦点(Focus)时边框呈现主题色的微光。
- **FileManagerView.vue**：
  - 优化文件列表（表格/网格）。行悬浮时背景色变化需极其顺滑。
  - 优化路径导航栏 (Breadcrumb) 样式。
- **DatabaseView.vue**：
  - SplitPanes 分割线变得更细甚至不可见，Hover 时才浮现。
  - SQL 编辑器与结果表格在视觉上通过背景色阶区分。

---

## 🧪 验证计划 (Verification Plan)
1. **开发者预览 (Dev Server)**：执行 `pnpm dev` 启动前端服务器，通过浏览器本地直接确认布局重构与微交互效果。
2. **Tauri 本地窗口预览**：执行 `pnpm tauri:dev` 唤起原生窗口，确保在无边框 / 窗口环境下的毛玻璃支持、圆角边距等完美呈现。
3. **明暗模式切换测试**：验证系统级或手动切换下的色彩平滑过渡，不出现突兀的白边或黑边。

---

> [!IMPORTANT]
> **用户确认事项**
> 1. 您对整体配色风格是否有特定的倾向？（如：偏紫/偏蓝的深色系，还是纯粹的黑白灰？是否需要保留用户自定义的主题能力？）
> 2. 在重新设计和调整的过程中，我会逐步修改 `src/components/layout/` 下的布局组件和各个视图层。是否可以按组件逐一推进并跟您确认？
