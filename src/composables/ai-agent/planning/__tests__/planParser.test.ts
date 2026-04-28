import { describe, it, expect } from 'vitest'
import { parsePlanFromText, toCreatePlanOptions } from '@/composables/ai-agent/planning/planParser'

describe('planParser', () => {
  describe('parsePlanFromText', () => {
    it('parses dashed step list with "Step N:" prefix', () => {
      const text = `Plan: Refactor auth module

- Step 1: Extract login logic into a separate service
  Move the authentication checks from the controller.
- Step 2: Add unit tests for the new service
  Cover edge cases like expired tokens.
- Step 3: Update API documentation`

      const plan = parsePlanFromText(text)
      expect(plan.title).toBe('Plan: Refactor auth module')
      expect(plan.steps).toHaveLength(3)
      expect(plan.steps[0]!.title).toBe('Extract login logic into a separate service')
      expect(plan.steps[0]!.description).toBe('Move the authentication checks from the controller.')
      expect(plan.steps[1]!.title).toBe('Add unit tests for the new service')
      expect(plan.steps[2]!.title).toBe('Update API documentation')
    })

    it('parses numbered list', () => {
      const text = `Fix the database migration bug

1. Identify the failing migration script
2. Create a backup of the current schema
3. Run the corrected migration
4. Verify data integrity`

      const plan = parsePlanFromText(text)
      expect(plan.title).toBe('Fix the database migration bug')
      expect(plan.steps).toHaveLength(4)
      expect(plan.steps[0]!.title).toBe('Identify the failing migration script')
      expect(plan.steps[0]!.index).toBe(0)
      expect(plan.steps[3]!.title).toBe('Verify data integrity')
      expect(plan.steps[3]!.index).toBe(3)
    })

    it('parses markdown heading steps', () => {
      const text = `## UI Redesign

### Step 1: Update color palette
Switch to the new brand colors.
### Step 2: Redesign the navbar
Make it responsive.
### 3. Add dark mode toggle`

      const plan = parsePlanFromText(text)
      expect(plan.title).toBe('UI Redesign')
      expect(plan.steps).toHaveLength(3)
      expect(plan.steps[0]!.title).toBe('Update color palette')
      expect(plan.steps[0]!.description).toBe('Switch to the new brand colors.')
      expect(plan.steps[1]!.title).toBe('Redesign the navbar')
      expect(plan.steps[2]!.title).toBe('Add dark mode toggle')
    })

    it('parses bold step markers', () => {
      const text = `Backend optimization plan

**Step 1:** Add database indexes
**2. Implement caching layer**
**Step 3:** Optimize N+1 queries`

      const plan = parsePlanFromText(text)
      expect(plan.steps).toHaveLength(3)
      expect(plan.steps[0]!.title).toBe('Add database indexes')
      expect(plan.steps[1]!.title).toBe('Implement caching layer')
      expect(plan.steps[2]!.title).toBe('Optimize N+1 queries')
    })

    it('parses simple dashed list without numbers', () => {
      const text = `Quick fixes

- Fix the login redirect
- Update the README
- Bump version number`

      const plan = parsePlanFromText(text)
      expect(plan.steps).toHaveLength(3)
      expect(plan.steps[0]!.title).toBe('Fix the login redirect')
      expect(plan.steps[0]!.index).toBe(0)
      expect(plan.steps[1]!.title).toBe('Update the README')
      expect(plan.steps[2]!.title).toBe('Bump version number')
    })

    it('falls back to single step when no list detected', () => {
      const text = `I will refactor the entire codebase to improve maintainability and performance.`

      const plan = parsePlanFromText(text)
      expect(plan.steps).toHaveLength(1)
      expect(plan.steps[0]!.title).toBe('I will refactor the entire codebase to improve maintainability and performance.')
      expect(plan.steps[0]!.index).toBe(0)
    })

    it('extracts description from text before steps', () => {
      const text = `Database Schema Review

We need to review the current schema before making changes.
This involves checking all foreign keys and indexes.

1. List all tables
2. Check foreign key constraints
3. Review index usage`

      const plan = parsePlanFromText(text)
      expect(plan.title).toBe('Database Schema Review')
      expect(plan.description).toContain('review the current schema')
      expect(plan.description).toContain('checking all foreign keys and indexes')
    })

    it('extracts related file paths', () => {
      const text = `Code Review

- Update \`src/auth.ts\`
- Modify "src/user/controller.ts"
- Fix 'src/db/migrate.sql'
- Update docs`

      const plan = parsePlanFromText(text)
      expect(plan.relatedFiles).toContain('src/auth.ts')
      expect(plan.relatedFiles).toContain('src/user/controller.ts')
      expect(plan.relatedFiles).toContain('src/db/migrate.sql')
      // "docs" 没有文件扩展名，不应被提取
      expect(plan.relatedFiles).not.toContain('docs')
    })

    it('handles mixed step formats', () => {
      const text = `Mixed Plan

1. First step
- Second step
### Step 3: Third step`

      const plan = parsePlanFromText(text)
      expect(plan.steps).toHaveLength(3)
      expect(plan.steps[0]!.title).toBe('First step')
      expect(plan.steps[1]!.title).toBe('Second step')
      expect(plan.steps[2]!.title).toBe('Third step')
    })

    it('handles empty text', () => {
      const plan = parsePlanFromText('')
      expect(plan.title).toBe('Untitled Plan')
      expect(plan.steps).toHaveLength(1)
      expect(plan.steps[0]!.title).toBe('Untitled Plan')
    })

    it('handles steps with parenthetical numbers', () => {
      const text = `Plan

1) First action
2) Second action
3) Third action`

      const plan = parsePlanFromText(text)
      expect(plan.steps).toHaveLength(3)
      expect(plan.steps[0]!.title).toBe('First action')
      expect(plan.steps[1]!.title).toBe('Second action')
    })

    it('deduplicates related files', () => {
      const text = `Plan

- Update \`src/auth.ts\`
- Also update \`src/auth.ts\``

      const plan = parsePlanFromText(text)
      expect(plan.relatedFiles).toHaveLength(1)
      expect(plan.relatedFiles[0]).toBe('src/auth.ts')
    })
  })

  describe('toCreatePlanOptions', () => {
    it('converts parsed plan to create options', () => {
      const parsed = parsePlanFromText(`Test Plan\n\n1. Step A\n2. Step B`)
      const options = toCreatePlanOptions(parsed, 'session-1')

      expect(options.sessionId).toBe('session-1')
      expect(options.title).toBe('Test Plan')
      expect(options.steps).toHaveLength(2)
      expect(options.relatedFiles).toEqual([])
    })
  })
})
