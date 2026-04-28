/**
 * AI 多输入源统一类型
 *
 * 所有进入 AI 对话的输入都必须标记来源，便于 trace、诊断和后续分析。
 */

export type AiInputSource =
  | 'keyboard'
  | 'slash_command'
  | 'at_mention'
  | 'context_menu'
  | 'resource_manager'
  | 'schema_compare'
  | 'voice'
  | 'workflow'
  | 'plan_approval'
  | 'bump_max_output'
  | 'continue'
  | 'task_auto_start'
