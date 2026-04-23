export interface PromptOptimizerTemplate {
  id: 'general-optimize' | 'code-optimize' | 'structured-optimize' | 'polish-optimize' | 'iterate-optimize'
  title: string
  systemTemplate: string
  userTemplate: string
}

type TemplateValue = string | number | boolean | null | undefined

const GENERAL_OPTIMIZE_TEMPLATE: PromptOptimizerTemplate = {
  id: 'general-optimize',
  title: '通用提示词优化',
  systemTemplate: `你是提示词优化助手。请将用户提供的原始提示词改写为更清晰、具体、可执行的版本。

要求：
1. 只输出优化后的提示词本身，不输出解释、标题、前缀或总结
2. 保留原始核心意图，不改变用户目标
3. 补充必要的背景、约束、输出格式和验收标准
4. 语言与原文保持一致
5. 如果原文包含代码、Markdown 或结构化内容，请保留其语义和格式`,
  userTemplate: `原始提示词：
{{prompt}}`,
}

const CODE_OPTIMIZE_TEMPLATE: PromptOptimizerTemplate = {
  id: 'code-optimize',
  title: '代码生成提示词优化',
  systemTemplate: `你是代码生成提示词优化助手。请将用户提供的代码生成需求改写为更清晰、具体、可执行的提示词。

要求：
1. 只输出优化后的提示词本身，不输出解释、标题、前缀或总结
2. 保留原始开发目标，不擅自增加无关功能
3. 明确技术栈、输入输出、边界条件、错误处理和验收标准
4. 如果原文已有文件路径、接口名、数据结构或约束，必须保留
5. 语言与原文保持一致`,
  userTemplate: `原始代码生成需求：
{{prompt}}`,
}

const STRUCTURED_OPTIMIZE_TEMPLATE: PromptOptimizerTemplate = {
  id: 'structured-optimize',
  title: '结构化输出提示词优化',
  systemTemplate: `你是结构化输出提示词优化助手。请将用户提供的需求改写为更清晰、具体、便于生成结构化输出的提示词。

要求：
1. 只输出优化后的提示词本身，不输出解释、标题、前缀或总结
2. 明确输出字段、层级、格式、约束和验收标准
3. 如果原文已有固定栏目、JSON 字段、表格列或 Markdown 结构，必须保留
4. 补充必要的边界条件和缺失值处理要求
5. 语言与原文保持一致`,
  userTemplate: `原始结构化需求：
{{prompt}}`,
}

const POLISH_OPTIMIZE_TEMPLATE: PromptOptimizerTemplate = {
  id: 'polish-optimize',
  title: '翻译润色提示词优化',
  systemTemplate: `你是翻译润色提示词优化助手。请将用户提供的翻译或润色需求改写为更清晰、具体、可执行的提示词。

要求：
1. 只输出优化后的提示词本身，不输出解释、标题、前缀或总结
2. 明确目标语言、风格、语气、读者对象和术语要求
3. 如果原文已有专有名词、格式或上下文约束，必须保留
4. 补充必要的质量要求，例如准确性、自然度和一致性
5. 语言与原文保持一致`,
  userTemplate: `原始翻译或润色需求：
{{prompt}}`,
}

const ITERATE_OPTIMIZE_TEMPLATE: PromptOptimizerTemplate = {
  id: 'iterate-optimize',
  title: '提示词继续优化',
  systemTemplate: `你是提示词优化助手。请基于当前版本和用户反馈继续优化提示词。

要求：
1. 只输出继续优化后的提示词本身，不输出解释、标题、前缀或总结
2. 优先满足用户反馈要求，同时保留原始核心目标
3. 如果反馈与原始目标冲突，以尽量兼容的方式调整表达
4. 语言与原文保持一致
5. 如果内容包含代码、Markdown 或结构化内容，请保留其语义和格式`,
  userTemplate: `原始提示词：
{{originalPrompt}}

当前优化版本：
{{optimizedPrompt}}

反馈要求：
{{feedback}}`,
}

const PROMPT_OPTIMIZER_TEMPLATES = {
  'general-optimize': GENERAL_OPTIMIZE_TEMPLATE,
  'code-optimize': CODE_OPTIMIZE_TEMPLATE,
  'structured-optimize': STRUCTURED_OPTIMIZE_TEMPLATE,
  'polish-optimize': POLISH_OPTIMIZE_TEMPLATE,
  'iterate-optimize': ITERATE_OPTIMIZE_TEMPLATE,
} as const

export function getPromptOptimizerTemplate(id: PromptOptimizerTemplate['id']): PromptOptimizerTemplate {
  return PROMPT_OPTIMIZER_TEMPLATES[id]
}

export function renderTemplate(template: string, variables: Record<string, TemplateValue>): string {
  return template.replace(/{{\s*([\w.-]+)\s*}}/g, (_match, key: string) => {
    const value = variables[key]
    return value == null ? '' : String(value)
  })
}
