import React, { createContext, useContext, useState, useEffect } from 'react'

export type ThemeMode = 'light' | 'dark'

interface ThemeModeContextType {
  mode: ThemeMode
  toggleThemeMode: () => void
  setThemeMode: (mode: ThemeMode) => void
}

const ThemeModeContext = createContext<ThemeModeContextType>({
  mode: 'light',
  toggleThemeMode: () => {},
  setThemeMode: () => {},
})

export const useThemeMode = () => useContext(ThemeModeContext)

export function ThemeModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('ledgerline_theme_mode')
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    localStorage.setItem('ledgerline_theme_mode', mode)
    document.documentElement.setAttribute('data-theme', mode)
    if (mode === 'dark') {
      document.body.classList.add('dark-mode')
    } else {
      document.body.classList.remove('dark-mode')
    }
  }, [mode])

  const toggleThemeMode = () => {
    setMode((prev) => (prev === 'light' ? 'dark' : 'light'))
  }

  const setThemeMode = (newMode: ThemeMode) => {
    setMode(newMode)
  }

  return (
    <ThemeModeContext.Provider value={{ mode, toggleThemeMode, setThemeMode }}>
      {children}
    </ThemeModeContext.Provider>
  )
}

