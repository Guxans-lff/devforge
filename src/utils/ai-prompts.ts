/**
 * AI 工具提示词（tool guide）构建
 *
 * 根据模型 ID 判断中英文版本：国内模型（DeepSeek/Qwen/GLM/Doubao/MiniMax/Moonshot/Yi/Baichuan/Hunyuan 等）
 * 使用中文提示词；其余（Claude/GPT/Gemini/Mistral/Llama 等）使用英文提示词。
 */

import type { ChatMode } from '@/components/ai/AiInputArea.vue'

/** 中文模型标识片段（大小写不敏感包含匹配） */
const CN_MODEL_MARKERS = [
  'deepseek', 'qwen', 'tongyi', 'glm', 'chatglm', 'zhipu',
  'doubao', 'minimax', 'abab', 'moonshot', 'kimi',
  'yi-', 'yi_', 'baichuan', 'hunyuan', 'spark', 'xinghuo',
  'mimo', 'ernie', 'wenxin', 'internlm', 'skywork',
]

/**
 * 判断模型是否为"中文优先"模型（国内大模型）
 * 按模型 ID 的小写片段匹配，无法识别时默认按英文处理
 */
export function isChineseModel(modelId: string | undefined | null): boolean {
  if (!modelId) return false
  const id = modelId.toLowerCase()
  return CN_MODEL_MARKERS.some(m => id.includes(m))
}

export interface ToolGuideOptions {
  workDir: string
  chatMode: ChatMode
  modelId: string | undefined | null
  /** 可选：IDE 活跃编辑器上下文，会渲染成 <ide_context> 块附在末尾 */
  ideContext?: {
    path: string
    language: string
    cursorLine: number
    selectedText: string
  } | null
}

/**
 * 构建工具使用指引段落（已含前导 \n\n）
 * 仅在启用工具（模型支持 toolUse + 有 workDir）时调用
 */
export function buildToolGuide(opts: ToolGuideOptions): string {
  const cn = isChineseModel(opts.modelId)
  const auto = opts.chatMode === 'auto'

  if (cn) {
    let guide = `\n\n# 工具使用规则\n\n你可以使用文件工具操作用户的工作目录：\`${opts.workDir}\`。\n\n`
      + `- 创建或覆盖文件时，使用 \`write_file\`。不要把完整文件内容作为代码块输出到聊天里——代码的归属是文件，对话只用于解释。\n`
      + `- 修改已有文件的局部内容时，使用 \`edit_file\`（提供 old_string / new_string），比重写整文件省 token。\n`
      + `- 读取文件时直接调用 \`read_file\`，不要只说"我来读取"却不调用工具。\n`
      + `- 搜索代码时优先使用 \`search_files\`，不要让用户手动找。\n`
      + `- 一次生成多个文件时，连续发起多次工具调用，最后用不超过 3 句话做总结。不要重复贴你已经写入的代码。\n`
      + `- 面对 3 步以上的复杂任务，先调 \`todo_write\` 列出完整步骤，然后每完成一项再次调用把对应 id 置为 completed，同时把下一个置为 in_progress（同一时刻只能有 1 个 in_progress）。\n`
      + `- 确需调用外部工具（构建/测试/依赖安装）时用 \`bash\`；优先 read_file / search_files 而不是 cat / grep。破坏性命令会被黑名单拦截（rm -rf /、mkfs、shutdown、管道 sh 等）。\n`
      + `- 需要网络查资料时可用 \`web_search\`（Tavily）和 \`web_fetch\`（抓网页正文），本地 / 私网 IP 会被拒。web_search 可能因未配置 TAVILY_API_KEY 而不可用，此时就别调了。`
    if (auto) {
      guide += `\n\n全自动模式：一次性完成所有文件操作，不要中途问用户"是否继续"。`
    }
    guide += renderIdeContext(opts.ideContext, true)
    return guide
  }

  // English (Claude / GPT / Gemini / Mistral / Llama …)
  let guide = `\n\n# Tool usage\n\nYou have access to file tools operating in the user's workspace: \`${opts.workDir}\`.\n\n`
    + `- To create or overwrite files, use \`write_file\`. Do NOT paste full file contents as code blocks in chat — code belongs in files, chat is for explanation.\n`
    + `- To edit an existing file (small changes), use \`edit_file\` with old_string / new_string instead of rewriting the whole file.\n`
    + `- To read a file, call \`read_file\` directly. Don't say "let me read" without calling the tool.\n`
    + `- To search code, prefer \`search_files\` over asking the user.\n`
    + `- When generating multi-file projects, issue multiple tool calls in sequence, then give a short summary (≤3 sentences). Do not recap the code you already wrote.\n`
    + `- For tasks with 3+ steps, call \`todo_write\` first to lay out the full plan; update it after each step (mark one completed, set the next to in_progress; at most one in_progress at a time).\n`
    + `- Use \`bash\` only when external tooling is required (build / test / install). Prefer read_file / search_files over cat / grep. Destructive commands are blocked by a hard blacklist (rm -rf /, mkfs, shutdown, pipe-to-sh, etc.).\n`
    + `- For online lookups, use \`web_search\` (Tavily) and \`web_fetch\` (scrapes page body). Local / private IPs are blocked. web_search may be disabled if TAVILY_API_KEY is not configured — skip it in that case.`
  if (auto) {
    guide += `\n\nAuto mode: complete all file operations in one turn without mid-task confirmation questions.`
  }
  guide += renderIdeContext(opts.ideContext, false)
  return guide
}

/** 渲染 IDE 上下文段落（中英同格式，仅标题文案差异可忽略） */
function renderIdeContext(
  ctx: ToolGuideOptions['ideContext'],
  cn: boolean,
): string {
  if (!ctx || !ctx.path) return ''
  const header = cn ? '\n\n# IDE 当前上下文\n\n' : '\n\n# IDE context\n\n'
  const selection = ctx.selectedText
    ? `\nselection:\n\`\`\`${ctx.language}\n${truncate(ctx.selectedText, 2000)}\n\`\`\``
    : ''
  return `${header}<ide_context>\nactive_file: ${ctx.path}\nlanguage: ${ctx.language}\ncursor_line: ${ctx.cursorLine}${selection}\n</ide_context>`
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '\n…(truncated)' : s
}
