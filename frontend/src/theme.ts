export const appThemeColors = {
  light: {
    primary: '#7c3aed',
    secondary: '#0ea5e9',
    background: '#f8fafc',
    surface: '#ffffff',
    text: '#0f172a',
  },
  dark: {
    primary: '#a78bfa',
    secondary: '#38bdf8',
    background: '#0b0f19',
    surface: '#111827',
    text: '#f8fafc',
  },
}

export function getAppTheme(mode: 'light' | 'dark' = 'light') {
  return appThemeColors[mode]
}

export default appThemeColors.light

