/**
 * Mock katmanı yardımcıları: yanıt kurucular, gecikme, deterministik rastgelelik.
 */

import { HttpResponse, delay, type JsonBodyType } from 'msw'

/** Gerçek ağ hissi: 250–550 ms. İskeletlerin göründüğünden emin olmak için. */
export async function latency() {
  await delay(250 + Math.floor(Math.random() * 300))
}

export const ok = (data: unknown, status = 200) => HttpResponse.json(data as JsonBodyType, { status })

export const noContent = () => new HttpResponse(null, { status: 204 })

/** Backend'in iş kuralı hatası: `{ message, ...ek }` + 400. */
export const bad = (message: string, extra: Record<string, unknown> = {}) =>
  HttpResponse.json({ message, ...extra }, { status: 400 })

export const notFound = (message = 'Kayıt bulunamadı.') => HttpResponse.json({ message }, { status: 404 })

export const forbidden = (message = 'Bu işlem için yetkiniz yok.') =>
  HttpResponse.json({ message }, { status: 403 })

export const serverError = (message: string) => HttpResponse.json({ message }, { status: 500 })

/* ------------------------------ deterministik rastgelelik ---------------------- */

/** FNV-1a — metinden sabit 32 bit tohum. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Mulberry32 — tohumlu, tekrarlanabilir PRNG. */
export function rng(seed: number | string) {
  let a = typeof seed === 'string' ? hashString(seed) : seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Ad alanı + anahtardan sabit, UUID biçiminde kimlik. Yeniden yüklemede değişmez. */
export function uid(ns: string, key: string): string {
  const r = rng(`${ns}:${key}`)
  const hex = Array.from({ length: 32 }, () => Math.floor(r() * 16).toString(16)).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : uid('rand', `${Date.now()}-${Math.random()}`)
}

export const round2 = (n: number) => Math.round(n * 100) / 100
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** "Kod kalitesi" → "kod-kalitesi" (backend'in code türetmesiyle aynı). */
export function slugify(name: string): string {
  return name
    .toLocaleLowerCase('tr-TR')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export const nowIso = () => new Date().toISOString()
export const today = () => new Date().toISOString().slice(0, 10)

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function stdev(values: number[]): number | null {
  if (values.length < 2) return null
  const m = values.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length)
}

export const avg = (values: number[]): number | null =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
