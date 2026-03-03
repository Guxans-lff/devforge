import type { ThemeDefinition } from '@/types/theme'

export const defaultDark: ThemeDefinition = {
  id: 'default-dark',
  name: 'Default Dark',
  type: 'dark',
  colors: {
    '--background': 'oklch(0.141 0.005 285.823)',
    '--foreground': 'oklch(0.985 0 0)',  // 保持高对比度
    '--card': 'oklch(0.21 0.006 285.885)',
    '--card-foreground': 'oklch(0.985 0 0)',
    '--popover': 'oklch(0.21 0.006 285.885)',
    '--popover-foreground': 'oklch(0.985 0 0)',
    '--primary': 'oklch(0.92 0.004 286.32)',
    '--primary-foreground': 'oklch(0.21 0.006 285.885)',
    '--secondary': 'oklch(0.274 0.006 286.033)',
    '--secondary-foreground': 'oklch(0.985 0 0)',
    '--muted': 'oklch(0.274 0.006 286.033)',
    '--muted-foreground': 'oklch(0.75 0.015 286.067)',  // 提高对比度：0.705 -> 0.75
    '--accent': 'oklch(0.274 0.006 286.033)',
    '--accent-foreground': 'oklch(0.985 0 0)',
    '--destructive': 'oklch(0.704 0.191 22.216)',
    '--border': 'oklch(1 0 0 / 15%)',  // 提高边框可见度：10% -> 15%
    '--input': 'oklch(1 0 0 / 20%)',  // 提高输入框边框可见度：15% -> 20%
    '--ring': 'oklch(0.552 0.016 285.938)',
    '--df-success': 'oklch(0.723 0.191 149.579)',
    '--df-warning': 'oklch(0.795 0.184 86.047)',
    '--df-info': 'oklch(0.623 0.214 259.815)',
    '--df-elevated': 'oklch(0.3 0.006 286.033)',  // 提高高度层级对比度：0.274 -> 0.3
    '--df-surface': 'oklch(0.21 0.006 285.885)',
    '--df-overlay': 'oklch(0 0 0 / 70%)',  // 提高遮罩不透明度：60% -> 70%
    '--sidebar': 'oklch(0.21 0.006 285.885)',
    '--sidebar-foreground': 'oklch(0.985 0 0)',
    '--sidebar-primary': 'oklch(0.488 0.243 264.376)',
    '--sidebar-primary-foreground': 'oklch(0.985 0 0)',
    '--sidebar-accent': 'oklch(0.3 0.006 286.033)',  // 提高侧边栏强调色对比度：0.274 -> 0.3
    '--sidebar-accent-foreground': 'oklch(0.985 0 0)',
    '--sidebar-border': 'oklch(1 0 0 / 15%)',  // 提高侧边栏边框可见度：10% -> 15%
    '--sidebar-ring': 'oklch(0.552 0.016 285.938)',
  },
  editor: {
    base: 'vs-dark',
    rules: [],
    colors: {},
  },
  terminal: {
    background: '#09090b',
    foreground: '#fafafa',
    cursor: '#fafafa',
    selectionBackground: '#27272a',
    black: '#09090b',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#eab308',
    blue: '#3b82f6',
    magenta: '#a855f7',
    cyan: '#06b6d4',
    white: '#fafafa',
    brightBlack: '#52525b',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#facc15',
    brightBlue: '#60a5fa',
    brightMagenta: '#c084fc',
    brightCyan: '#22d3ee',
    brightWhite: '#ffffff',
  },
}
