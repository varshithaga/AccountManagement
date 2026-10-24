export const appThemeColors = {
  light: {
    primary: '#0D7A6C',
    secondary: '#F5A524',
    background: '#F2F6F5',
    surface: '#ffffff',
    text: '#102523',
  },
  dark: {
    primary: '#2BB3A0',
    secondary: '#F5A524',
    background: '#0A1715',
    surface: '#10211E',
    text: '#E3EFEC',
  },
}

export function getAppTheme(mode: 'light' | 'dark' = 'light') {
  return appThemeColors[mode]
}

export default appThemeColors.light

