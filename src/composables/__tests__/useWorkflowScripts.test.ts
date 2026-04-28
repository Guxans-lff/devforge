import { describe, expect, it } from 'vitest'
import {
  loadBuiltinWorkflows,
  findWorkflowById,
  getWorkflowFirstPrompt,
  summarizeWorkflow,
} from '../useWorkflowScripts'

describe('useWorkflowScripts', () => {
  it('loads builtin workflows', () => {
    const workflows = loadBuiltinWorkflows()
    expect(workflows.length).toBeGreaterThanOrEqual(2)

    const ids = workflows.map(w => w.id)
    expect(ids).toContain('fix-ui-freeze')
    expect(ids).toContain('fix-tauri-command')
  })

  it('parses workflow structure correctly', () => {
    const workflows = loadBuiltinWorkflows()
    const wf = findWorkflowById(workflows, 'fix-ui-freeze')
    expect(wf).toBeDefined()
    expect(wf!.name).toBe('修复 UI 卡顿')
    expect(wf!.description).toBe('排查并修复前端 UI 卡顿/无响应问题')
    expect(wf!.steps.length).toBe(4)

    const [inspect, edit, test, summarize] = wf!.steps
    expect(inspect.type).toBe('inspect')
    expect(inspect.prompt).toContain('UI 卡顿')
    expect(edit.type).toBe('edit')
    expect(test.type).toBe('test')
    expect(summarize.type).toBe('summarize')
  })

  it('findWorkflowById returns undefined for unknown id', () => {
    const workflows = loadBuiltinWorkflows()
    expect(findWorkflowById(workflows, 'nonexistent')).toBeUndefined()
  })

  it('getWorkflowFirstPrompt returns first step prompt', () => {
    const workflows = loadBuiltinWorkflows()
    const wf = findWorkflowById(workflows, 'fix-tauri-command')
    const prompt = getWorkflowFirstPrompt(wf!)
    expect(prompt).toContain('Tauri')
  })

  it('summarizeWorkflow returns human readable summary', () => {
    const workflows = loadBuiltinWorkflows()
    const wf = findWorkflowById(workflows, 'fix-ui-freeze')
    expect(summarizeWorkflow(wf!)).toBe('修复 UI 卡顿（4 步）')
  })
})
