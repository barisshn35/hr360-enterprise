/**
 * PWA yardımcıları: anlık bildirim (Web Push) aboneliği ve çevrimdışı talep kuyruğu.
 *
 * KVKK — cihazda en az veri:
 *  - Push içeriği kişisel veri taşımaz; ayrıntı uygulamada görülür.
 *  - Çevrimdışı kuyruğa yalnızca izin verilen talep türleri (izin, fazla mesai) yazılır,
 *    bağlantı gelince gönderilip silinir; oturum kapanınca kuyruk ve abonelik silinir.
 */
import { apiFetch } from '@/api/client'
import { tx } from '@/lib/i18n'

const NOTIF = '/api/notification/notifications/push'

function b64ToBytes(s: string) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) throw new Error(tx('Uygulama servis çalışanı etkin değil (yalnızca kurulu/yayındaki sürümde çalışır).'))
  return reg
}

export async function currentPushSubscription() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

export async function enablePush() {
  if (!pushSupported()) throw new Error(tx('Bu tarayıcı anlık bildirimi desteklemiyor.'))
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error(tx('Bildirim izni verilmedi.'))
  const reg = await registration()
  const { publicKey } = await apiFetch<{ publicKey: string }>(`${NOTIF}/public-key`)
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }))
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  await apiFetch(`${NOTIF}/subscriptions`, { method: 'POST', body: { endpoint: json.endpoint, keys: json.keys, device: navigator.userAgent.slice(0, 120) } })
}

export async function disablePush() {
  const sub = await currentPushSubscription()
  if (!sub) return
  try { await apiFetch(`${NOTIF}/subscriptions/delete`, { method: 'POST', body: { endpoint: sub.endpoint } }) } catch { /* sunucuda zaten yok */ }
  await sub.unsubscribe()
}

export const sendTestPush = () => apiFetch(`${NOTIF}/test`, { method: 'POST' })

/* ------------------------------------------------------------------ çevrimdışı kuyruk */

const QUEUE_KEY = 'hr360-offline-queue'
/** Çevrimdışıyken sıraya alınabilecek talepler (yalnızca oluşturma). */
const QUEUEABLE = [/^\/api\/leave\/leave-requests$/, /^\/api\/timeshift\/overtime$/]

export interface QueuedRequest { id: string; path: string; method: 'POST'; body: unknown; at: string }

export class QueuedOfflineError extends Error {
  constructor() {
    super(tx('Çevrimdışısınız: talebiniz bu cihazda sıraya alındı, bağlantı gelince gönderilecek.'))
    this.name = 'QueuedOfflineError'
  }
}

function readQueue(): QueuedRequest[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueuedRequest[] } catch { return [] }
}
function writeQueue(q: QueuedRequest[]) {
  try { if (q.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); else localStorage.removeItem(QUEUE_KEY) } catch { /* depolama kapalı */ }
}

export const isQueueable = (path: string, method: string) => method === 'POST' && QUEUEABLE.some((r) => r.test(path))
export const offlineQueue = () => readQueue()

export function enqueueOffline(path: string, body: unknown) {
  const q = readQueue()
  q.push({ id: crypto.randomUUID(), path, method: 'POST', body, at: new Date().toISOString() })
  writeQueue(q)
  window.dispatchEvent(new CustomEvent('hr360:offline-queue'))
}

/** Bağlantı gelince sıradaki talepleri sırayla gönderir. Sonuç: (gönderilen, reddedilen iletileri). */
export async function flushOfflineQueue(): Promise<{ sent: number; failed: string[] }> {
  const q = readQueue()
  if (!q.length || !navigator.onLine) return { sent: 0, failed: [] }
  let sent = 0
  const failed: string[] = []
  const left: QueuedRequest[] = []
  for (const r of q) {
    try {
      await apiFetch(r.path, { method: 'POST', body: r.body, noQueue: true })
      sent++
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0
      if (status >= 400 && status < 500) failed.push(e instanceof Error ? e.message : String(e)) // iş kuralı hatası: kuyruktan çıkar
      else left.push(r) // ağ ya da sunucu hatası: sonra yeniden dene
    }
  }
  writeQueue(left)
  window.dispatchEvent(new CustomEvent('hr360:offline-queue'))
  return { sent, failed }
}

/** Oturum kapanırken: cihazdaki kuyruk ve bu cihazın anlık bildirim aboneliği silinir. */
export async function clearDeviceData() {
  writeQueue([])
  try { await disablePush() } catch { /* yoksay */ }
}
