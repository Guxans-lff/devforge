import type { ThemeDefinition } from '@/types/theme'
import { defaultDark } from './default-dark'
import { defaultLight } from './default-light'
import { monokai } from './monokai'
import { dracula } from './dracula'
import { nord } from './nord'

export const builtinThemes: ThemeDefinition[] = [
  defaultDark,
  defaultLight,
  monokai,
  dracula,
  nord,
]

export function getThemeById(id: string): ThemeDefinition | undefined {
  return builtinThemes.find((t) => t.id === id)
}

export { defaultDark, defaultLight, monokai, dracula, nord }
