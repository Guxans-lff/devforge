import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceSkillsPrompt,
  normalizeWorkspaceSkill,
  normalizeWorkspaceSkills,
  summarizeWorkspaceSkills,
  validateWorkspaceSkills,
} from './workspaceSkills'

describe('workspaceSkills', () => {
  it('normalizes skill identity and defaults enabled to true', () => {
    const skill = normalizeWorkspaceSkill({ name: ' Context 7 ', description: ' docs ', path: ' .agents/skills/context7/SKILL.md ' })

    expect(skill).toEqual({
      id: 'context-7',
      name: 'Context 7',
      description: 'docs',
      path: '.agents/skills/context7/SKILL.md',
      enabled: true,
    })
  })

  it('filters empty rows and summarizes enabled state', () => {
    const skills = normalizeWorkspaceSkills([
      { id: '', name: '', path: '' },
      { id: 'frontend', name: 'Frontend', enabled: true },
      { id: 'disabled', name: 'Disabled', enabled: false, path: 'x/SKILL.md' },
    ])

    expect(skills).toHaveLength(2)
    expect(summarizeWorkspaceSkills(skills)).toEqual({
      total: 2,
      enabled: 1,
      disabled: 1,
      missingPath: 1,
      risky: 0,
      invalid: 0,
    })
  })

  it('builds prompt only for enabled workspace skills', () => {
    const prompt = buildWorkspaceSkillsPrompt([
      { id: 'frontend', name: 'Frontend Design', description: 'UI work', path: '.agents/skills/frontend-design/SKILL.md', permissions: ['read', 'write'], enabled: true },
      { id: 'disabled', name: 'Disabled', enabled: false },
    ])

    expect(prompt).toContain('<workspace-skills>')
    expect(prompt).toContain('Frontend Design')
    expect(prompt).toContain('.agents/skills/frontend-design/SKILL.md')
    expect(prompt).toContain('permissions: read, write')
    expect(prompt).not.toContain('Disabled')
  })

  it('summarizes risky skill manifest permissions', () => {
    const skills = normalizeWorkspaceSkills([
      {
        id: 'deploy',
        name: 'Deploy',
        description: 'Deploy helper',
        path: '.agents/skills/deploy/SKILL.md',
        permissions: ['read', 'execute', 'network'],
        enabled: true,
      },
    ])

    expect(summarizeWorkspaceSkills(skills)).toMatchObject({
      risky: 1,
      invalid: 1,
    })
    expect(validateWorkspaceSkills(skills).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'risky_permission',
        level: 'danger',
      }),
    ]))
  })

  it('reports malformed skill paths and missing descriptions', () => {
    const risks = validateWorkspaceSkills([
      { id: 'docs', name: 'Docs', path: '.agents/skills/docs/README.md', enabled: true },
    ])

    expect(risks.highestLevel).toBe('warning')
    expect(risks.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_path' }),
      expect.objectContaining({ code: 'missing_description' }),
    ]))
  })
})
