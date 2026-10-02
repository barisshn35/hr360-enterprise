import { useCallback, useSyncExternalStore } from 'react'

/**
 * Kenar çubuğunun daraltılmış (yalnızca ikon) hâli. AppShell içerik
 * boşluğunu, SidebarNav kendi genişliğini aynı değerden okur; tercih
 * tarayıcıda saklanır.
 */
const KEY = 'hr360.sidebar.collapsed'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

let current = typeof window === 'undefined' ? false : read()

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export const SIDEBAR_WIDTH = 264
export const SIDEBAR_COLLAPSED_WIDTH = 72

export function useSidebarCollapsed() {
  const collapsed = useSyncExternalStore(subscribe, () => current, () => false)
  const setCollapsed = useCallback((next: boolean) => {
    current = next
    try {
      window.localStorage.setItem(KEY, next ? '1' : '0')
    } catch {
      /* depolama kapalı — oturum boyunca geçerli olur */
    }
    listeners.forEach((l) => l())
  }, [])
  return { collapsed, setCollapsed, toggle: () => setCollapsed(!current) }
}
