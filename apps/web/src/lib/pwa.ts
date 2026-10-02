import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    listeners.forEach((l) => l())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    listeners.forEach((l) => l())
  })
}

/** Tarayıcı “ana ekrana ekle” sunuyorsa yükleme fonksiyonu döner, yoksa null. */
export function useInstallPrompt(): (() => Promise<void>) | null {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  if (!deferred) return null
  return async () => {
    const e = deferred
    if (!e) return
    await e.prompt()
    await e.userChoice
    deferred = null
    listeners.forEach((l) => l())
  }
}
