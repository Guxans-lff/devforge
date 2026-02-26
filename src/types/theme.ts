export interface ThemeEditorColors {
  base: 'vs' | 'vs-dark'
  rules: Array<{ token: string; foreground?: string; fontStyle?: string }>
  colors: Record<string, string>
}

export interface ThemeTerminalColors {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export interface ThemeDefinition {
  id: string
  name: string
  type: 'light' | 'dark'
  colors: Record<string, string>
  editor: ThemeEditorColors
  terminal: ThemeTerminalColors
}
